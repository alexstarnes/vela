import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { isRouterModelAvailable } from '@/lib/mastra/router';
import { getTaskExecutionPolicy } from '@/lib/orchestration/task-shape';
import { eq } from 'drizzle-orm';
import { createWorkflowStepTelemetry, generateWithLoopCheck } from './agent-telemetry';
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
    if (inputData.outcome.kind !== 'review_ready') {
      const summary = [
        `${task.title}: ${inputData.implementationAudit.diffSummary}`,
        `Outcome: ${inputData.outcome.reason}`,
      ].join('\n\n');

      await logTaskEvent({
        taskId: task.id,
        agentId: supervisor.id,
        eventType: 'message',
        payload: { role: 'system', content: summary },
      });

      return {
        ...inputData,
        summary,
      };
    }

    const preferredOverride = synthesizeModelOverride(
      inputData.workflowSelection.workflowId,
      inputData.classification.score,
    );
    // Skip the hardcoded override when that model is disabled in model configs;
    // the router then resolves the Supervisor's configured model instead.
    const modelOverride =
      preferredOverride && (await isRouterModelAvailable(preferredOverride))
        ? preferredOverride
        : undefined;
    const { agent, resolvedModelId } = await createMastraAgent(supervisor, task, modelOverride);
    const executionPolicy = getTaskExecutionPolicy(task);
    const telemetry = createWorkflowStepTelemetry({
      taskId: task.id,
      agentId: supervisor.id,
      stepId: 'synthesize-task',
      modelConfigId: modelOverride ? null : supervisor.modelConfigId,
      resolvedModelId: modelOverride ?? resolvedModelId ?? 'anthropic/claude-sonnet-4-5',
    });

    const response = await generateWithLoopCheck(telemetry, () => agent.generate(
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
      {
        maxSteps: Math.min(
          supervisor.maxIterations ?? executionPolicy.maxSteps.synthesize,
          executionPolicy.maxSteps.synthesize,
        ),
        modelSettings: {
          maxOutputTokens: executionPolicy.maxOutputTokens.synthesize,
        },
        onStepFinish: telemetry.onStepFinish,
        onIterationComplete: telemetry.onIterationComplete,
        abortSignal: telemetry.abortSignal,
      },
    ));
    const usageTotals = telemetry.getUsageTotals();

    await logTaskEvent({
      taskId: task.id,
      agentId: supervisor.id,
      eventType: 'message',
      payload: { role: 'system', content: response.text },
    });

    return {
      ...inputData,
      summary: response.text,
      usage: {
        totalTokens: inputData.usage.totalTokens + usageTotals.totalTokens,
        totalCostUsd: (
          parseFloat(inputData.usage.totalCostUsd) + parseFloat(usageTotals.totalCostUsd)
        ).toFixed(6),
      },
    };
  },
});
