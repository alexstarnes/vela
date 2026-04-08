import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { buildTaskRoutingScorecard } from '@/lib/mastra/analytics/routing-scorecards';
import { eq } from 'drizzle-orm';
import { finalizedTaskSchema, synthesizedTaskSchema } from './shared';
import { resetTaskFailureCount } from '@/lib/orchestration/escalation';

export const finalizeTaskStep = createStep({
  id: 'finalize-task',
  inputSchema: synthesizedTaskSchema,
  outputSchema: finalizedTaskSchema,
  execute: async ({ inputData }) => {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, inputData.taskId),
    });

    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    const finalStatus = inputData.outcome.statusTarget;

    await db
      .update(tasks)
      .set({
        status: finalStatus,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));

    await logTaskEvent({
      taskId: task.id,
      agentId: inputData.agentId,
      eventType: 'status_change',
      payload: {
        from: task.status,
        to: finalStatus,
        reason: inputData.outcome.reason,
      },
    });

    if (finalStatus === 'review') {
      await resetTaskFailureCount(task.id);
    }

    const scorecard = await buildTaskRoutingScorecard(task.id);
    await logTaskEvent({
      taskId: task.id,
      agentId: inputData.agentId,
      eventType: 'scorecard',
      payload: { ...scorecard },
    });

    return {
      ...inputData,
      finalStatus,
    };
  },
});
