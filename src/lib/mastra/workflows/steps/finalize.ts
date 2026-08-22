import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { projects, tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { buildTaskRoutingScorecard } from '@/lib/mastra/analytics/routing-scorecards';
import { and, eq, ne } from 'drizzle-orm';
import { finalizedTaskSchema, synthesizedTaskSchema } from './shared';
import {
  incrementTaskFailureCount,
  resetTaskFailureCount,
} from '@/lib/orchestration/escalation';
import { commitTaskBranch } from '@/lib/workspace/branch-lifecycle';

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

    // An operator can cancel a task while its run is still in flight (single or
    // bulk cancel). The operator's decision must win over the run it cancelled:
    // guard the write so a late finalize cannot resurrect the task into
    // review/open/waiting_for_human. Reopening is the operator's call, via the
    // cancelled → backlog transition — never a side effect of a finishing run.
    const finalized = await db
      .update(tasks)
      .set({
        status: finalStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, task.id), ne(tasks.status, 'cancelled')))
      .returning({ id: tasks.id });

    if (finalized.length === 0) {
      await logTaskEvent({
        taskId: task.id,
        agentId: inputData.agentId,
        eventType: 'status_change',
        payload: {
          from: 'cancelled',
          to: 'cancelled',
          reason: `Run finished after the task was cancelled — "${finalStatus}" not applied.`,
        },
      });

      return {
        ...inputData,
        finalStatus,
      };
    }

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

      // The hygiene moment (workspace plan A.3): the deliverable survives on
      // the task branch and the shared tree returns to base, so the next task
      // to run here starts clean and its reviewer sees only its own diff.
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, task.projectId),
      });
      if (project) {
        const commit = await commitTaskBranch({
          task,
          project,
          agentId: inputData.agentId,
        });
        if (commit.status === 'failed') {
          // Honest, not silent: the task still reaches review, but the
          // operator is told the tree was not cleaned up behind it.
          await logTaskEvent({
            taskId: task.id,
            agentId: inputData.agentId,
            eventType: 'message',
            payload: {
              content:
                `Work reached review but could not be committed to its branch: ${commit.reason}. ` +
                'The working tree may still hold this task\'s changes.',
            },
          });
        }
      }
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
