/**
 * Exercise: the run-count budget metric under real conditions.
 *
 * The Supervisor gets budgetMonthlyRuns=5 and no dollar limit. Five real
 * heartbeat runs on $0-lane tasks must produce: budget_warning (metric:runs)
 * at run 4 (80%), budget_exceeded + agent auto-pause at run 5 (100%), and a
 * blocked checkout on the attempted 6th run. This is exactly the scenario the
 * metric exists for: free lanes are invisible to the dollar budget.
 */
import './load-env';
import {
  db, agents, tasks, eq,
  getAgentByName, getProjectByName, snapshotAgentBudget, restoreAgentBudget,
  createTestTask, login, triggerHeartbeatForTask, waitFor, taskStatus,
  eventsOfType, evidence,
} from './util';

async function main() {
  const supervisor = await getAgentByName('Supervisor');
  const project = await getProjectByName('Phase0 E2E');
  const snap = await snapshotAgentBudget(supervisor.id);
  const cookie = await login();

  const taskIds: string[] = [];
  try {
    // Configure: 5 runs/month, dollar budget off, counters zeroed.
    await db.update(agents).set({
      budgetMonthlyRuns: 5,
      budgetUsedRuns: 0,
      budgetMonthlyUsd: null,
      status: 'active',
      updatedAt: new Date(),
    }).where(eq(agents.id, supervisor.id));

    const results: Array<Record<string, unknown>> = [];

    for (let run = 1; run <= 5; run += 1) {
      const taskId = await createTestTask({
        projectId: project.id,
        agentId: supervisor.id,
        title: `Run-budget exercise ${run}/5: touch note file`,
        description:
          `Create a new file named run-budget-note-${run}.txt containing the single line "governance run ${run}". Do not change any other file.`,
      });
      taskIds.push(taskId);

      const trigger = await triggerHeartbeatForTask(cookie, taskId);
      if (!trigger.started) throw new Error(`Heartbeat ${run} did not start: ${JSON.stringify(trigger)}`);

      await waitFor(
        async () => {
          const status = await taskStatus(taskId);
          return ['review', 'open', 'blocked', 'waiting_for_human', 'done'].includes(status) ? status : null;
        },
        { timeoutMs: 5 * 60_000, label: `run ${run} to finish` },
      );

      const agentRow = await db.query.agents.findFirst({ where: eq(agents.id, supervisor.id) });
      results.push({
        run,
        task: taskId,
        task_status: await taskStatus(taskId),
        agent_status: agentRow!.status,
        budget_used_runs: agentRow!.budgetUsedRuns,
      });
      console.log(`run ${run}: agent=${agentRow!.status} used_runs=${agentRow!.budgetUsedRuns}`);
    }

    // Collect the evidence events from all exercise tasks.
    const warnings = [] as unknown[];
    const exceeded = [] as unknown[];
    for (const id of taskIds) {
      for (const w of await eventsOfType(id, 'budget_warning')) {
        if ((w.payload as { metric?: string })?.metric === 'runs') warnings.push({ task: id, payload: w.payload, at: w.createdAt });
      }
      for (const x of await eventsOfType(id, 'budget_exceeded')) {
        if ((x.payload as { metric?: string })?.metric === 'runs') exceeded.push({ task: id, payload: x.payload, at: x.createdAt });
      }
    }

    const agentAfter = await db.query.agents.findFirst({ where: eq(agents.id, supervisor.id) });

    // Attempted 6th run must be blocked at the precondition gate.
    const extraTaskId = await createTestTask({
      projectId: project.id,
      agentId: supervisor.id,
      title: 'Run-budget exercise 6: must NOT execute',
      description: 'Create run-budget-note-6.txt. This task must be blocked by the run budget.',
    });
    taskIds.push(extraTaskId);
    const sixth = await triggerHeartbeatForTask(cookie, extraTaskId);
    // Fire-and-forget API always returns started; the gate acts inside. Give it a moment.
    await new Promise((r) => setTimeout(r, 8000));
    const sixthStatus = await taskStatus(extraTaskId);
    const sixthEvents = await eventsOfType(extraTaskId, 'heartbeat_start');

    evidence('run-budget', {
      per_run: results,
      warning_events: warnings,
      exceeded_events: exceeded,
      agent_status_after_run5: agentAfter!.status,
      used_runs_after_run5: agentAfter!.budgetUsedRuns,
      sixth_run_trigger: sixth,
      sixth_task_status_after_8s: sixthStatus,
      sixth_task_heartbeat_start_events: sixthEvents.length,
    });

    const pass =
      warnings.length >= 1 &&
      exceeded.length >= 1 &&
      agentAfter!.status === 'budget_exceeded' &&
      sixthStatus === 'open' &&
      sixthEvents.length === 0;
    console.log(pass ? 'PASS: run budget warned at 80%, paused at 100%, blocked checkout after' : 'FAIL: see evidence');
    process.exitCode = pass ? 0 : 1;
  } finally {
    await restoreAgentBudget(supervisor.id, snap);
    // Park exercise tasks so they don't linger in the queue.
    for (const id of taskIds) {
      const status = await taskStatus(id).catch(() => null);
      if (status && ['open', 'review', 'blocked', 'waiting_for_human'].includes(status)) {
        await db.update(tasks).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(tasks.id, id));
      }
    }
  }
  process.exit(process.exitCode ?? 0);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
