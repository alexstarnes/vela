/**
 * VERIFY B — dependency ordering is enforced at checkout.
 *
 * Asserts, against the live database and the real checkout SQL:
 *   1. with a chain A→B→C all `open`, checkout picks only A
 *   2. marking A done makes B eligible
 *   3. C never runs early
 *   4. the synthesizer's `depends_on` survives the whole data path —
 *      synthesisSchema → normalize → task_dependencies rows
 *
 * The gate is computed from the edges on every checkout rather than cached
 * into task status, so this exercises exactly what the scheduler executes.
 *
 *   npx tsx tests/governance/dependency-ordering.ts
 */
import './load-env';
import { db } from '@/lib/db';
import { agents, projects, taskDependencies, tasks } from '@/lib/db/schema';
import type { Task } from '@/lib/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { evidence } from './util';
import {
  createTaskDependencies,
  normalizeBacklogDependencies,
} from '@/lib/tasks/dependencies';
import { synthesisSchema } from '@/lib/mastra/workflows/steps/ring-shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The real checkout statement.
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ KEEP IN SYNC with src/lib/mastra/heartbeat.ts `checkoutNextTask`. │
 * └──────────────────────────────────────────────────────────────────┘
 */
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
  return rows?.[0] ?? null;
}

/** Complete a checked-out task so the next one becomes eligible. */
async function markDone(taskId: string) {
  await db
    .update(tasks)
    .set({ status: 'done', lockedBy: null, lockedAt: null, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
}

async function main() {
  const runId = Date.now();
  let project: typeof projects.$inferSelect | null = null;
  let agent: typeof agents.$inferSelect | null = null;
  const failures: string[] = [];

  try {
    [project] = await db
      .insert(projects)
      .values({
        name: `Dependency Ordering Exercise ${runId}`,
        sourceType: 'manual',
        workspacePath: null,
        status: 'active',
      })
      .returning();

    [agent] = await db
      .insert(agents)
      .values({
        projectId: project.id,
        name: `Dependency Ordering Scratch ${runId}`,
        role: 'exercise scratch agent',
        agentKind: 'legacy_reference',
        heartbeatEnabled: false,
        status: 'active',
      })
      .returning();

    // ── Synthetic backlog: A → B → C, created flat and all `open` ──
    const seeded = await db
      .insert(tasks)
      .values(
        ['A: create the store', 'B: import into the store', 'C: detect duplicates'].map((title) => ({
          projectId: project!.id,
          assignedAgentId: agent!.id,
          title,
          description: 'Never executed — dependency-ordering exercise fixture.',
          status: 'open',
          priority: 'medium',
        })),
      )
      .returning({ id: tasks.id, title: tasks.title });

    const [a, b, c] = seeded;
    const { edges, warnings } = normalizeBacklogDependencies([
      { title: a.title, depends_on: [] },
      { title: b.title, depends_on: [0] },
      { title: c.title, depends_on: [1] },
    ]);
    const written = await createTaskDependencies(
      edges.map((edge) => ({
        taskId: seeded[edge.index].id,
        dependsOnTaskId: seeded[edge.dependsOnIndex].id,
      })),
    );

    evidence('setup', {
      projectId: project.id,
      agentId: agent.id,
      tasks: seeded.map((t) => ({ id: t.id, title: t.title })),
      edgesWritten: written,
      warnings,
    });

    if (written !== 2) failures.push(`expected 2 dependency edges, wrote ${written}`);

    // ── 1. All open: only A is eligible ──
    const first = await checkoutNextTask(agent.id);
    evidence('checkout-1', { pickedId: first?.id ?? null, pickedTitle: first?.title ?? null });
    if (first?.id !== a.id) {
      failures.push(`first checkout should be "${a.title}", got "${first?.title ?? 'nothing'}"`);
    }

    // Nothing else may be checked out while A is in flight — the dependency
    // gate and per-project serialization both say no.
    const whileRunning = await checkoutNextTask(agent.id);
    evidence('checkout-while-a-running', { pickedTitle: whileRunning?.title ?? null });
    if (whileRunning) {
      failures.push(`nothing should be checked out while A runs, got "${whileRunning.title}"`);
    }

    // ── 2. A done → B eligible, C still blocked ──
    await markDone(a.id);
    const second = await checkoutNextTask(agent.id);
    evidence('checkout-2', { pickedTitle: second?.title ?? null });
    if (second?.id !== b.id) {
      failures.push(`second checkout should be "${b.title}", got "${second?.title ?? 'nothing'}"`);
    }

    // ── 3. C only after B ──
    await markDone(b.id);
    const third = await checkoutNextTask(agent.id);
    evidence('checkout-3', { pickedTitle: third?.title ?? null });
    if (third?.id !== c.id) {
      failures.push(`third checkout should be "${c.title}", got "${third?.title ?? 'nothing'}"`);
    }

    const cRanEarly = [first, whileRunning, second].some((task) => task?.id === c.id);
    if (cRanEarly) failures.push('C was checked out before its prerequisites landed');

    // ── 4. Ring-side: depends_on survives the synthesizer contract ──
    // The live-model half is the existing weak-PRD ring fixture; this asserts
    // the data path a compliant synthesizer response travels.
    const parsed = synthesisSchema.parse({
      revised_prd_md: 'x'.repeat(60),
      backlog: [
        {
          title: 'Save records',
          description: 'As a user I can save a record.',
          acceptance_criteria: ['A saved record survives a reload'],
          source_findings: ['PRD Auditor/1'],
        },
        {
          title: 'Duplicate detection',
          description: 'As a user I am warned about duplicates.',
          acceptance_criteria: ['Saving a duplicate warns me'],
          source_findings: ['PRD Auditor/2'],
          depends_on: [0],
        },
      ],
      reconciliation: [],
      escalations: [],
    });

    const ringEdges = normalizeBacklogDependencies(parsed.backlog).edges;
    evidence('synthesizer-contract', {
      omittedDefaultsTo: parsed.backlog[0].depends_on,
      declared: parsed.backlog[1].depends_on,
      edges: ringEdges,
    });

    if (parsed.backlog[0].depends_on.length !== 0) {
      failures.push('an omitted depends_on should default to no prerequisites');
    }
    if (ringEdges.length !== 1 || ringEdges[0].dependsOnIndex !== 0) {
      failures.push('a declared depends_on should produce exactly one edge');
    }

    // ...and that a synthesizer-shaped payload lands as real rows.
    const ringTasks = await db
      .insert(tasks)
      .values(
        parsed.backlog.map((story) => ({
          projectId: project!.id,
          assignedAgentId: null,
          title: `[ring] ${story.title}`,
          description: story.description,
          status: 'backlog',
          priority: 'medium',
        })),
      )
      .returning({ id: tasks.id });

    await createTaskDependencies(
      ringEdges.map((edge) => ({
        taskId: ringTasks[edge.index].id,
        dependsOnTaskId: ringTasks[edge.dependsOnIndex].id,
      })),
    );

    const persisted = await db.query.taskDependencies.findMany({
      where: inArray(
        taskDependencies.taskId,
        ringTasks.map((t) => t.id),
      ),
    });
    evidence('synthesizer-edges-persisted', { rows: persisted.length });
    if (persisted.length !== 1) {
      failures.push(`expected 1 persisted ring edge, found ${persisted.length}`);
    }

    console.log(
      failures.length === 0
        ? '\nPASS: the checkout gate admitted A → B → C strictly in dependency order, never C early, and a synthesizer depends_on survived to task_dependencies rows'
        : `\nFAIL:\n  - ${failures.join('\n  - ')}`,
    );
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    if (project) {
      const projectTasks = await db.query.tasks.findMany({
        where: eq(tasks.projectId, project.id),
        columns: { id: true },
      });
      if (projectTasks.length > 0) {
        await db.delete(taskDependencies).where(
          inArray(
            taskDependencies.taskId,
            projectTasks.map((t) => t.id),
          ),
        );
      }
      await db.delete(tasks).where(eq(tasks.projectId, project.id));
    }
    if (agent) await db.delete(agents).where(eq(agents.id, agent.id));
    if (project) await db.delete(projects).where(eq(projects.id, project.id));
  }

  process.exit(process.exitCode ?? 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
