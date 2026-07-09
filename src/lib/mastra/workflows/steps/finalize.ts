import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { buildTaskRoutingScorecard } from '@/lib/mastra/analytics/routing-scorecards';
import { eq } from 'drizzle-orm';
import { finalizedTaskSchema, synthesizedTaskSchema } from './shared';
import {
  incrementTaskFailureCount,
  resetTaskFailureCount,
} from '@/lib/orchestration/escalation';

/**
 * Failure count at which a requeued task stops retrying and waits for a human.
 * Sits above the tier-escalation ladder (bump at 2, premium at 4) so the
 * premium tier gets one attempt before we give up.
 */
const REQUEUE_FAILURE_LIMIT = 5;

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

    let finalStatus = inputData.outcome.statusTarget;
    let statusReason = inputData.outcome.reason;

    if (inputData.outcome.kind === 'requeue') {
      // Verification blocking failures increment in the verify step;
      // reviewer-requested rework is counted here so requeues stay bounded.
      const failureCount =
        inputData.review.status === 'needs_rework'
          ? await incrementTaskFailureCount(task.id)
          : task.failureCount;

      if (failureCount >= REQUEUE_FAILURE_LIMIT) {
        finalStatus = 'waiting_for_human';
        statusReason = `Requeue limit reached after ${failureCount} failed attempts — waiting for human guidance. Last outcome: ${inputData.outcome.reason}`;
      }
    }

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
        reason: statusReason,
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
