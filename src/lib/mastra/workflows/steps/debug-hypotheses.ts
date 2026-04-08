import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';
import { logTaskEvent } from '@/lib/events/logger';
import { eq } from 'drizzle-orm';
import { classifiedTaskSchema, debugHypothesesTaskSchema } from './shared';

function parseHypotheses(text: string) {
  return text
    .split('\n')
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 4);
}

export const generateDebugHypothesesStep = createStep({
  id: 'generate-debug-hypotheses',
  inputSchema: classifiedTaskSchema,
  outputSchema: debugHypothesesTaskSchema,
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
      `Generate 2-4 likely root-cause hypotheses for this bug or incident.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}

Return one hypothesis per line prefixed with "- ".`,
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

    await logTaskEvent({
      taskId: task.id,
      agentId: supervisor.id,
      eventType: 'message',
      payload: {
        role: 'system',
        content: `Debug hypotheses\n\n${response.text}`,
      },
      tokensUsed: inputTokens + outputTokens,
      costUsd,
    });

    return {
      ...inputData,
      debug: {
        hypotheses: parseHypotheses(response.text),
        diagnosticsSummary: '',
        rootCause: '',
      },
      supervisorModel: resolvedModelId ?? provider,
      usage: {
        totalTokens: inputTokens + outputTokens,
        totalCostUsd: costUsd,
      },
    };
  },
});
