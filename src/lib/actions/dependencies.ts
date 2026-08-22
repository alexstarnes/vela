'use server';

import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { logTaskEvent } from '@/lib/events/logger';
import {
  createTaskDependencies,
  deleteTaskDependency,
  getTaskDependencies,
} from '@/lib/tasks/dependencies';
import type { ActionResult } from './projects';

const EdgeSchema = z.object({
  taskId: z.string().uuid(),
  dependsOnTaskId: z.string().uuid(),
});

/**
 * Operator pruning: dependency edges are proposed by a model (the synthesizer,
 * or the retro-fit pass) and reviewed by a human in the flight view. Deleting
 * an edge immediately changes checkout eligibility — the gate is computed from
 * these rows on every checkout, never cached.
 */
export async function removeTaskDependency(input: unknown): Promise<ActionResult> {
  const parsed = EdgeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e) => e.message).join('; ') };
  }

  const { taskId, dependsOnTaskId } = parsed.data;
  const removed = await deleteTaskDependency({ taskId, dependsOnTaskId });
  if (!removed) {
    return { success: false, error: 'Dependency not found — it may already have been removed.' };
  }

  const prerequisite = await db.query.tasks.findFirst({
    where: eq(tasks.id, dependsOnTaskId),
    columns: { title: true },
  });

  await logTaskEvent({
    taskId,
    eventType: 'dependency_graph',
    payload: {
      action: 'edge_removed',
      depends_on_task_id: dependsOnTaskId,
      depends_on_title: prerequisite?.title ?? null,
    },
  });

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: { projectId: true },
  });

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${taskId}`);
  if (task?.projectId) revalidatePath(`/projects/${task.projectId}`);
  return { success: true, data: undefined };
}

/** Add an edge by hand — the counterpart to pruning when the operator spots a missing order. */
export async function addTaskDependency(input: unknown): Promise<ActionResult> {
  const parsed = EdgeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e) => e.message).join('; ') };
  }

  const { taskId, dependsOnTaskId } = parsed.data;
  if (taskId === dependsOnTaskId) {
    return { success: false, error: 'A task cannot depend on itself.' };
  }

  // Refuse an edge that would close a cycle — the checkout gate would then
  // never admit either task, and the flight view could not layer them.
  // Walk the prerequisites of the proposed prerequisite: if this task is
  // already up that chain, the new edge points backwards.
  const upstream = new Set<string>();
  const stack = [dependsOnTaskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (upstream.has(current)) continue;
    upstream.add(current);
    for (const link of await getTaskDependencies(current)) {
      stack.push(link.dependsOnTaskId);
    }
  }
  if (upstream.has(taskId)) {
    return {
      success: false,
      error: 'That edge would create a dependency cycle — neither task could ever be checked out.',
    };
  }

  const written = await createTaskDependencies([{ taskId, dependsOnTaskId }]);
  if (written === 0) {
    return { success: false, error: 'That dependency already exists.' };
  }

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: { projectId: true },
  });

  await logTaskEvent({
    taskId,
    eventType: 'dependency_graph',
    payload: { action: 'edge_added', depends_on_task_id: dependsOnTaskId },
  });

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${taskId}`);
  if (task?.projectId) revalidatePath(`/projects/${task.projectId}`);
  return { success: true, data: undefined };
}
