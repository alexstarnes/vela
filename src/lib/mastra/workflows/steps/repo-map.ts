import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { eq } from 'drizzle-orm';
import { classifiedTaskSchema, repoMappedTaskSchema } from './shared';

function extractFilePaths(text: string): string[] {
  const matches = text.match(/(?:src|app|docs|scripts|support)\/[A-Za-z0-9_./-]+/g) ?? [];
  return [...new Set(matches)];
}

function extractBulletLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.startsWith('* '))
    .map((line) => line.replace(/^[-*]\s+/, ''))
    .slice(0, 6);
}

export const repoMapTaskStep = createStep({
  id: 'repo-map-task',
  inputSchema: classifiedTaskSchema,
  outputSchema: repoMappedTaskSchema,
  execute: async ({ inputData }) => {
    if (
      inputData.workflowSelection.workflowId === 'featureWorkflow' &&
      inputData.classification.score <= 2
    ) {
      return {
        ...inputData,
        repoMap: {
          status: 'skipped' as const,
          summary: 'Repo mapping skipped for a low-risk feature task.',
          likelyFiles: [],
          dependencyNotes: [],
        },
      };
    }

    const [task, repoMapper] = await Promise.all([
      db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) }),
      getRuntimeAgentRow('Repo Mapper'),
    ]);

    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    if (!repoMapper) {
      throw new Error('Runtime Repo Mapper agent not found');
    }

    const { agent } = await createMastraAgent(repoMapper, task);
    const response = await agent.generate(
      `Build a concise implementation map for this task.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Classification summary: ${inputData.classification.summary}

Return:
- one short summary paragraph
- a bullet list of likely files/modules
- a bullet list of dependency or boundary notes`,
      { maxSteps: Math.min(repoMapper.maxIterations ?? 6, 6) },
    );

    const repoMap = {
      status: 'complete' as const,
      summary: response.text,
      likelyFiles: extractFilePaths(response.text),
      dependencyNotes: extractBulletLines(response.text),
    };

    await logTaskEvent({
      taskId: task.id,
      agentId: repoMapper.id,
      eventType: 'repo_map',
      payload: repoMap,
    });

    return {
      ...inputData,
      repoMap,
    };
  },
});
