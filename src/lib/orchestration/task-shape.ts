import type { Task } from '@/lib/db/schema';
import { classifyTaskMode, type ModeClassification } from './mode-classifier';
import type { ExecutionTier } from './model-selection';
import {
  selectWorkflowForClassification,
  type WorkflowId,
} from './workflow-selector';

type TaskLike = Pick<Task, 'title' | 'description'>;

const TOOLING_PATTERNS = [
  'dependency',
  'dependencies',
  'package',
  'package.json',
  'lockfile',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'eslint',
  'vite',
  'typescript',
  'tsconfig',
  'tooling',
  'devdependency',
  'install',
  'upgrade',
  'version bump',
];

const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.mdx',
];

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const MARKUP_STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.html', '.mdx'];
const SOURCE_PREFIXES = ['src/', 'app/', 'components/', 'lib/', 'styles/'];

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'npm-shrinkwrap.json',
]);

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function taskText(task: TaskLike): string {
  return `${task.title}\n${task.description ?? ''}`.toLowerCase();
}

export function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.?\//, '');
}

export function isDependencyFile(filePath: string): boolean {
  return DEPENDENCY_FILES.has(normalizeRelativePath(filePath));
}

export function isCodeFile(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return CODE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

export function isMarkupOrStyleFile(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return MARKUP_STYLE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

export function isMeaningfulSourceFile(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  if (isDependencyFile(normalized)) {
    return false;
  }

  return (
    SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    SOURCE_EXTENSIONS.some((ext) => normalized.endsWith(ext))
  );
}

export interface TaskExecutionPolicy {
  classification: ModeClassification;
  workflowId: WorkflowId;
  isLowRiskFeature: boolean;
  isToolingTask: boolean;
  compactPrompt: boolean;
  verificationPolicy: 'scoped' | 'strict';
  maxSteps: {
    repoMap: number;
    plan: number;
    implement: number;
    review: number;
    synthesize: number;
  };
  maxOutputTokens: {
    repoMap: number;
    plan: number;
    implement: number;
    review: number;
    synthesize: number;
  };
  stepTierFloors: {
    implement: ExecutionTier;
  };
  implementerBudget:
    | {
        maxTokens: number;
        maxCostUsd: number;
      }
    | null;
}

export function isToolingTask(task: TaskLike): boolean {
  return includesAny(taskText(task), TOOLING_PATTERNS);
}

export function getTaskExecutionPolicy(task: TaskLike): TaskExecutionPolicy {
  const classification = classifyTaskMode(task);
  const workflowSelection = selectWorkflowForClassification(classification);
  const lowRiskFeature =
    workflowSelection.workflowId === 'featureWorkflow' &&
    classification.score <= 2 &&
    classification.riskFlags.length === 0;

  return {
    classification,
    workflowId: workflowSelection.workflowId,
    isLowRiskFeature: lowRiskFeature,
    isToolingTask: isToolingTask(task),
    compactPrompt: lowRiskFeature,
    verificationPolicy: lowRiskFeature ? 'scoped' : 'strict',
    maxSteps: {
      repoMap: lowRiskFeature ? 2 : 6,
      plan: lowRiskFeature ? 2 : 6,
      implement: lowRiskFeature ? 12 : 10,
      review: lowRiskFeature ? 4 : 5,
      synthesize: lowRiskFeature ? 2 : 4,
    },
    maxOutputTokens: {
      repoMap: lowRiskFeature ? 400 : 700,
      plan: lowRiskFeature ? 500 : 900,
      implement: lowRiskFeature ? 2048 : 4096,
      review: lowRiskFeature ? 700 : 1000,
      synthesize: lowRiskFeature ? 250 : 500,
    },
    stepTierFloors: {
      implement: 'standard',
    },
    implementerBudget: lowRiskFeature
      ? {
          maxTokens: 60_000,
          maxCostUsd: 0.2,
        }
      : null,
  };
}
