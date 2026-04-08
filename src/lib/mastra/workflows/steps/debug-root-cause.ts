import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';
import { logTaskEvent } from '@/lib/events/logger';
import { eq } from 'drizzle-orm';
import { approvedTaskSchema, debugDiagnosedTaskSchema } from './shared';

export const selectDebugRootCauseStep = createStep({
  id: 'select-debug-root-cause',
  inputSchema: debugDiagnosedTaskSchema,
  outputSchema: approvedTaskSchema,
  execute: async ({ inputData }) => {
    const [task, supervisor] = await Promise.all([
      db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) }),
      getRuntimeAgentRow('Supervisor'),
    ]);

    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    if (!supervisor) {
      throw new Error('Runtime Supervisor agent not found');
    }

    const { agent, provider, resolvedModelId } = await createMastraAgent(
      supervisor,
      task,
      'anthropic/claude-sonnet-4-5',
    );
    const response = await agent.generate(
      `Pick the most likely root cause and produce a concise patch plan.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Hypotheses:
${inputData.debug.hypotheses.map((item) => `- ${item}`).join('\n')}

Diagnostics summary:
${inputData.debug.diagnosticsSummary || inputData.repoMap?.summary || '(none)'}

Return:
Root Cause:
- one short paragraph

Patch Plan:
- 3-5 short bullets`,
      { maxSteps: Math.min(supervisor.maxIterations ?? 6, 4) },
    );

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const rates = await getModelCostRates({
      modelConfigId: supervisor.modelConfigId,
      resolvedModelId: resolvedModelId ?? provider,
    });
    const costUsd = estimateCostUsd(
      inputTokens,
      outputTokens,
      rates.inputCostPerToken,
      rates.outputCostPerToken,
    );

    const [rootCauseSection, planSection] = response.text.split('Patch Plan:');
    const rootCause = rootCauseSection.replace(/^Root Cause:\s*/i, '').trim();
    const planText = planSection
      ? `Root cause:\n${rootCause}\n\nPatch plan:\n${planSection.trim()}`
      : `Root cause:\n${rootCause}`;

    await logTaskEvent({
      taskId: task.id,
      agentId: supervisor.id,
      eventType: 'message',
      payload: {
        role: 'system',
        content: `Debug root cause\n\n${response.text}`,
      },
      tokensUsed: inputTokens + outputTokens,
      costUsd,
    });

    return {
      taskId: inputData.taskId,
      agentId: inputData.agentId,
      heartbeatId: inputData.heartbeatId,
      classification: inputData.classification,
      workflowKind: inputData.workflowKind,
      workflowSelection: inputData.workflowSelection,
      routingAdjustment: inputData.routingAdjustment,
      repoMap: inputData.repoMap,
      planText,
      supervisorModel: resolvedModelId ?? provider,
      usage: {
        totalTokens: inputData.usage.totalTokens + inputTokens + outputTokens,
        totalCostUsd: (parseFloat(inputData.usage.totalCostUsd) + parseFloat(costUsd)).toFixed(6),
      },
      approval: {
        status: 'not_required' as const,
        reason: `Debug workflow root cause selected: ${rootCause}`,
      },
    };
  },
});
