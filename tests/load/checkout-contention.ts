/**
 * Phase 2 load test: N concurrent heartbeat checkouts must never check out
 * the same task twice, and must never leave a lock stuck after cleanup.
 *
 * `checkoutNextTask` lives inside src/lib/mastra/heartbeat.ts and is not
 * exported, so this script cannot import it directly. Instead it re-runs
 * the IDENTICAL SQL statement against the real DB to exercise the actual
 * atomic-checkout query path (the `FOR UPDATE SKIP LOCKED` subquery is what
 * makes concurrent checkouts safe — that's what this test is proving).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ KEEP THIS IN SYNC with src/lib/mastra/heartbeat.ts:37-66              │
 * │ (function `checkoutNextTask`, SQL body at lines 38-61). If that query  │
 * │ changes, update CHECKOUT_SQL below to match or this test is stale.    │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * We deliberately run this at the SQL layer via db.execute(sql.raw(...))
 * with the agentId manually interpolated into the query text — sql.raw()
 * takes a plain string with no placeholder binding, so this is the only way
 * to reuse heartbeat.ts's exact statement shape outside the module. This is
 * safe here because agentId is always a server-generated UUID (validated
 * below before interpolation), never external input.
 */
import '../governance/load-env';
import { db } from '@/lib/db';
import { agents, tasks, projects } from '@/lib/db/schema';
import type { Task } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

const N_WORKERS = 8;
const M_TASKS = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function evidence(label: string, data: unknown) {
  console.log(`\nEVIDENCE [${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

// ─── EXACT COPY of the checkout query, see heartbeat.ts:38-61 ─────────
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
      SELECT id FROM tasks
      WHERE assigned_agent_id = '${agentId}'
        AND status = 'open'
        AND locked_by IS NULL
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low'    THEN 3
        END ASC,
        created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
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
  let project: typeof projects.$inferSelect | null = null;
  let agent: typeof agents.$inferSelect | null = null;

  try {
    // ── Scratch fixtures ──
    [project] = await db
      .insert(projects)
      .values({
        name: `Load Test Checkout Contention ${runId}`,
        sourceType: 'manual',
        workspacePath: null,
        status: 'active',
      })
      .returning();

    [agent] = await db
      .insert(agents)
      .values({
        projectId: project.id,
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
        Array.from({ length: M_TASKS }, (_, i) => ({
          projectId: project!.id,
          assignedAgentId: agent!.id,
          title: `Contention scratch task ${i}`,
          description: 'Never executed — checkout-contention load test fixture.',
          status: 'open',
          priority: 'medium',
        })),
      )
      .returning({ id: tasks.id });

    evidence('setup', {
      projectId: project.id,
      agentId: agent.id,
      workers: N_WORKERS,
      tasksSeeded: insertedTasks.length,
    });

    // ── N workers concurrently drain the queue via the real checkout query ──
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

    // ── Final cleanup pass: release every lock, then assert none remain ──
    await db
      .update(tasks)
      .set({ lockedBy: null, lockedAt: null, updatedAt: new Date() })
      .where(eq(tasks.projectId, project.id));

    const stillLocked = await db.query.tasks.findMany({
      where: (t, { eq: eqOp, and: andOp, isNotNull }) =>
        andOp(eqOp(t.projectId, project!.id), isNotNull(t.lockedBy)),
    });
    const noLocksRemain = stillLocked.length === 0;

    evidence('post-cleanup', { stillLockedCount: stillLocked.length });

    const pass = noDuplicates && totalMatches && allSeededTasksAccountedFor && noLocksRemain;
    console.log(
      pass
        ? `PASS: ${N_WORKERS} workers checked out ${allCheckedOut.length}/${M_TASKS} tasks via the real FOR UPDATE SKIP LOCKED query, zero duplicates, zero lingering locks after cleanup`
        : `FAIL: duplicates=${!noDuplicates} totalMismatch=${!totalMatches} missingSeeded=${!allSeededTasksAccountedFor} locksRemain=${!noLocksRemain}`,
    );
    process.exitCode = pass ? 0 : 1;
  } finally {
    // Scratch row cleanup — order matters for FK constraints: tasks before
    // agents/projects, agents before projects.
    if (project) {
      await db.delete(tasks).where(eq(tasks.projectId, project.id));
    }
    if (agent) {
      await db.delete(agents).where(eq(agents.id, agent.id));
    }
    if (project) {
      await db.delete(projects).where(eq(projects.id, project.id));
    }
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
