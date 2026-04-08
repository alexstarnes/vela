import { z } from 'zod';
import type { Task } from '@/lib/db/schema';

const riskFlagSchema = z.enum([
  'auth',
  'payments',
  'rls',
  'secrets',
  'security',
  'schema',
  'infrastructure',
  'debug',
]);

export const modeClassificationSchema = z.object({
  ambiguity: z.number().int().min(0).max(2),
  blastRadius: z.number().int().min(0).max(2),
  crossStackComplexity: z.number().int().min(0).max(2),
  verificationDifficulty: z.number().int().min(0).max(2),
  score: z.number().int().min(0).max(8),
  mode: z.enum(['single_agent', 'delegated', 'delegated_premium', 'team']),
  recommendedTier: z.enum(['fast', 'standard', 'premium']),
  riskFlags: z.array(riskFlagSchema),
  summary: z.string(),
});

export type ModeClassification = z.infer<typeof modeClassificationSchema>;

const HIGH_AMBIGUITY_PATTERNS = [
  'investigate',
  'explore',
  'research',
  'not sure',
  'unclear',
  'figure out',
  'diagnose',
];

const MEDIUM_AMBIGUITY_PATTERNS = [
  'update',
  'migrate',
  'refactor',
  'improve',
  'orchestration',
  'workflow',
];

const FRONTEND_PATTERNS = ['ui', 'frontend', 'react', 'nextjs', 'next.js', 'component', 'page', 'layout', 'client-side', 'tailwind', 'css', 'styling'];
const BACKEND_PATTERNS = ['api', 'backend', 'server', 'route', 'action', 'service', 'endpoint'];
const DATABASE_PATTERNS = ['database', 'schema', 'migration', 'sql', 'drizzle', 'table', 'postgres', 'supabase'];
const INFRA_PATTERNS = ['deploy', 'ci/cd', 'ci pipeline', 'infra', 'infrastructure', 'railway', 'docker', 'cron', 'scheduler', 'production', 'env var', 'environment variable'];

const RISK_PATTERNS: Array<{ flag: z.infer<typeof riskFlagSchema>; patterns: string[] }> = [
  { flag: 'auth', patterns: ['auth', 'login', 'session', 'token', 'oauth', 'permission'] },
  { flag: 'payments', patterns: ['payment', 'billing', 'stripe', 'checkout'] },
  { flag: 'rls', patterns: ['rls', 'row level security'] },
  { flag: 'secrets', patterns: ['secret', 'api key', 'credential', 'private key'] },
  { flag: 'security', patterns: ['security', 'vulnerability', 'xss', 'csrf', 'injection'] },
  { flag: 'schema', patterns: ['schema', 'migration', 'database'] },
  { flag: 'infrastructure', patterns: ['deploy', 'infrastructure', 'railway', 'ci/cd', 'ci pipeline', 'docker', 'production'] },
  { flag: 'debug', patterns: ['debug', 'bug report', 'incident', 'fix crash', 'triage', 'broken', 'regression'] },
];

function matchesWord(text: string, pattern: string): boolean {
  return new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
}

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesWord(text, pattern));
}

function countMatchedGroups(text: string): number {
  return [FRONTEND_PATTERNS, BACKEND_PATTERNS, DATABASE_PATTERNS, INFRA_PATTERNS].reduce(
    (count, group) => count + (includesAny(text, group) ? 1 : 0),
    0,
  );
}

function taskText(task: Pick<Task, 'title' | 'description'>): string {
  return `${task.title}\n${task.description ?? ''}`.toLowerCase();
}

export function classifyTaskMode(task: Pick<Task, 'title' | 'description'>): ModeClassification {
  const text = taskText(task);
  const riskFlags = RISK_PATTERNS
    .filter(({ patterns }) => includesAny(text, patterns))
    .map(({ flag }) => flag);

  const ambiguity = includesAny(text, HIGH_AMBIGUITY_PATTERNS)
    ? 2
    : includesAny(text, MEDIUM_AMBIGUITY_PATTERNS)
      ? 1
      : 0;

  const stackCount = countMatchedGroups(text);
  const crossStackComplexity = stackCount >= 3 ? 2 : stackCount === 2 ? 1 : 0;

  const blastRadius = riskFlags.length > 0 || includesAny(text, ['orchestration', 'heartbeat', 'workflow', 'scheduler'])
    ? 2
    : stackCount >= 2 || includesAny(text, ['refactor', 'migration', 'router'])
      ? 1
      : 0;

  const verificationDifficulty = includesAny(text, ['security', 'auth', 'payment', 'schema', 'migration', 'integration'])
    ? 2
    : includesAny(text, ['build', 'typecheck', 'lint', 'workflow', 'tests'])
      ? 1
      : 0;

  const score = ambiguity + blastRadius + crossStackComplexity + verificationDifficulty;

  const mode =
    score <= 2
      ? 'single_agent'
      : score <= 5
        ? 'delegated'
        : score <= 7
          ? 'delegated_premium'
          : 'team';

  const recommendedTier =
    riskFlags.length > 0 || score >= 6
      ? 'premium'
      : score >= 3
        ? 'standard'
        : 'fast';

  const summary = riskFlags.length > 0
    ? `Classified as ${mode} (${score}/8) with risk flags: ${riskFlags.join(', ')}.`
    : `Classified as ${mode} (${score}/8) with ${recommendedTier} tier routing.`;

  return {
    ambiguity,
    blastRadius,
    crossStackComplexity,
    verificationDifficulty,
    score,
    mode,
    recommendedTier,
    riskFlags,
    summary,
  };
}
