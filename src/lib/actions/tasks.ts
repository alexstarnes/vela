'use server';

import { db } from '@/lib/db';
import { tasks, taskEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { assertValidTransition, type TaskStatus } from '@/lib/tasks/state-machine';
import { logTaskEvent } from '@/lib/events/logger';
import { executeHeartbeatForTask } from '@/lib/mastra/heartbeat';
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

  await db
    .update(tasks)
    .set({ status: toStatus, updatedAt: new Date() })
    .where(eq(tasks.id, id));

  // Append status_change event (append-only)
  await logTaskEvent({
    taskId: id,
    agentId,
    eventType: 'status_change',
    payload: { from: fromStatus, to: toStatus, reason: reason ?? null },
  });

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
  revalidatePath('/activity');
  return { success: true, data: undefined };
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
