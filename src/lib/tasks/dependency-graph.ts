/**
 * Backlog ordering — the pure graph half.
 *
 * Synthesizer stories carry implicit ordering — "Duplicate detection"
 * presumes the save/import code that only a sibling story creates. Created
 * flat and `open`, a dependent story can be checked out first, run against a
 * skeleton, and honestly produce nothing.
 *
 * This module holds the validation and layering logic with no database
 * dependency, so it stays directly unit-testable; `dependencies.ts` adds
 * persistence on top and re-exports everything here.
 */

/** A dependency is satisfied only by a *done* prerequisite. */
export function isDependencySatisfied(status: string): boolean {
  return status === 'done';
}

export interface DependencyLink {
  taskId: string;
  dependsOnTaskId: string;
  dependsOnTitle: string;
  dependsOnStatus: string;
  satisfied: boolean;
}

// ─── B.1 — synthesizer hints → validated edges ─────────────────────

export interface BacklogDependencyEdge {
  /** Index of the dependent story in the backlog array. */
  index: number;
  /** Index of the story that must land first. */
  dependsOnIndex: number;
}

export interface NormalizedBacklogDependencies {
  edges: BacklogDependencyEdge[];
  /** Human-readable notes about hints that were dropped. Never fatal. */
  warnings: string[];
}

/**
 * Turn `depends_on` index hints into a validated, acyclic edge list.
 *
 * Out-of-range indices, self-references, and duplicates are dropped; a hint
 * that would close a cycle has its back-edge dropped with a warning. A bad
 * ordering hint must never fail the ring — the stories themselves are the
 * deliverable, the ordering is an aid.
 */
export function normalizeBacklogDependencies(
  backlog: Array<{ title?: string; depends_on?: number[] | null }>,
): NormalizedBacklogDependencies {
  const warnings: string[] = [];
  const edges: BacklogDependencyEdge[] = [];
  const seen = new Set<string>();
  // prerequisites[i] = indices story i waits on (accumulated as we accept edges)
  const prerequisites = new Map<number, Set<number>>();

  const reaches = (from: number, target: number): boolean => {
    const stack = [...(prerequisites.get(from) ?? [])];
    const visited = new Set<number>();
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === target) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      stack.push(...(prerequisites.get(node) ?? []));
    }
    return false;
  };

  backlog.forEach((item, index) => {
    for (const raw of item.depends_on ?? []) {
      const dependsOnIndex = Number(raw);
      const label = `"${item.title ?? `story ${index}`}" (index ${index})`;

      if (!Number.isInteger(dependsOnIndex) || dependsOnIndex < 0 || dependsOnIndex >= backlog.length) {
        warnings.push(`${label}: dropped depends_on ${raw} — no such story index.`);
        continue;
      }
      if (dependsOnIndex === index) {
        warnings.push(`${label}: dropped self-reference in depends_on.`);
        continue;
      }
      const key = `${index}->${dependsOnIndex}`;
      if (seen.has(key)) continue;

      // Accepting this edge would close a cycle — drop the back-edge.
      if (reaches(dependsOnIndex, index)) {
        warnings.push(
          `${label}: dropped depends_on ${dependsOnIndex} — it would create a dependency cycle.`,
        );
        continue;
      }

      seen.add(key);
      edges.push({ index, dependsOnIndex });
      if (!prerequisites.has(index)) prerequisites.set(index, new Set());
      prerequisites.get(index)!.add(dependsOnIndex);
    }
  });

  return { edges, warnings };
}

// ─── C.2 — topological layering for the execution plan ─────────────

export interface ExecutionLayerTask<T> {
  task: T;
  /** Unmet prerequisites (not done) — the "after: <task>" chips. */
  waitingOn: DependencyLink[];
}

/**
 * Lay tasks out in dependency layers: layer 0 has no unmet prerequisites and
 * is eligible now; layer N waits on something in a lower layer. Only *unmet*
 * dependencies push a task down — a story whose prerequisite is already done
 * belongs at the front regardless of how the graph was drawn.
 *
 * Within a layer, ordering follows the checkout keys (priority, then age), so
 * the view predicts real execution order rather than merely grouping.
 */
export function buildExecutionLayers<
  T extends { id: string; priority: string; createdAt: Date | string },
>(
  taskList: T[],
  links: DependencyLink[],
): Array<Array<ExecutionLayerTask<T>>> {
  const byId = new Map(taskList.map((task) => [task.id, task]));
  const unmet = new Map<string, DependencyLink[]>();

  for (const link of links) {
    if (link.satisfied) continue;
    if (!byId.has(link.taskId)) continue;
    if (!unmet.has(link.taskId)) unmet.set(link.taskId, []);
    unmet.get(link.taskId)!.push(link);
  }

  const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const sortKey = (a: T, b: T) => {
    const byPriority = (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
    if (byPriority !== 0) return byPriority;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  };

  const depth = new Map<string, number>();
  const resolving = new Set<string>();

  const layerOf = (taskId: string): number => {
    const cached = depth.get(taskId);
    if (cached !== undefined) return cached;
    // A cycle that survived normalization (hand-added edges, say) must not
    // hang the view — treat the revisited node as layer 0 and move on.
    if (resolving.has(taskId)) return 0;

    resolving.add(taskId);
    let level = 0;
    for (const link of unmet.get(taskId) ?? []) {
      // A prerequisite outside this list (done, or another project's) still
      // blocks, but contributes no layer of its own.
      level = Math.max(level, byId.has(link.dependsOnTaskId) ? layerOf(link.dependsOnTaskId) + 1 : 1);
    }
    resolving.delete(taskId);
    depth.set(taskId, level);
    return level;
  };

  const layers: Array<Array<ExecutionLayerTask<T>>> = [];
  for (const task of taskList) {
    const level = layerOf(task.id);
    while (layers.length <= level) layers.push([]);
    layers[level].push({ task, waitingOn: unmet.get(task.id) ?? [] });
  }

  return layers.map((layer) => layer.sort((a, b) => sortKey(a.task, b.task)));
}
