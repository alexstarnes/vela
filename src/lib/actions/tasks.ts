'use server';

import { db } from '@/lib/db';
import { projects, tasks, taskEvents } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { assertValidTransition, isValidTransition, type TaskStatus } from '@/lib/tasks/state-machine';
import { logTaskEvent } from '@/lib/events/logger';
import { executeHeartbeatForTask } from '@/lib/mastra/heartbeat';
import { mergeTaskBranch } from '@/lib/workspace/branch-lifecycle';
import type { ActionResult } from './projects';

const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(5000).optional(),
  projectId: z.string().uuid('Project is required'),
  assignedAgentId: z.string().uuid().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  parentTaskId: z.string().uuid().optional(),
});

const UpdateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  assignedAgentId: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

const TransitionTaskSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    'backlog',
    'open',
    'in_progress',
    'review',
    'done',
    'waiting_for_human',
    'blocked',
    'cancelled',
  ]),
  agentId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

export async function createTask(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const data = parsed.data;

  // If an agent is assigned at creation, start as 'open' so heartbeat can pick it up
  const initialStatus = data.assignedAgentId ? 'open' : 'backlog';

  const [task] = await db
    .insert(tasks)
    .values({
      title: data.title,
      description: data.description,
      projectId: data.projectId,
      assignedAgentId: data.assignedAgentId,
      priority: data.priority,
      parentTaskId: data.parentTaskId,
      status: initialStatus,
    })
    .returning({ id: tasks.id });

  // Log creation event
  await logTaskEvent({
    taskId: task.id,
    eventType: 'status_change',
    payload: { from: null, to: initialStatus, reason: data.assignedAgentId ? 'Task created with agent assigned' : 'Task created' },
  });

  // Auto-dispatch: an assigned open task should start executing without a
  // manual "Run agent" click. Fire-and-forget, same as runTaskHeartbeat.
  if (data.assignedAgentId) {
    executeHeartbeatForTask(task.id).catch((err) => {
      console.error(`[createTask] Background heartbeat failed for ${task.id}:`, err);
    });
  }

  revalidatePath('/tasks');
  revalidatePath(`/projects/${data.projectId}`);
  return { success: true, data: { id: task.id } };
}

export async function updateTask(
  input: unknown
): Promise<ActionResult> {
  const parsed = UpdateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { id, ...fields } = parsed.data;

  await db
    .update(tasks)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(tasks.id, id));

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
  return { success: true, data: undefined };
}

export async function transitionTask(
  input: unknown
): Promise<ActionResult> {
  const parsed = TransitionTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { id, status: toStatus, agentId, reason } = parsed.data;

  // Fetch current task to validate state machine
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, id),
  });

  if (!task) {
    return { success: false, error: 'Task not found' };
  }

  const fromStatus = task.status as TaskStatus;
  const targetStatus = toStatus as TaskStatus;

  // Enforce state machine — throws if invalid
  try {
    assertValidTransition(fromStatus, targetStatus);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Invalid transition',
    };
  }

  // Operator approve (review → done) lands the task branch on base as one
  // squash commit. A conflict is not a done task: the transition redirects to
  // waiting_for_human with the git output already logged as a task event.
  // `Request changes` and `Cancel` deliberately leave the branch in place —
  // one for the next rework attempt, the other for forensics.
  let effectiveStatus: TaskStatus = targetStatus;
  let effectiveReason = reason ?? null;

  if (fromStatus === 'review' && targetStatus === 'done') {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, task.projectId),
    });

    if (project?.workspacePath) {
      const merge = await mergeTaskBranch({ task, project, agentId });

      if (merge.status === 'conflict' || merge.status === 'failed') {
        effectiveStatus = 'waiting_for_human';
        effectiveReason = merge.reason;
      } else if (merge.commitSha) {
        effectiveReason = `${effectiveReason ? `${effectiveReason} · ` : ''}Squash-merged ${merge.branch} into ${merge.baseBranch} as ${merge.commitSha}.`;
      }
    }
  }

  await db
    .update(tasks)
    .set({
      status: effectiveStatus,
      updatedAt: new Date(),
      // A cancelled task must not stay checked out — the lock would block the
      // row forever, since nothing will come back to release it.
      ...(effectiveStatus === 'cancelled' ? { lockedBy: null, lockedAt: null } : {}),
    })
    .where(eq(tasks.id, id));

  // Append status_change event (append-only)
  await logTaskEvent({
    taskId: id,
    agentId,
    eventType: 'status_change',
    payload: { from: fromStatus, to: effectiveStatus, reason: effectiveReason },
  });

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
  revalidatePath('/activity');
  return { success: true, data: undefined };
}

const BulkTransitionTasksSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Select at least one task').max(200),
  status: z.enum([
    'backlog',
    'open',
    'in_progress',
    'review',
    'done',
    'waiting_for_human',
    'blocked',
    'cancelled',
  ]),
  agentId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

export interface BulkTransitionSummary {
  /** Tasks that actually moved. */
  updated: { id: string; title: string; from: TaskStatus }[];
  /** Tasks left alone, with the reason the state machine (or a race) refused. */
  skipped: { id: string; title: string; reason: string }[];
}

/**
 * Apply one status transition across many tasks.
 *
 * Deliberately partial-success: a selection that mixes cancellable and
 * already-cancelled tasks moves what it can and reports the rest, rather than
 * failing the whole batch. Each distinct source status gets its own guarded
 * UPDATE (`WHERE id IN (...) AND status = <from>`) so a task that changed
 * underneath us — an agent finishing mid-click — is skipped, not clobbered.
 *
 * Does NOT route through transitionTask's review → done merge path; bulk is
 * cancel-shaped work, and squash-merging a batch of branches behind one click
 * is not something an operator should be able to do by accident.
 */
export async function bulkTransitionTasks(
  input: unknown
): Promise<ActionResult<BulkTransitionSummary>> {
  const parsed = BulkTransitionTasksSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { ids, status: toStatus, agentId, reason } = parsed.data;
  const targetStatus = toStatus as TaskStatus;

  if (targetStatus === 'done') {
    return {
      success: false,
      error: 'Approving to "done" runs a branch merge per task — do that one task at a time.',
    };
  }

  const rows = await db.query.tasks.findMany({
    where: inArray(tasks.id, ids),
    columns: { id: true, title: true, status: true, projectId: true },
  });

  const found = new Set(rows.map((r) => r.id));
  const skipped: BulkTransitionSummary['skipped'] = ids
    .filter((id) => !found.has(id))
    .map((id) => ({ id, title: id, reason: 'Task not found' }));

  // Group the eligible tasks by their current status so each UPDATE can guard
  // on the exact from-status it validated.
  const byFromStatus = new Map<TaskStatus, { id: string; title: string }[]>();

  for (const row of rows) {
    const fromStatus = row.status as TaskStatus;

    if (fromStatus === targetStatus) {
      skipped.push({ id: row.id, title: row.title, reason: `Already ${targetStatus.replace(/_/g, ' ')}` });
      continue;
    }
    if (!isValidTransition(fromStatus, targetStatus)) {
      skipped.push({
        id: row.id,
        title: row.title,
        reason: `Cannot go ${fromStatus.replace(/_/g, ' ')} → ${targetStatus.replace(/_/g, ' ')}`,
      });
      continue;
    }

    const bucket = byFromStatus.get(fromStatus) ?? [];
    bucket.push({ id: row.id, title: row.title });
    byFromStatus.set(fromStatus, bucket);
  }

  const updated: BulkTransitionSummary['updated'] = [];

  for (const [fromStatus, bucket] of byFromStatus) {
    const bucketIds = bucket.map((t) => t.id);

    const changed = await db
      .update(tasks)
      .set({
        status: targetStatus,
        updatedAt: new Date(),
        // See transitionTask: a cancelled task must not stay checked out.
        ...(targetStatus === 'cancelled' ? { lockedBy: null, lockedAt: null } : {}),
      })
      .where(and(inArray(tasks.id, bucketIds), eq(tasks.status, fromStatus)))
      .returning({ id: tasks.id });

    const changedIds = new Set(changed.map((c) => c.id));

    for (const t of bucket) {
      if (changedIds.has(t.id)) {
        updated.push({ ...t, from: fromStatus });
      } else {
        skipped.push({ id: t.id, title: t.title, reason: 'Status changed while the batch ran' });
      }
    }
  }

  // Append-only history, same shape a single-task transition writes.
  await Promise.all(
    updated.map((t) =>
      logTaskEvent({
        taskId: t.id,
        agentId,
        eventType: 'status_change',
        payload: { from: t.from, to: targetStatus, reason: reason ?? 'Bulk action' },
      })
    )
  );

  if (updated.length > 0) {
    revalidatePath('/tasks');
    revalidatePath('/activity');
    for (const t of updated) revalidatePath(`/tasks/${t.id}`);
    for (const projectId of new Set(rows.map((r) => r.projectId))) {
      revalidatePath(`/projects/${projectId}`);
    }
  }

  return { success: true, data: { updated, skipped } };
}

const RunTaskHeartbeatSchema = z.object({
  taskId: z.string().uuid(),
});

/** Runs the assigned agent on this task (checkout + model). Does not run on backlog.
 *  Fire-and-forget: returns immediately while the workflow runs in the background.
 *  Real-time progress is delivered via the SSE event stream. */
export async function runTaskHeartbeat(
  input: unknown,
): Promise<ActionResult> {
  const parsed = RunTaskHeartbeatSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
    };
  }

  const { taskId } = parsed.data;

  // Fire-and-forget: run the heartbeat in the background so the UI stays responsive.
  // Real-time progress is delivered via SSE.  We intentionally do NOT call
  // revalidatePath here — the promise resolves after the server action has
  // returned and Next.js is in a render phase, where revalidatePath is illegal.
  executeHeartbeatForTask(taskId).catch((err) => {
    console.error(`[runTaskHeartbeat] Background heartbeat failed for ${taskId}:`, err);
  });

  return { success: true, data: undefined };
}

export async function assignTask(input: {
  taskId: string;
  agentId: string | null;
  assignedBy?: string;
}): Promise<ActionResult> {
  const parsed = z
    .object({
      taskId: z.string().uuid(),
      agentId: z.string().uuid().nullable(),
      assignedBy: z.string().uuid().optional(),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { taskId, agentId, assignedBy } = parsed.data;

  // If assigning an agent, also auto-transition backlog → open
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  const shouldOpen = agentId && task?.status === 'backlog';

  await db
    .update(tasks)
    .set({
      assignedAgentId: agentId,
      ...(shouldOpen ? { status: 'open' } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  await logTaskEvent({
    taskId,
    agentId: assignedBy,
    eventType: 'assignment',
    payload: { assigned_to: agentId, assigned_by: assignedBy ?? null },
  });

  if (shouldOpen) {
    await logTaskEvent({
      taskId,
      agentId: assignedBy,
      eventType: 'status_change',
      payload: { from: 'backlog', to: 'open', reason: 'Auto-opened on agent assignment' },
    });
  }

  // Auto-dispatch newly assigned work (task is open either way at this point).
  if (agentId && (shouldOpen || task?.status === 'open')) {
    executeHeartbeatForTask(taskId).catch((err) => {
      console.error(`[assignTask] Background heartbeat failed for ${taskId}:`, err);
    });
  }

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${taskId}`);
  return { success: true, data: undefined };
}

export async function addTaskMessage(input: {
  taskId: string;
  content: string;
  role?: 'user' | 'agent' | 'system';
  agentId?: string;
}): Promise<ActionResult> {
  const parsed = z
    .object({
      taskId: z.string().uuid(),
      content: z.string().min(1).max(10000),
      role: z.enum(['user', 'agent', 'system']).optional().default('user'),
      agentId: z.string().uuid().optional(),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { taskId, content, role, agentId } = parsed.data;

  await logTaskEvent({
    taskId,
    agentId,
    eventType: 'message',
    payload: { role, content },
  });

  revalidatePath(`/tasks/${taskId}`);
  return { success: true, data: undefined };
}

export async function listTasks(filters?: {
  projectId?: string;
  agentId?: string;
  status?: string;
}) {
  if (filters?.projectId) {
    const { projectId } = filters;
    return db.query.tasks.findMany({
      where: eq(tasks.projectId, projectId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      with: { assignedAgent: true, project: true },
    });
  }

  return db.query.tasks.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { assignedAgent: true, project: true },
  });
}

export async function getTask(id: string) {
  return db.query.tasks.findFirst({
    where: eq(tasks.id, id),
    with: {
      assignedAgent: true,
      project: true,
      parentTask: true,
    },
  });
}

export async function getTaskEvents(taskId: string) {
  return db.query.taskEvents.findMany({
    where: eq(taskEvents.taskId, taskId),
    orderBy: (e, { asc }) => [asc(e.createdAt)],
    with: { agent: true },
  });
}

export async function getSubtasks(parentTaskId: string) {
  return db.query.tasks.findMany({
    where: eq(tasks.parentTaskId, parentTaskId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
    with: { assignedAgent: true },
  });
}
