import { z } from 'zod';
import type { Task } from '@/lib/db/schema';
import {
  isDependencyFile,
  isMeaningfulSourceFile,
  isToolingTask,
  normalizeRelativePath,
} from './task-shape';

type TaskLike = Pick<Task, 'title' | 'description'>;

export const implementationAuditSchema = z.object({
  changedFiles: z.array(z.string()),
  sourceFilesChanged: z.array(z.string()),
  outOfScopeChanges: z.array(z.string()),
  hasMeaningfulSourceDiff: z.boolean(),
  diffSummary: z.string(),
});

export type ImplementationAudit = z.infer<typeof implementationAuditSchema>;

const FILE_PATH_PATTERN = /(?:src|app|components|lib|styles|docs|scripts|support)\/[A-Za-z0-9_./-]+/g;

/**
 * Bare filenames with a source-like extension (e.g. "index.html",
 * "vite.config.js") — catches explicit targets that live at the repo root and
 * therefore never match the directory-prefixed pattern above.
 */
const BARE_FILENAME_PATTERN =
  /\b[A-Za-z0-9_.-]+\.(?:html|css|js|jsx|ts|tsx|mjs|cjs|md|mdx|json|svelte|vue|astro|py|rb|go|rs|java|yml|yaml|toml|txt)\b/g;

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((filePath) => normalizeRelativePath(filePath)).filter(Boolean))].sort();
}

function matchesLikelyTarget(filePath: string, likelyFiles: string[]): boolean {
  return likelyFiles.some((candidate) => {
    const normalizedCandidate = normalizeRelativePath(candidate);
    return (
      filePath === normalizedCandidate ||
      filePath.endsWith(`/${normalizedCandidate}`) ||
      normalizedCandidate.endsWith(`/${filePath}`)
    );
  });
}

export function extractLikelyFilesFromText(text: string): string[] {
  return uniquePaths([
    ...(text.match(FILE_PATH_PATTERN) ?? []),
    ...(text.match(BARE_FILENAME_PATTERN) ?? []),
  ]);
}

export function buildImplementationAudit(params: {
  changedFiles: string[];
  planText: string;
  repoMapLikelyFiles?: string[];
  /** Task title + description — files the user named are in-scope by definition. */
  taskText?: string;
}): ImplementationAudit {
  const changedFiles = uniquePaths(params.changedFiles);
  const explicitTargets = uniquePaths([
    ...(params.repoMapLikelyFiles ?? []),
    ...extractLikelyFilesFromText(params.planText),
    ...(params.taskText ? extractLikelyFilesFromText(params.taskText) : []),
  ]).filter((filePath) => !isDependencyFile(filePath));
  // Files the task explicitly targets count as meaningful even when they are
  // docs or other non-code files (e.g. documentation tasks editing .md specs).
  const sourceFilesChanged = changedFiles.filter(
    (filePath) =>
      isMeaningfulSourceFile(filePath) ||
      (!isDependencyFile(filePath) && matchesLikelyTarget(filePath, explicitTargets)),
  );
  const likelyFiles = explicitTargets.filter(
    (filePath) =>
      isMeaningfulSourceFile(filePath) || matchesLikelyTarget(filePath, changedFiles),
  );
  const scopedSourceFiles =
    likelyFiles.length > 0
      ? sourceFilesChanged.filter((filePath) => matchesLikelyTarget(filePath, likelyFiles))
      : sourceFilesChanged;
  const outOfScopeChanges = changedFiles.filter((filePath) => {
    if (isDependencyFile(filePath)) {
      return true;
    }

    return likelyFiles.length > 0 && !matchesLikelyTarget(filePath, likelyFiles);
  });

  let diffSummary = 'No repository changes were detected.';
  if (changedFiles.length > 0 && sourceFilesChanged.length === 0) {
    diffSummary = 'Only dependency or metadata files changed; no meaningful source diff was detected.';
  } else if (sourceFilesChanged.length > 0 && scopedSourceFiles.length === 0) {
    diffSummary = 'Source changes were detected, but they did not intersect the planned target area.';
  } else if (sourceFilesChanged.length > 0) {
    diffSummary = `Meaningful source diff detected in ${scopedSourceFiles.length} file(s).`;
  }

  return {
    changedFiles,
    sourceFilesChanged,
    outOfScopeChanges: uniquePaths(outOfScopeChanges),
    hasMeaningfulSourceDiff: scopedSourceFiles.length > 0,
    diffSummary,
  };
}

export function getLowRiskAuditFailure(
  task: TaskLike,
  audit: ImplementationAudit,
): string | null {
  if (audit.changedFiles.length === 0) {
    return 'The workflow reported success, but no repository diff was produced.';
  }

  if (audit.sourceFilesChanged.length === 0) {
    return 'The workflow only changed dependency or metadata files instead of the target source files.';
  }

  if (!audit.hasMeaningfulSourceDiff) {
    return 'The workflow changed source files outside the planned target area.';
  }

  if (!isToolingTask(task) && audit.outOfScopeChanges.some((filePath) => isDependencyFile(filePath))) {
    return 'The workflow modified dependency files for a non-tooling task.';
  }

  return null;
}
