import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';
import { eq } from 'drizzle-orm';
import { reviewedTaskSchema, verifiedTaskSchema } from './shared';

function reviewerModelOverride(workflowId: string, score: number): string | undefined {
  if (workflowId === 'highRiskWorkflow' || score >= 6) {
    return 'anthropic/claude-sonnet-4-5';
  }

  return undefined;
}

export const reviewTaskStep = createStep({
  id: 'review-task',
  inputSchema: verifiedTaskSchema,
  outputSchema: reviewedTaskSchema,
  execute: async ({ inputData }) => {
    if (
      inputData.approval.status === 'requested' ||
      inputData.verification.status !== 'pass' ||
      !inputData.implementationSummary
    ) {
      return {
        ...inputData,
        review: {
          status: 'skipped' as const,
          summary: 'Review skipped because approval is pending or verification did not pass.',
          findings: ['Review skipped because approval is pending or verification did not pass.'],
          reviewerModel: null,
        },
      };
    }

    const [task, reviewer] = await Promise.all([
      db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) }),
      getRuntimeAgentRow('Reviewer'),
    ]);

    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    if (!reviewer) {
      throw new Error('Runtime Reviewer agent not found');
    }

    const modelOverride = reviewerModelOverride(
      inputData.workflowSelection.workflowId,
      inputData.classification.score,
    );
    const { agent, provider, resolvedModelId } = await createMastraAgent(reviewer, task, modelOverride);

    const response = await agent.generate(
      `Review the completed workflow output for correctness and risk.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Workflow: ${inputData.workflowSelection.workflowId}

Plan:
${inputData.planText}

Implementation summary:
${inputData.implementationSummary}

Verification:
${inputData.verification.gateResults.map((gate) => `- ${gate.gate}: ${gate.status}`).join('\n')}

Return:
- Findings first
- State "REVIEW_STATUS: needs_rework" if there are actionable issues or missing validation
- State "REVIEW_STATUS: pass" if no actionable issues remain`,
      { maxSteps: Math.min(reviewer.maxIterations ?? 6, 5) },
    );

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const rates = await getModelCostRates({
      modelConfigId: modelOverride ? null : reviewer.modelConfigId,
      resolvedModelId: modelOverride ?? resolvedModelId ?? provider,
    });
    const costUsd = estimateCostUsd(
      inputTokens,
      outputTokens,
      rates.inputCostPerToken,
      rates.outputCostPerToken,
    );

    const status: 'needs_rework' | 'pass' = response.text.includes('REVIEW_STATUS: needs_rework')
      ? 'needs_rework'
      : 'pass';
    const findings = response.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.replace(/^[-*]\s+/, ''));

    await logTaskEvent({
      taskId: task.id,
      agentId: reviewer.id,
      eventType: 'review',
      payload: {
        status,
        findings: response.text,
        workflow_id: inputData.workflowSelection.workflowId,
      },
      tokensUsed: inputTokens + outputTokens,
      costUsd,
    });

    return {
      ...inputData,
      review: {
        status,
        summary: response.text,
        findings: findings.length > 0 ? findings : ['none'],
        reviewerModel: modelOverride ?? resolvedModelId ?? provider,
      },
      usage: {
        totalTokens: inputData.usage.totalTokens + inputTokens + outputTokens,
        totalCostUsd: (parseFloat(inputData.usage.totalCostUsd) + parseFloat(costUsd)).toFixed(6),
      },
    };
  },
});
