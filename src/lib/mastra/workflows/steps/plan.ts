import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { isRouterModelAvailable } from '@/lib/mastra/router';
import { buildLowRiskDeterministicPlan } from '@/lib/orchestration/low-risk-discovery';
import { getTaskExecutionPolicy } from '@/lib/orchestration/task-shape';
import { eq } from 'drizzle-orm';
import { createWorkflowStepTelemetry } from './agent-telemetry';
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

    const executionPolicy = getTaskExecutionPolicy(task);
    if (executionPolicy.isLowRiskFeature) {
      const planText = buildLowRiskDeterministicPlan(task, inputData.repoMap);
      await logTaskEvent({
        taskId: task.id,
        agentId: supervisor.id,
        eventType: 'message',
        payload: { role: 'system', content: `Supervisor plan\n\n${planText}` },
      });

      return {
        ...inputData,
        planText,
        supervisorModel: 'deterministic/low-risk-plan',
        usage: {
          totalTokens: 0,
          totalCostUsd: '0.000000',
        },
      };
    }

    const preferredOverride = supervisorModelOverride(
      inputData.workflowSelection.workflowId,
      inputData.classification.score,
    );
    // Skip the hardcoded override when that model is disabled in model configs;
    // the router then resolves the Supervisor's configured model instead.
    const modelOverride =
      preferredOverride && (await isRouterModelAvailable(preferredOverride))
        ? preferredOverride
        : undefined;
    const { agent, provider, resolvedModelId } = await createMastraAgent(supervisor, task, modelOverride);
    const telemetry = createWorkflowStepTelemetry({
      taskId: task.id,
      agentId: supervisor.id,
      stepId: 'plan-task',
      modelConfigId: modelOverride ? null : supervisor.modelConfigId,
      resolvedModelId: modelOverride ?? resolvedModelId ?? provider,
    });

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
      {
        maxSteps: Math.min(
          supervisor.maxIterations ?? executionPolicy.maxSteps.plan,
          executionPolicy.maxSteps.plan,
        ),
        modelSettings: {
          maxOutputTokens: executionPolicy.maxOutputTokens.plan,
        },
        onStepFinish: telemetry.onStepFinish,
        onIterationComplete: telemetry.onIterationComplete,
        abortSignal: telemetry.abortSignal,
      },
    );
    const usageTotals = telemetry.getUsageTotals();
    const planText = response.text.trim()
      ? response.text
      : buildLowRiskDeterministicPlan(task, inputData.repoMap);

    await logTaskEvent({
      taskId: task.id,
      agentId: supervisor.id,
      eventType: 'message',
      payload: { role: 'system', content: `Supervisor plan\n\n${planText}` },
    });

    return {
      ...inputData,
      planText,
      supervisorModel: modelOverride ?? resolvedModelId ?? provider,
      usage: {
        totalTokens: usageTotals.totalTokens,
        totalCostUsd: usageTotals.totalCostUsd,
      },
    };
  },
});
