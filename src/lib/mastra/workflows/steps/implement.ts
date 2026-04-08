import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';
import { eq } from 'drizzle-orm';
import { approvedTaskSchema, implementedTaskSchema } from './shared';

export const implementTaskStep = createStep({
  id: 'implement-task',
  inputSchema: approvedTaskSchema,
  outputSchema: implementedTaskSchema,
  execute: async ({ inputData }) => {
    if (inputData.approval.status === 'requested') {
      return {
        ...inputData,
        implementationSummary: '',
        implementerModel: null,
      };
    }

    const [task, implementer] = await Promise.all([
      db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) }),
      getRuntimeAgentRow('Implementer'),
    ]);

    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    if (!implementer) {
      throw new Error('Runtime Implementer agent not found');
    }

    const { agent, provider, resolvedModelId } = await createMastraAgent(implementer, task);
    const response = await agent.generate(
      `Execute this implementation plan for the current task.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Workflow: ${inputData.workflowSelection.workflowId}

Plan:
${inputData.planText}

${inputData.repoMap?.summary ? `Repo map:\n${inputData.repoMap.summary}\n` : ''}

Requirements:
- make the necessary repository changes
- run focused commands as needed while implementing
- do not finalize the task status; verification happens after you finish
- end with a concise summary of what changed and any residual risks`,
      { maxSteps: implementer.maxIterations ?? 10 },
    );

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const rates = await getModelCostRates({
      modelConfigId: implementer.modelConfigId,
      resolvedModelId: resolvedModelId ?? provider,
    });
    const costUsd = estimateCostUsd(
      inputTokens,
      outputTokens,
      rates.inputCostPerToken,
      rates.outputCostPerToken,
    );

    await logTaskEvent({
      taskId: task.id,
      agentId: implementer.id,
      eventType: 'message',
      payload: {
        role: 'agent',
        content: response.text,
      },
      tokensUsed: inputTokens + outputTokens,
      costUsd,
    });

    return {
      ...inputData,
      implementationSummary: response.text,
      implementerModel: resolvedModelId ?? provider,
      usage: {
        totalTokens: inputData.usage.totalTokens + inputTokens + outputTokens,
        totalCostUsd: (parseFloat(inputData.usage.totalCostUsd) + parseFloat(costUsd)).toFixed(6),
      },
    };
  },
});
