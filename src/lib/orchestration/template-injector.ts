import { playbookMarkdownWithoutCorePrompt } from '@/lib/agent-orchestration/reference-docs';
import type { Task } from '@/lib/db/schema';

type TemplateTarget = 'Implementer' | 'Reviewer';

const BASE_TEMPLATE_RULES: Array<{ agentName: string; patterns: string[] }> = [
  {
    agentName: 'Frontend Engineer',
    patterns: ['react', 'next', 'frontend', 'component', 'layout', 'page', 'ui', 'tailwind'],
  },
  {
    agentName: 'Backend Engineer',
    patterns: ['api', 'backend', 'route', 'server', 'action', 'service', 'endpoint'],
  },
  {
    agentName: 'Database Engineer',
    patterns: ['schema', 'migration', 'drizzle', 'database', 'sql', 'table', 'query', 'rls'],
  },
  {
    agentName: 'DevOps Engineer',
    patterns: ['deploy', 'railway', 'docker', 'ci', 'env', 'infrastructure', 'cron'],
  },
];

const SECURITY_PATTERNS = [
  'auth',
  'login',
  'permission',
  'payment',
  'billing',
  'stripe',
  'rls',
  'secret',
  'credential',
  'security',
  'schema',
  'production',
  'infrastructure',
];

const PERFORMANCE_PATTERNS = [
  'performance',
  'latency',
  'bundle',
  'slow',
  'render',
  'memory',
  'optimize',
  'throughput',
];

function taskText(task: Pick<Task, 'title' | 'description'>): string {
  return `${task.title}\n${task.description ?? ''}`.toLowerCase();
}

function buildTemplateBlock(agentName: string): string | null {
  const markdown = playbookMarkdownWithoutCorePrompt(agentName);
  return markdown ? `## Specialist Template: ${agentName}\n\n${markdown.trim()}` : null;
}

export function injectTaskTemplates(
  task: Pick<Task, 'title' | 'description'>,
  target: TemplateTarget,
): string[] {
  const text = taskText(task);
  const selected = new Set<string>();

  for (const rule of BASE_TEMPLATE_RULES) {
    if (rule.patterns.some((pattern) => text.includes(pattern))) {
      selected.add(rule.agentName);
    }
  }

  if (target === 'Reviewer') {
    selected.add('Code Reviewer');
  }

  if (SECURITY_PATTERNS.some((pattern) => text.includes(pattern))) {
    selected.add('Security Auditor');
  }

  if (PERFORMANCE_PATTERNS.some((pattern) => text.includes(pattern))) {
    selected.add('Performance Engineer');
  }

  return Array.from(selected)
    .map((agentName) => buildTemplateBlock(agentName))
    .filter((entry): entry is string => Boolean(entry));
}

export function injectImplementationTemplates(
  task: Pick<Task, 'title' | 'description'>,
): string[] {
  return injectTaskTemplates(task, 'Implementer');
}

export function injectReviewerTemplates(
  task: Pick<Task, 'title' | 'description'>,
): string[] {
  return injectTaskTemplates(task, 'Reviewer');
}
