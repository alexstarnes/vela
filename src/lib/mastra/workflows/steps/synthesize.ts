import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';
import { eq } from 'drizzle-orm';
import { reviewedOutcomeWorkflowSchema, workflowOutputSchema } from './shared';

function synthesizeModelOverride(workflowId: string, score: number): string | undefined {
  if (workflowId === 'highRiskWorkflow' || score >= 6) {
    return 'anthropic/claude-sonnet-4-5';
  }

  if (score <= 2) {
    return 'openai/gpt-5.4-mini';
  }

  return undefined;
}

export const synthesizeTaskStep = createStep({
  id: 'synthesize-task',
  inputSchema: reviewedOutcomeWorkflowSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const [task, supervisor] = await Promise.all([
      db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) }),
      getRuntimeAgentRow('Supervisor'),
    ]);

    if (!task) throw new Error(`Task ${inputData.taskId} not found`);
    if (!supervisor) throw new Error('Runtime Supervisor agent not found');

    const modelOverride = synthesizeModelOverride(
      inputData.workflowSelection.workflowId,
      inputData.classification.score,
    );
    const { agent, resolvedModelId } = await createMastraAgent(supervisor, task, modelOverride);

    const response = await agent.generate(
      `Summarize the completed workflow run.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Workflow: ${inputData.workflowSelection.workflowId}
Plan:
${inputData.planText}

${inputData.repoMap?.summary ? `Repo map:\n${inputData.repoMap.summary}\n` : ''}
${'implementationSummary' in inputData && inputData.implementationSummary ? `Implementation summary:\n${inputData.implementationSummary}\n` : ''}
Verification status: ${'verification' in inputData ? inputData.verification.status : 'skipped'}
Review status: ${'review' in inputData ? inputData.review.status : 'skipped'}
Approval status: ${inputData.approval.status}
Outcome: ${inputData.outcome.reason}

Return:
- 1 short paragraph on what changed
- 1 short paragraph on the outcome and next action`,
      { maxSteps: Math.min(supervisor.maxIterations ?? 6, 4) },
    );

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const rates = await getModelCostRates({
      modelConfigId: modelOverride ? null : supervisor.modelConfigId,
      resolvedModelId: modelOverride ?? resolvedModelId ?? 'anthropic/claude-sonnet-4-5',
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
      payload: { role: 'system', content: response.text },
      tokensUsed: inputTokens + outputTokens,
      costUsd,
    });

    return {
      ...inputData,
      summary: response.text,
      usage: {
        totalTokens: inputData.usage.totalTokens + inputTokens + outputTokens,
        totalCostUsd: (parseFloat(inputData.usage.totalCostUsd) + parseFloat(costUsd)).toFixed(6),
      },
    };
  },
});
