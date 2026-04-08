import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@/lib/db/schema';

const TASK_MATCHERS: Array<{ fileName: string; patterns: string[] }> = [
  {
    fileName: 'web.md',
    patterns: ['react', 'next', 'ui', 'frontend', 'component', 'page', 'layout', 'tailwind', 'web'],
  },
  {
    fileName: 'ios.md',
    patterns: ['ios', 'swift', 'swiftui', 'xcode', 'iphone', 'ipad', 'apple'],
  },
  {
    fileName: 'supabase.md',
    patterns: ['supabase', 'rls', 'postgres', 'auth', 'storage', 'edge function'],
  },
];

function docsRoot(): string {
  return path.join(process.cwd(), 'docs');
}

function playbookPath(fileName: string): string {
  return path.join(docsRoot(), 'agent-playbooks', fileName);
}

function readIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf8').trim();
}

function taskText(task: Pick<Task, 'title' | 'description'>): string {
  return `${task.title}\n${task.description ?? ''}`.toLowerCase();
}

export function loadRepoGuidanceMarkdown(task: Pick<Task, 'title' | 'description'>): string[] {
  const text = taskText(task);
  const docs: string[] = [];

  const definitionOfDone = readIfExists(path.join(docsRoot(), 'definition-of-done.md'));
  if (definitionOfDone) {
    docs.push(`## Definition Of Done\n\n${definitionOfDone}`);
  }

  const architecture = readIfExists(path.join(docsRoot(), 'architecture.md'));
  if (architecture) {
    docs.push(`## Architecture Notes\n\n${architecture}`);
  }

  for (const matcher of TASK_MATCHERS) {
    if (matcher.patterns.some((pattern) => text.includes(pattern))) {
      const playbook = readIfExists(playbookPath(matcher.fileName));
      if (playbook) {
        docs.push(`## Stack Playbook: ${matcher.fileName.replace('.md', '')}\n\n${playbook}`);
      }
    }
  }

  return docs;
}
