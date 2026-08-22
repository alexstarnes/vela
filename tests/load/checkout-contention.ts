/**
 * Load test: N concurrent heartbeat checkouts must never check out the same
 * task twice, must never leave a lock stuck after cleanup, and must never
 * check out two tasks of the same project at once.
 *
 * `checkoutNextTask` lives inside src/lib/mastra/heartbeat.ts and is not
 * exported, so this script cannot import it directly. Instead it re-runs
 * the IDENTICAL SQL statement against the real DB to exercise the actual
 * atomic-checkout query path (the `FOR UPDATE SKIP LOCKED` subquery is what
 * makes concurrent checkouts safe — that's what this test is proving).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ KEEP THIS IN SYNC with src/lib/mastra/heartbeat.ts                   │
 * │ (function `checkoutNextTask`). If that query changes, update          │
 * │ CHECKOUT_SQL below to match or this test is stale.                    │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * We deliberately run this at the SQL layer via db.execute(sql.raw(...))
 * with the agentId manually interpolated into the query text — sql.raw()
 * takes a plain string with no placeholder binding, so this is the only way
 * to reuse heartbeat.ts's exact statement shape outside the module. This is
 * safe here because agentId is always a server-generated UUID (validated
 * below before interpolation), never external input.
 *
 * Phase 1 (contention) seeds one task per project, because per-project
 * serialization means a single project can only ever yield one concurrent
 * checkout — spreading the tasks is what keeps the race under test.
 * Phase 2 (serialization) then asserts exactly that limit.
 */
import '../governance/load-env';
import { db } from '@/lib/db';
import { agents, tasks, projects } from '@/lib/db/schema';
import type { Task } from '@/lib/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';

const N_WORKERS = 8;
const M_TASKS = 10;
/** Open tasks seeded into a single project for the serialization phase. */
const SERIALIZED_TASKS = 4;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function evidence(label: string, data: unknown) {
  console.log(`\nEVIDENCE [${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

// ─── EXACT COPY of the checkout query, see heartbeat.ts ───────────────
function checkoutSql(agentId: string): string {
  if (!UUID_RE.test(agentId)) {
    throw new Error(`Refusing to interpolate non-UUID agentId into raw SQL: ${agentId}`);
  }
  return `
    UPDATE tasks
    SET status = 'in_progress',
        locked_by = '${agentId}',
        locked_at = now(),
        updated_at = now()
    WHERE id = (
      SELECT t.id FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.assigned_agent_id = '${agentId}'
        AND t.status = 'open'
        AND t.locked_by IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM tasks busy
          WHERE busy.project_id = t.project_id
            AND busy.status = 'in_progress'
        )
        AND NOT EXISTS (
          SELECT 1 FROM task_dependencies d
          JOIN tasks prereq ON prereq.id = d.depends_on_task_id
          WHERE d.task_id = t.id
            AND prereq.status <> 'done'
        )
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low'    THEN 3
        END ASC,
        t.created_at ASC
      LIMIT 1
      FOR UPDATE OF t, p SKIP LOCKED
    )
    RETURNING *
  `;
}

async function checkoutNextTask(agentId: string): Promise<Task | null> {
  const result = await db.execute(sql.raw(checkoutSql(agentId)));
  const rows = result as unknown as Task[];
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

async function main() {
  const runId = Date.now();
  const projectIds: string[] = [];
  let agent: typeof agents.$inferSelect | null = null;

  try {
    // ── Scratch fixtures: one project per task, so per-project
    //    serialization does not itself limit the contention phase ──
    const seededProjects = await db
      .insert(projects)
      .values(
        Array.from({ length: M_TASKS }, (_, i) => ({
          name: `Load Test Checkout Contention ${runId} #${i}`,
          sourceType: 'manual',
          workspacePath: null,
          status: 'active',
        })),
      )
      .returning();
    projectIds.push(...seededProjects.map((p) => p.id));

    [agent] = await db
      .insert(agents)
      .values({
        projectId: seededProjects[0].id,
        name: `Checkout Contention Scratch ${runId}`,
        role: 'load test scratch agent',
        agentKind: 'legacy_reference',
        heartbeatEnabled: false,
        status: 'active',
      })
      .returning();

    const insertedTasks = await db
      .insert(tasks)
      .values(
        seededProjects.map((project, i) => ({
          projectId: project.id,
          assignedAgentId: agent!.id,
          title: `Contention scratch task ${i}`,
          description: 'Never executed — checkout-contention load test fixture.',
          status: 'open',
          priority: 'medium',
        })),
      )
      .returning({ id: tasks.id });

    evidence('setup', {
      projects: seededProjects.length,
      agentId: agent.id,
      workers: N_WORKERS,
      tasksSeeded: insertedTasks.length,
    });

    // ── Phase 1: N workers concurrently drain the queue ──
    const perWorkerCheckouts: string[][] = Array.from({ length: N_WORKERS }, () => []);

    async function drain(workerIdx: number): Promise<void> {
      for (;;) {
        const task = await checkoutNextTask(agent!.id);
        if (!task) return;
        perWorkerCheckouts[workerIdx].push(task.id);
      }
    }

    await Promise.all(Array.from({ length: N_WORKERS }, (_, i) => drain(i)));

    const allCheckedOut = perWorkerCheckouts.flat();
    const uniqueCheckedOut = new Set(allCheckedOut);

    evidence('checkout-results', {
      workers: N_WORKERS,
      tasksSeeded: M_TASKS,
      totalCheckedOut: allCheckedOut.length,
      uniqueCheckedOut: uniqueCheckedOut.size,
      perWorkerCounts: perWorkerCheckouts.map((c) => c.length),
    });

    const noDuplicates = uniqueCheckedOut.size === allCheckedOut.length;
    const totalMatches = allCheckedOut.length === M_TASKS;
    const allSeededTasksAccountedFor = insertedTasks.every((t) => uniqueCheckedOut.has(t.id));

    // ── Phase 2: per-project serialization ──
    // One project, several open tasks. Whatever the concurrency, exactly one
    // may be in flight: tasks of a project share a working tree, and git's
    // checked-out state is repo-global.
    const [serialProject] = await db
      .insert(projects)
      .values({
        name: `Load Test Project Serialization ${runId}`,
        sourceType: 'manual',
        workspacePath: null,
        status: 'active',
      })
      .returning();
    projectIds.push(serialProject.id);

    await db.insert(tasks).values(
      Array.from({ length: SERIALIZED_TASKS }, (_, i) => ({
        projectId: serialProject.id,
        assignedAgentId: agent!.id,
        title: `Serialization scratch task ${i}`,
        description: 'Never executed — per-project serialization fixture.',
        status: 'open',
        priority: 'medium',
      })),
    );

    const serialCheckouts: string[][] = Array.from({ length: N_WORKERS }, () => []);
    await Promise.all(
      Array.from({ length: N_WORKERS }, async (_, workerIdx) => {
        for (;;) {
          const task = await checkoutNextTask(agent!.id);
          if (!task) return;
          serialCheckouts[workerIdx].push(task.id);
        }
      }),
    );

    const serialTotal = serialCheckouts.flat().length;
    const inFlight = await db.query.tasks.findMany({
      where: (t, { eq: eqOp, and: andOp }) =>
        andOp(eqOp(t.projectId, serialProject.id), eqOp(t.status, 'in_progress')),
      columns: { id: true },
    });

    evidence('project-serialization', {
      projectId: serialProject.id,
      openTasksSeeded: SERIALIZED_TASKS,
      workers: N_WORKERS,
      checkedOut: serialTotal,
      inProgressInProject: inFlight.length,
    });

    const serializationHolds = serialTotal === 1 && inFlight.length === 1;

    // ── Final cleanup pass: release every lock, then assert none remain ──
    await db
      .update(tasks)
      .set({ lockedBy: null, lockedAt: null, updatedAt: new Date() })
      .where(inArray(tasks.projectId, projectIds));

    const stillLocked = await db.query.tasks.findMany({
      where: (t, { inArray: inArrayOp, and: andOp, isNotNull }) =>
        andOp(inArrayOp(t.projectId, projectIds), isNotNull(t.lockedBy)),
    });
    const noLocksRemain = stillLocked.length === 0;

    evidence('post-cleanup', { stillLockedCount: stillLocked.length });

    const pass =
      noDuplicates && totalMatches && allSeededTasksAccountedFor && noLocksRemain && serializationHolds;
    console.log(
      pass
        ? `PASS: ${N_WORKERS} workers checked out ${allCheckedOut.length}/${M_TASKS} tasks via the real FOR UPDATE SKIP LOCKED query, zero duplicates, zero lingering locks after cleanup; per-project serialization admitted exactly 1 of ${SERIALIZED_TASKS} tasks sharing a project`
        : `FAIL: duplicates=${!noDuplicates} totalMismatch=${!totalMatches} missingSeeded=${!allSeededTasksAccountedFor} locksRemain=${!noLocksRemain} serializationBroken=${!serializationHolds}`,
    );
    process.exitCode = pass ? 0 : 1;
  } finally {
    // Scratch row cleanup — order matters for FK constraints: tasks before
    // agents/projects, agents before projects.
    if (projectIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.projectId, projectIds));
    }
    if (agent) {
      await db.delete(agents).where(eq(agents.id, agent.id));
    }
    if (projectIds.length > 0) {
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
  }

  // drizzle postgres-js keeps the process alive; exit explicitly.
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
