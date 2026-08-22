/**
 * Backlog ordering as data.
 *
 * Synthesizer stories carry implicit ordering — "Duplicate detection"
 * presumes the save/import code that only a sibling story creates. Created
 * flat and `open`, a dependent story can be checked out first, run against a
 * skeleton, and honestly produce nothing.
 *
 * Dependencies are therefore stored as edges and enforced at checkout, never
 * by flipping status on completion: a computed gate cannot drift the way a
 * missed unblock hook would (one miss and a task strands forever).
 */

import { db } from '@/lib/db';
import { taskDependencies, tasks } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { isDependencySatisfied, type DependencyLink } from './dependency-graph';

// The pure graph half lives in ./dependency-graph so it stays unit-testable
// without a database connection. Re-exported here so callers have one import.
export {
  buildExecutionLayers,
  isDependencySatisfied,
  normalizeBacklogDependencies,
} from './dependency-graph';
export type {
  BacklogDependencyEdge,
  DependencyLink,
  ExecutionLayerTask,
  NormalizedBacklogDependencies,
} from './dependency-graph';

// ─── Persistence ───────────────────────────────────────────────────

/** Insert edges, ignoring any that already exist. Returns the number written. */
export async function createTaskDependencies(
  edges: Array<{ taskId: string; dependsOnTaskId: string }>,
): Promise<number> {
  const valid = edges.filter((edge) => edge.taskId !== edge.dependsOnTaskId);
  if (valid.length === 0) return 0;

  const inserted = await db
    .insert(taskDependencies)
    .values(valid)
    .onConflictDoNothing()
    .returning({ id: taskDependencies.id });

  return inserted.length;
}

export async function deleteTaskDependency(params: {
  taskId: string;
  dependsOnTaskId: string;
}): Promise<boolean> {
  const removed = await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, params.taskId),
        eq(taskDependencies.dependsOnTaskId, params.dependsOnTaskId),
      ),
    )
    .returning({ id: taskDependencies.id });
  return removed.length > 0;
}

/** "What am I waiting on" for one task. */
export async function getTaskDependencies(taskId: string): Promise<DependencyLink[]> {
  const rows = await db
    .select({
      taskId: taskDependencies.taskId,
      dependsOnTaskId: taskDependencies.dependsOnTaskId,
      dependsOnTitle: tasks.title,
      dependsOnStatus: tasks.status,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(eq(taskDependencies.taskId, taskId));

  return rows.map((row) => ({ ...row, satisfied: isDependencySatisfied(row.dependsOnStatus) }));
}

/** Every edge whose dependent task belongs to this project — one query for the flight view. */
export async function getProjectDependencyLinks(projectId: string): Promise<DependencyLink[]> {
  const projectTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));

  if (projectTasks.length === 0) return [];

  const rows = await db
    .select({
      taskId: taskDependencies.taskId,
      dependsOnTaskId: taskDependencies.dependsOnTaskId,
      dependsOnTitle: tasks.title,
      dependsOnStatus: tasks.status,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(
      inArray(
        taskDependencies.taskId,
        projectTasks.map((row) => row.id),
      ),
    );

  return rows.map((row) => ({ ...row, satisfied: isDependencySatisfied(row.dependsOnStatus) }));
}

