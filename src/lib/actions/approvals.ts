'use server';

import { db } from '@/lib/db';
import { approvals, tasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { logTaskEvent } from '@/lib/events/logger';
import { assertValidTransition, type TaskStatus } from '@/lib/tasks/state-machine';
import type { ActionResult } from './projects';

/**
 * revalidatePath throws ("static generation store missing") outside a request
 * scope — but these actions are also called from the workflow runtime and the
 * node-cron scheduler, where there is no request. Cache revalidation is
 * meaningless there anyway, so a failed revalidate is a no-op, never an error.
 */
function safeRevalidate(...paths: Array<[string] | [string, 'page' | 'layout']>): void {
  for (const args of paths) {
    try {
      revalidatePath(...(args as [string, ('page' | 'layout')?]));
    } catch {
      // No request store (scheduler/workflow context) — nothing to revalidate.
    }
  }
}

// ─── Types ────────────────────────────────────────────────────────

export type ApprovalWithTask = Awaited<ReturnType<typeof listPendingApprovals>>[number];

// ─── Queries ──────────────────────────────────────────────────────

/**
 * List all pending approvals, newest first.
 */
export async function listPendingApprovals() {
  return db.query.approvals.findMany({
    where: eq(approvals.status, 'pending'),
    orderBy: (a, { desc }) => [desc(a.createdAt)],
    with: {
      agent: true,
      task: {
        with: { project: true },
      },
    },
  });
}

/**
 * Get a single approval by id.
 */
export async function getApproval(id: string) {
  return db.query.approvals.findFirst({
    where: eq(approvals.id, id),
    with: {
      agent: true,
      task: {
        with: { project: true },
      },
    },
  });
}

/**
 * List approvals for a specific task.
 */
export async function getTaskApprovals(taskId: string) {
  return db.query.approvals.findMany({
    where: eq(approvals.taskId, taskId),
    orderBy: (a, { desc }) => [desc(a.createdAt)],
    with: { agent: true },
  });
}

// ─── Mutations ────────────────────────────────────────────────────

const ApproveSchema = z.object({
  approvalId: z.string().uuid(),
  reviewerNotes: z.string().max(1000).optional(),
});

const RejectSchema = z.object({
  approvalId: z.string().uuid(),
  reviewerNotes: z.string().max(1000).optional(),
});

/**
 * Approve a pending approval request.
 *
 * For task_delegation: creates the subtask and transitions the parent task
 * back to open so the heartbeat scheduler can resume it.
 */
export async function approveApproval(input: unknown): Promise<ActionResult> {
  const parsed = ApproveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((e) => e.message).join('; '),
    };
  }

  const { approvalId, reviewerNotes } = parsed.data;

  // Atomic pending→approved flip: the status predicate makes concurrent
  // approvals race safely — exactly one caller wins, the rest see 0 rows.
  const [approval] = await db
    .update(approvals)
    .set({
      status: 'approved',
      resolvedAt: new Date(),
      reviewerNotes: reviewerNotes ?? null,
    })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, 'pending')))
    .returning();

  if (!approval) {
    return { success: false, error: 'Approval not found or already resolved' };
  }

  // Log the approval response event on the parent task
  if (approval.taskId) {
    await logTaskEvent({
      taskId: approval.taskId,
      agentId: approval.agentId,
      eventType: 'approval_response',
      payload: {
        approval_id: approvalId,
        status: 'approved',
        action_type: approval.actionType,
        reviewer_notes: reviewerNotes ?? null,
      },
    });
  }

  // Handle prd_backlog: approved backlog items become child tasks of the PRD
  // task and enter the existing build pipeline. Goal ancestry threads through
  // parentTaskId plus an explicit pointer in each description.
  if (approval.actionType === 'prd_backlog' && approval.taskId) {
    const payload = approval.payload as {
      backlog?: Array<{
        title?: string;
        description?: string;
        acceptance_criteria?: string[];
        source_findings?: string[];
      }>;
      project_id?: string | null;
    } | null;

    const prdTask = await db.query.tasks.findFirst({ where: eq(tasks.id, approval.taskId) });
    const projectId = payload?.project_id ?? prdTask?.projectId;

    if (payload?.backlog && payload.backlog.length > 0 && projectId && prdTask) {
      const { agents } = await import('@/lib/db/schema');
      const supervisor = await db.query.agents.findFirst({
        where: and(eq(agents.name, 'Supervisor'), eq(agents.agentKind, 'runtime')),
      });

      let firstChildId: string | null = null;
      for (const item of payload.backlog) {
        const description = [
          item.description ?? '',
          '',
          'Acceptance criteria:',
          ...(item.acceptance_criteria ?? []).map((criterion) => `- ${criterion}`),
          '',
          `Serves PRD task ${prdTask.id}: "${prdTask.title}"` +
            (item.source_findings?.length ? ` (from findings ${item.source_findings.join(', ')})` : ''),
        ]
          .join('\n')
          .trim();

        const [child] = await db
          .insert(tasks)
          .values({
            title: String(item.title ?? 'Backlog item'),
            description,
            projectId,
            parentTaskId: prdTask.id,
            assignedAgentId: supervisor?.id ?? null,
            createdByAgentId: approval.agentId,
            priority: 'medium',
            status: supervisor ? 'open' : 'backlog',
          })
          .returning({ id: tasks.id });
        firstChildId ??= child.id;

        await logTaskEvent({
          taskId: child.id,
          agentId: approval.agentId,
          eventType: 'status_change',
          payload: {
            from: null,
            to: supervisor ? 'open' : 'backlog',
            reason: `Created from approved PRD backlog (approval ${approvalId})`,
          },
        });
      }

      await logTaskEvent({
        taskId: prdTask.id,
        agentId: approval.agentId,
        eventType: 'delegation',
        payload: {
          approval_id: approvalId,
          child_tasks_created: payload.backlog.length,
          reason: 'PRD backlog approved — stories entered the build pipeline',
        },
      });

      // Autostart (opt-in per project, default off): kick a heartbeat for the
      // first created child so an approved backlog starts building without
      // waiting for a cron tick. Fire-and-forget — approval resolution must
      // not block on (or fail with) the run it triggers.
      if (firstChildId) {
        const { projects } = await import('@/lib/db/schema');
        const project = await db.query.projects.findFirst({
          where: eq(projects.id, projectId),
          columns: { autostartOnBacklogApproval: true },
        });
        if (project?.autostartOnBacklogApproval) {
          const startedChildId = firstChildId;
          await logTaskEvent({
            taskId: startedChildId,
            agentId: approval.agentId,
            eventType: 'message',
            payload: {
              content: 'Autostart: backlog approved with autostart enabled — heartbeat triggered for this task.',
            },
          });
          const { executeHeartbeatForTask } = await import('@/lib/mastra/heartbeat');
          executeHeartbeatForTask(startedChildId).catch((err) => {
            console.error(`[approvals] autostart heartbeat failed for ${startedChildId}:`, err);
          });
        }
      }
    }

    // Requeue the PRD task so its next heartbeat finalizes the ring (the
    // workflow sees the approved gate and moves the task to review).
    if (prdTask && prdTask.status === 'waiting_for_human') {
      try {
        assertValidTransition(prdTask.status as TaskStatus, 'open');
        await db
          .update(tasks)
          .set({ status: 'open', updatedAt: new Date() })
          .where(eq(tasks.id, prdTask.id));
        await logTaskEvent({
          taskId: prdTask.id,
          agentId: approval.agentId,
          eventType: 'status_change',
          payload: {
            from: 'waiting_for_human',
            to: 'open',
            reason: 'Backlog approved — PRD task requeued for ring completion',
          },
        });
      } catch {
        // State machine violation — skip
      }
    }
  }

  // Handle task_delegation: create the subtask and resume parent task
  if (approval.actionType === 'task_delegation' && approval.taskId) {
    const payload = approval.payload as Record<string, unknown> | null;

    if (payload) {
      // Create the approved subtask
      const [subtask] = await db
        .insert(tasks)
        .values({
          title: String(payload.title ?? 'Delegated subtask'),
          description: payload.description ? String(payload.description) : null,
          projectId: String(payload.project_id),
          parentTaskId: approval.taskId,
          assignedAgentId: payload.assigned_agent_id
            ? String(payload.assigned_agent_id)
            : null,
          createdByAgentId: approval.agentId,
          priority: (payload.priority as 'low' | 'medium' | 'high' | 'urgent') ?? 'medium',
          status: 'backlog',
        })
        .returning({ id: tasks.id });

      await logTaskEvent({
        taskId: approval.taskId,
        agentId: approval.agentId,
        eventType: 'delegation',
        payload: {
          subtask_id: subtask.id,
          title: payload.title,
          assigned_to: payload.assigned_agent_id ?? null,
          approved: true,
        },
      });

      await logTaskEvent({
        taskId: subtask.id,
        agentId: approval.agentId,
        eventType: 'status_change',
        payload: {
          from: null,
          to: 'backlog',
          reason: 'Created via approved delegation',
        },
      });
    }

    // Requeue parent task so scheduled heartbeats can resume it
    const parentTask = await db.query.tasks.findFirst({
      where: eq(tasks.id, approval.taskId),
    });

    if (parentTask && parentTask.status === 'waiting_for_human') {
      try {
        assertValidTransition(parentTask.status as TaskStatus, 'open');
        await db
          .update(tasks)
          .set({ status: 'open', updatedAt: new Date() })
          .where(eq(tasks.id, approval.taskId));

        await logTaskEvent({
          taskId: approval.taskId,
          agentId: approval.agentId,
          eventType: 'status_change',
          payload: {
            from: 'waiting_for_human',
            to: 'open',
            reason: 'Approval granted — task requeued for workflow execution',
          },
        });
      } catch {
        // State machine violation — don't crash, just skip the transition
      }
    }
  }

  safeRevalidate(['/tasks'], ['/tasks/[id]', 'page'], ['/activity']);
  return { success: true, data: undefined };
}

/**
 * Reject a pending approval request.
 *
 * Requeues the parent task with a rejection message.
 */
export async function rejectApproval(input: unknown): Promise<ActionResult> {
  const parsed = RejectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((e) => e.message).join('; '),
    };
  }

  const { approvalId, reviewerNotes } = parsed.data;

  // Atomic pending→rejected flip — same race-safety as approveApproval.
  const [approval] = await db
    .update(approvals)
    .set({
      status: 'rejected',
      resolvedAt: new Date(),
      reviewerNotes: reviewerNotes ?? null,
    })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, 'pending')))
    .returning();

  if (!approval) {
    return { success: false, error: 'Approval not found or already resolved' };
  }

  if (approval.taskId) {
    await logTaskEvent({
      taskId: approval.taskId,
      agentId: approval.agentId,
      eventType: 'approval_response',
      payload: {
        approval_id: approvalId,
        status: 'rejected',
        action_type: approval.actionType,
        reviewer_notes: reviewerNotes ?? null,
      },
    });

    // Requeue parent task so the user can update or retry it
    const parentTask = await db.query.tasks.findFirst({
      where: eq(tasks.id, approval.taskId),
    });

    if (parentTask && parentTask.status === 'waiting_for_human') {
      try {
        assertValidTransition(parentTask.status as TaskStatus, 'open');
        await db
          .update(tasks)
          .set({ status: 'open', updatedAt: new Date() })
          .where(eq(tasks.id, approval.taskId));

        await logTaskEvent({
          taskId: approval.taskId,
          agentId: approval.agentId,
          eventType: 'status_change',
          payload: {
            from: 'waiting_for_human',
            to: 'open',
            reason: 'Approval rejected — task requeued for revision',
          },
        });
      } catch {
        // State machine violation — skip
      }
    }
  }

  safeRevalidate(['/tasks'], ['/tasks/[id]', 'page'], ['/activity']);
  return { success: true, data: undefined };
}

/**
 * Create an approval request.  Called by the heartbeat when an agent
 * attempts a delegation that requires human sign-off.
 */
export async function createApprovalRequest(input: {
  agentId: string;
  taskId: string;
  actionType: 'task_delegation' | 'budget_override' | 'agent_creation' | 'high_risk_change' | 'prd_backlog';
  description: string;
  payload?: Record<string, unknown>;
}): Promise<{ approvalId: string }> {
  const [row] = await db
    .insert(approvals)
    .values({
      agentId: input.agentId,
      taskId: input.taskId,
      actionType: input.actionType,
      description: input.description,
      payload: input.payload ?? null,
      status: 'pending',
    })
    .returning({ id: approvals.id });

  await logTaskEvent({
    taskId: input.taskId,
    agentId: input.agentId,
    eventType: 'approval_request',
    payload: {
      approval_id: row.id,
      action_type: input.actionType,
      description: input.description,
    },
  });

  safeRevalidate(['/tasks']);
  return { approvalId: row.id };
}
