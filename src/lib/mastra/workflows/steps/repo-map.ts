import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { projects, tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { runWorkspaceCommand } from '@/lib/helper/client';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { getTaskExecutionPolicy } from '@/lib/orchestration/task-shape';
import {
  extractExplicitFileTargets,
  extractTaskSearchTerms,
  isFileCreationTask,
} from '@/lib/orchestration/low-risk-discovery';
import { eq } from 'drizzle-orm';
import { createWorkflowStepTelemetry, generateWithLoopCheck } from './agent-telemetry';
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

function extractMatchedFiles(stdout: string): string[] {
  const files = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(':', 2)[0] ?? '')
    .filter(Boolean);

  return [...new Set(files)].slice(0, 8);
}

async function searchWorkspaceForTerm(workspacePath: string, term: string): Promise<string[]> {
  const result = await runWorkspaceCommand({
    workspacePath,
    command: 'rg',
    args: [
      '-n',
      '-i',
      '--no-heading',
      '--glob',
      '!node_modules/**',
      '--glob',
      '!.git/**',
      '--glob',
      '!dist/**',
      term,
      '.',
    ],
  });

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return [];
  }

  return extractMatchedFiles(result.stdout);
}

async function buildLowRiskRepoMap(task: { title: string; description: string | null; projectId: string }) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, task.projectId),
  });

  if (!project?.workspacePath) {
    return {
      status: 'complete' as const,
      summary: 'No connected workspace was available for deterministic target discovery.',
      likelyFiles: [],
      dependencyNotes: ['Do not modify unrelated files when the workspace target cannot be inspected'],
    };
  }

  if (isFileCreationTask(task)) {
    const targets = extractExplicitFileTargets(task);
    return {
      status: 'complete' as const,
      summary: `Task requests creating new file(s)${targets.length > 0 ? `: ${targets.join(', ')}` : ''}. No existing repository target needs to be located.`,
      likelyFiles: targets,
      dependencyNotes: [
        'Create the requested file(s); absent repository matches are expected for new files',
        'Do not modify unrelated existing files',
      ],
    };
  }

  const terms = extractTaskSearchTerms(task);
  const matchedFiles = new Set<string>();

  // Files the task names explicitly are the target by definition — verify
  // they exist in the workspace and put them first.
  for (const target of extractExplicitFileTargets(task)) {
    const probe = await runWorkspaceCommand({
      workspacePath: project.workspacePath,
      command: 'test',
      args: ['-f', target],
    });
    if (probe.exitCode === 0) {
      matchedFiles.add(target);
    }
  }

  for (const term of terms.slice(0, 6)) {
    const files = await searchWorkspaceForTerm(project.workspacePath, term);
    for (const filePath of files) {
      matchedFiles.add(filePath);
    }
    if (matchedFiles.size >= 8) {
      break;
    }
  }

  const likelyFiles = [...matchedFiles].slice(0, 8);
  const noDirectMatch = likelyFiles.length === 0;

  return {
    status: 'complete' as const,
    summary: noDirectMatch
      ? `No direct repository matches were found for task terms: ${terms.join(', ') || 'none'}. Stop instead of editing a nearby component.`
      : `Direct repository matches were found for task terms: ${terms.join(', ')}.`,
    likelyFiles,
    dependencyNotes: noDirectMatch
      ? [
          'No exact target file was found from deterministic search',
          'Do not create new placeholder UI or modify a nearby section as a fallback',
        ]
      : [
          'Start with the directly matched files before exploring adjacent components',
          'Do not modify unrelated sections unless a matched file clearly imports the target',
        ],
  };
}

export const repoMapTaskStep = createStep({
  id: 'repo-map-task',
  inputSchema: classifiedTaskSchema,
  outputSchema: repoMappedTaskSchema,
  execute: async ({ inputData }) => {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) });

    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    const executionPolicy = getTaskExecutionPolicy(task);

    if (executionPolicy.isLowRiskFeature) {
      const repoMap = await buildLowRiskRepoMap(task);
      await logTaskEvent({
        taskId: task.id,
        agentId: inputData.agentId,
        eventType: 'repo_map',
        payload: repoMap,
      });

      return {
        ...inputData,
        repoMap,
      };
    }

    const repoMapper = await getRuntimeAgentRow('Repo Mapper');

    if (!repoMapper) {
      throw new Error('Runtime Repo Mapper agent not found');
    }

    const { agent, provider, resolvedModelId } = await createMastraAgent(repoMapper, task);
    const telemetry = createWorkflowStepTelemetry({
      taskId: task.id,
      agentId: repoMapper.id,
      stepId: 'repo-map-task',
      modelConfigId: repoMapper.modelConfigId,
      resolvedModelId: resolvedModelId ?? provider,
    });
    const response = await generateWithLoopCheck(telemetry, () => agent.generate(
      `Build a concise implementation map for this task.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Classification summary: ${inputData.classification.summary}

Return:
- one short summary paragraph
- a bullet list of likely files/modules
- a bullet list of dependency or boundary notes`,
      {
        maxSteps: Math.min(
          repoMapper.maxIterations ?? executionPolicy.maxSteps.repoMap,
          executionPolicy.maxSteps.repoMap,
        ),
        modelSettings: {
          maxOutputTokens: executionPolicy.maxOutputTokens.repoMap,
        },
        onStepFinish: telemetry.onStepFinish,
        onIterationComplete: telemetry.onIterationComplete,
        abortSignal: telemetry.abortSignal,
      },
    ));

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
