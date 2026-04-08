import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';
import { eq } from 'drizzle-orm';
import { plannedTaskSchema, repoMappedTaskSchema } from './shared';

function supervisorModelOverride(workflowId: string, score: number): string | undefined {
  if (workflowId === 'highRiskWorkflow' || score >= 6) {
    return 'anthropic/claude-sonnet-4-5';
  }

  if (score <= 2) {
    return 'openai/gpt-5.4-mini';
  }

  return undefined;
}

function repoContext(summary?: string): string {
  return summary ? `Repo map summary:\n${summary}\n` : 'Repo map summary: (not provided)\n';
}

export const planTaskStep = createStep({
  id: 'plan-task',
  inputSchema: repoMappedTaskSchema,
  outputSchema: plannedTaskSchema,
  execute: async ({ inputData }) => {
    const [task, supervisor] = await Promise.all([
      db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) }),
      getRuntimeAgentRow('Supervisor'),
    ]);

    if (!task) throw new Error(`Task ${inputData.taskId} not found`);
    if (!supervisor) throw new Error('Runtime Supervisor agent not found');

    const modelOverride = supervisorModelOverride(
      inputData.workflowSelection.workflowId,
      inputData.classification.score,
    );
    const { agent, provider, resolvedModelId } = await createMastraAgent(supervisor, task, modelOverride);

    const response = await agent.generate(
      `Create a short execution plan for this task.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Workflow: ${inputData.workflowSelection.workflowId}
Classification summary: ${inputData.classification.summary}
${repoContext(inputData.repoMap?.summary)}
Return:
- 3-6 short implementation bullets
- likely files or modules to inspect first
- the smallest useful verification sequence`,
      { maxSteps: Math.min(supervisor.maxIterations ?? 6, 6) },
    );

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const rates = await getModelCostRates({
      modelConfigId: modelOverride ? null : supervisor.modelConfigId,
      resolvedModelId: modelOverride ?? resolvedModelId ?? provider,
    });
    const costUsd = estimateCostUsd(
      inputTokens,
      outputTokens,
      rates.inputCostPerToken,
      rates.outputCostPerToken,
    );

    await logTaskEvent({
      taskId: task.id,
      agentId: supervisor.id,
      eventType: 'message',
      payload: { role: 'system', content: `Supervisor plan\n\n${response.text}` },
      tokensUsed: inputTokens + outputTokens,
      costUsd,
    });

    return {
      ...inputData,
      planText: response.text,
      supervisorModel: modelOverride ?? resolvedModelId ?? provider,
      usage: {
        totalTokens: inputTokens + outputTokens,
        totalCostUsd: costUsd,
      },
    };
  },
});
