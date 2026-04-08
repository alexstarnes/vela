import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';
import { logTaskEvent } from '@/lib/events/logger';
import { eq } from 'drizzle-orm';
import { debugDiagnosedTaskSchema, debugHypothesesTaskSchema } from './shared';

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

export const diagnoseDebugTaskStep = createStep({
  id: 'diagnose-debug-task',
  inputSchema: debugHypothesesTaskSchema,
  outputSchema: debugDiagnosedTaskSchema,
  execute: async ({ inputData }) => {
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

    const { agent, provider, resolvedModelId } = await createMastraAgent(
      repoMapper,
      task,
      'openai/gpt-4o-mini',
    );
    const response = await agent.generate(
      `Investigate the repository for this bug and summarize evidence against the current hypotheses.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Hypotheses:
${inputData.debug.hypotheses.map((item) => `- ${item}`).join('\n')}

Return:
Summary:
- one short paragraph

Patch Plan:
- 3-5 short bullets`,
      { maxSteps: Math.min(repoMapper.maxIterations ?? 6, 4) },
    );

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const rates = await getModelCostRates({
      modelConfigId: repoMapper.modelConfigId,
      resolvedModelId: resolvedModelId ?? provider,
    });
    const costUsd = estimateCostUsd(
      inputTokens,
      outputTokens,
      rates.inputCostPerToken,
      rates.outputCostPerToken,
    );

    const [summarySection, planSection] = response.text.split('Patch Plan:');
    const diagnosticsSummary = summarySection.replace(/^Summary:\s*/i, '').trim();
    const patchPlan = planSection
      ? planSection.trim()
      : '- Reproduce the issue\n- Narrow the failing path\n- Patch the most likely root cause';

    const repoMap = {
      status: 'complete' as const,
      summary: diagnosticsSummary || response.text.trim(),
      likelyFiles: extractFilePaths(response.text),
      dependencyNotes: extractBulletLines(response.text),
    };

    await logTaskEvent({
      taskId: task.id,
      agentId: repoMapper.id,
      eventType: 'repo_map',
      payload: {
        diagnosticsSummary,
        repoMap,
      },
      tokensUsed: inputTokens + outputTokens,
      costUsd,
    });

    return {
      ...inputData,
      repoMap,
      planText: patchPlan,
      supervisorModel: inputData.supervisorModel,
      usage: {
        totalTokens: inputData.usage.totalTokens + inputTokens + outputTokens,
        totalCostUsd: (parseFloat(inputData.usage.totalCostUsd) + parseFloat(costUsd)).toFixed(6),
      },
      debug: {
        ...inputData.debug,
        diagnosticsSummary,
      },
    };
  },
});
