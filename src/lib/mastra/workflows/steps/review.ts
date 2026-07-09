import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { isRouterModelAvailable } from '@/lib/mastra/router';
import { getTaskExecutionPolicy } from '@/lib/orchestration/task-shape';
import { eq } from 'drizzle-orm';
import { createWorkflowStepTelemetry } from './agent-telemetry';
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

    const preferredOverride = reviewerModelOverride(
      inputData.workflowSelection.workflowId,
      inputData.classification.score,
    );
    // Skip the hardcoded override when that model is disabled in model configs.
    const modelOverride =
      preferredOverride && (await isRouterModelAvailable(preferredOverride))
        ? preferredOverride
        : undefined;
    const { agent, provider, resolvedModelId } = await createMastraAgent(reviewer, task, modelOverride);
    const executionPolicy = getTaskExecutionPolicy(task);
    const telemetry = createWorkflowStepTelemetry({
      taskId: task.id,
      agentId: reviewer.id,
      stepId: 'review-task',
      modelConfigId: modelOverride ? null : reviewer.modelConfigId,
      resolvedModelId: modelOverride ?? resolvedModelId ?? provider,
    });

    const blockingSection =
      inputData.verification.blockingFailures.length > 0
        ? inputData.verification.blockingFailures
            .map((failure) => `- ${failure.gate}: ${failure.summary}`)
            .join('\n')
        : '- none';
    const informationalSection =
      inputData.verification.informationalFailures.length > 0
        ? inputData.verification.informationalFailures
            .map(
              (failure) =>
                `- ${failure.gate}: pre-existing issues outside this change's scope`,
            )
            .join('\n')
        : '- none';

    const response = await agent.generate(
      `Review the completed workflow output for correctness and risk.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Workflow: ${inputData.workflowSelection.workflowId}

Plan:
${inputData.planText}

Implementation summary:
${inputData.implementationSummary}

Verification gates (already classified deterministically, policy: ${inputData.verification.policy}):
${inputData.verification.gateResults.map((gate) => `- ${gate.gate}: ${gate.status}`).join('\n')}
Blocking failures (attributable to this change):
${blockingSection}
Informational failures (pre-existing repo issues, already ruled out of scope by the verification gate):
${informationalSection}

Review rules:
- Judge ONLY the change made for this task (the diff), not overall repository health.
- Informational failures are pre-existing and out of scope — do NOT request rework for them, even if a gate reports "failed" because of them.
- Request rework only for actionable defects in the changed files/lines themselves: incorrect logic, unhandled edge cases, plan deviations, or missing validation introduced by this change.

Return:
- Findings first
- State "REVIEW_STATUS: needs_rework" if there are actionable issues attributable to this change
- State "REVIEW_STATUS: pass" if no actionable issues remain`,
      {
        maxSteps: Math.min(
          reviewer.maxIterations ?? executionPolicy.maxSteps.review,
          executionPolicy.maxSteps.review,
        ),
        modelSettings: {
          maxOutputTokens: executionPolicy.maxOutputTokens.review,
        },
        onStepFinish: telemetry.onStepFinish,
        onIterationComplete: telemetry.onIterationComplete,
        abortSignal: telemetry.abortSignal,
      },
    );
    const usageTotals = telemetry.getUsageTotals();

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
        totalTokens: inputData.usage.totalTokens + usageTotals.totalTokens,
        totalCostUsd: (
          parseFloat(inputData.usage.totalCostUsd) + parseFloat(usageTotals.totalCostUsd)
        ).toFixed(6),
      },
    };
  },
});
