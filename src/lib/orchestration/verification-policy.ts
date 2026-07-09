import {
  getTaskExecutionPolicy,
  isCodeFile,
  isMarkupOrStyleFile,
  normalizeRelativePath,
} from './task-shape';
import type { Task } from '@/lib/db/schema';

type TaskLike = Pick<Task, 'title' | 'description'>;

export interface VerificationFailure {
  gate: string;
  summary: string;
  files: string[];
}

export interface VerificationGateLike {
  gate: string;
  status: 'passed' | 'failed' | 'skipped';
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface VerificationPlan {
  policy: 'scoped' | 'strict';
  verifiedFiles: string[];
  lintFiles: string[];
  needsTypecheck: boolean;
  needsBuild: boolean;
  includeTests: boolean;
  includeSecurityAudit: boolean;
}

export function extractReferencedFiles(output: string): string[] {
  const normalized = output.replace(/\\/g, '/');
  const matches = normalized.match(
    /(?:[A-Za-z]:)?\/?[^:\n]+?\.(?:tsx?|jsx?|css|scss|sass|less|html|mdx|json)/g,
  );

  return [...new Set((matches ?? []).map((entry) => entry.replace(/^\/+/, '')))];
}

export function isFailureRelevantToFiles(output: string, changedFiles: string[]): boolean {
  const normalizedOutput = output.replace(/\\/g, '/');
  return changedFiles.some((filePath) =>
    normalizedOutput.includes(normalizeRelativePath(filePath)),
  );
}

/** Line ranges (1-based, inclusive) that the implementation changed, keyed by relative path. */
export type ChangedLineRanges = Record<string, Array<[number, number]>>;

const LINT_RANGE_MARGIN = 2;

/**
 * Parse ESLint "stylish" output into error line numbers per file.
 * Warnings are ignored — ESLint only fails the gate on errors.
 */
export function extractLintErrorLinesByFile(output: string): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  let currentFile: string | null = null;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\\/g, '/');
    // File header lines are non-indented paths.
    if (/^\S/.test(line) && /\.[a-z0-9]+$/i.test(line.trim())) {
      currentFile = line.trim();
      continue;
    }

    const match = line.match(/^\s+(\d+):\d+\s+error\s/i);
    if (match && currentFile) {
      (result[currentFile] ??= []).push(Number(match[1]));
    }
  }

  return result;
}

/**
 * Whether a scoped lint failure touches the lines the implementation actually
 * changed. Pre-existing lint debt elsewhere in a touched file must not block a
 * low-risk task (the implementer is explicitly told not to fix unrelated debt).
 * Returns null when the output cannot be parsed (caller should stay blocking).
 */
export function isLintFailureRelevantToChanges(
  output: string,
  changedLineRanges: ChangedLineRanges,
): boolean | null {
  const errorLinesByFile = extractLintErrorLinesByFile(output);
  const reportedFiles = Object.keys(errorLinesByFile);
  if (reportedFiles.length === 0) {
    return null;
  }

  for (const [reportedFile, errorLines] of Object.entries(errorLinesByFile)) {
    const normalizedReported = normalizeRelativePath(reportedFile);
    for (const [relativePath, ranges] of Object.entries(changedLineRanges)) {
      const normalizedRelative = normalizeRelativePath(relativePath);
      const sameFile =
        normalizedReported === normalizedRelative ||
        normalizedReported.endsWith(`/${normalizedRelative}`);
      if (!sameFile) {
        continue;
      }

      const hit = errorLines.some((line) =>
        ranges.some(
          ([start, end]) => line >= start - LINT_RANGE_MARGIN && line <= end + LINT_RANGE_MARGIN,
        ),
      );
      if (hit) {
        return true;
      }
    }
  }

  return false;
}

export function summarizeVerificationFailure(result: VerificationGateLike): string {
  const output = [result.stderr, result.stdout]
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!output) {
    return `${result.gate} failed with exit code ${result.exitCode}.`;
  }

  return output.split('\n').find((line) => line.trim().length > 0)?.trim() ?? output.slice(0, 200);
}

export function buildVerificationFailure(
  result: VerificationGateLike,
  files: string[],
): VerificationFailure {
  return {
    gate: result.gate,
    summary: summarizeVerificationFailure(result),
    files,
  };
}

export function buildVerificationPlan(
  task: TaskLike,
  changedFiles: string[],
): VerificationPlan {
  const policy = getTaskExecutionPolicy(task);
  const normalizedFiles = [...new Set(changedFiles.map((filePath) => normalizeRelativePath(filePath)))];

  if (policy.verificationPolicy === 'strict') {
    return {
      policy: 'strict',
      verifiedFiles: normalizedFiles,
      lintFiles: [],
      needsTypecheck: true,
      needsBuild: true,
      includeTests: true,
      includeSecurityAudit: policy.workflowId === 'highRiskWorkflow',
    };
  }

  const lintFiles = normalizedFiles.filter((filePath) => isCodeFile(filePath));
  const hasTypedFiles = lintFiles.some((filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx'));
  const hasMarkupOrStyleOnly =
    normalizedFiles.length > 0 && normalizedFiles.every((filePath) => isMarkupOrStyleFile(filePath));

  return {
    policy: 'scoped',
    verifiedFiles: normalizedFiles,
    lintFiles,
    needsTypecheck: hasTypedFiles,
    needsBuild: hasMarkupOrStyleOnly || lintFiles.length > 0,
    includeTests: false,
    includeSecurityAudit: false,
  };
}

export function classifyVerificationFailures(params: {
  policy: 'scoped' | 'strict';
  gateResults: VerificationGateLike[];
  verifiedFiles: string[];
  changedLineRanges?: ChangedLineRanges;
}): {
  blockingFailures: VerificationFailure[];
  informationalFailures: VerificationFailure[];
} {
  const blockingFailures: VerificationFailure[] = [];
  const informationalFailures: VerificationFailure[] = [];

  for (const result of params.gateResults) {
    if (result.status !== 'failed') {
      continue;
    }

    const failure = buildVerificationFailure(result, params.verifiedFiles);
    if (params.policy === 'strict') {
      blockingFailures.push(failure);
      continue;
    }

    const output = `${result.stdout}\n${result.stderr}`.trim();
    let relevant: boolean;
    if (result.gate === 'lint') {
      // Scoped lint runs only on touched files, but those files can carry
      // pre-existing lint errors. Block only when an error intersects the
      // changed lines; fall back to blocking when ranges are unavailable.
      const lintRelevance = params.changedLineRanges
        ? isLintFailureRelevantToChanges(output, params.changedLineRanges)
        : null;
      relevant = lintRelevance ?? true;
    } else {
      relevant = isFailureRelevantToFiles(output, params.verifiedFiles);
    }

    if (relevant) {
      blockingFailures.push(failure);
    } else {
      informationalFailures.push(failure);
    }
  }

  return {
    blockingFailures,
    informationalFailures,
  };
}
