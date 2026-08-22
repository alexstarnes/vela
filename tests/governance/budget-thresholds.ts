/**
 * Exercise: dollar budget enforcement under real conditions.
 *
 * Supervisor gets a deliberately tiny dollar budget. Real pipeline runs
 * (review/synthesize steps bill ~$0.002 on gpt-5.4-mini) must cross 80%
 * (budget_warning) then 100% (budget_exceeded + auto-pause + blocked task).
 * Then: monthly reset by faking budget_reset_at, and operator override via
 * the real activateAgent action (asserting the audit record).
 */
import './load-env';
import {
  db, agents, tasks, eq, and, desc, taskEvents,
  getAgentByName, getProjectByName, snapshotAgentBudget, restoreAgentBudget,
  createTestTask, login, triggerHeartbeatForTask, waitFor, taskStatus,
  eventsOfType, evidence,
} from './util';

async function waitForRunEnd(taskId: string, sinceIso: string, timeoutMs = 6 * 60_000) {
  // A heartbeat run has ended when the lock is released and the task is out
  // of in_progress (review/blocked/waiting_for_human, or requeued to open
  // after the attempt loop) with at least one scorecard or blocking event
  // newer than the trigger.
  return waitFor(
    async () => {
      const row = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
      if (!row || row.lockedBy !== null || row.status === 'in_progress') return null;
      if (['review', 'blocked', 'waiting_for_human', 'done'].includes(row.status)) return row.status;
      if (row.status === 'open') {
        const scorecards = await eventsOfType(taskId, 'scorecard');
        if (scorecards.some((s) => s.createdAt.toISOString() > sinceIso)) return 'open';
      }
      return null;
    },
    { timeoutMs, label: `run end for task ${taskId}` },
  );
}

async function main() {
  const nonce = Date.now().toString(36);
  const supervisor = await getAgentByName('Supervisor');
  const project = await getProjectByName('Phase0 E2E');
  const snap = await snapshotAgentBudget(supervisor.id);
  const cookie = await login();
  const taskIds: string[] = [];

  const report: Record<string, unknown> = {};

  try {
    // ── Stage 1: tiny dollar budget, run until 80% then 100% ──
    await db.update(agents).set({
      budgetMonthlyUsd: '0.01',
      budgetUsedUsd: '0',
      budgetMonthlyRuns: null,
      budgetUsedRuns: 0,
      status: 'active',
      updatedAt: new Date(),
    }).where(eq(agents.id, supervisor.id));

    let exceededTaskId: string | null = null;
    const stage1: Array<Record<string, unknown>> = [];

    for (let run = 1; run <= 8; run += 1) {
      const startedAt = new Date().toISOString();
      const taskId = await createTestTask({
        projectId: project.id,
        agentId: supervisor.id,
        title: `Dollar-budget exercise ${run}: touch note ${nonce}`,
        description: `Create a new file named dollar-note-${nonce}-${run}.txt containing "spend run ${run}". Do not change any other file.`,
      });
      taskIds.push(taskId);
      await triggerHeartbeatForTask(cookie, taskId);
      const endStatus = await waitForRunEnd(taskId, startedAt);

      const agentRow = await db.query.agents.findFirst({ where: eq(agents.id, supervisor.id) });
      stage1.push({
        run, taskId, endStatus,
        agent_status: agentRow!.status,
        used_usd: agentRow!.budgetUsedUsd,
      });
      console.log(`stage1 run ${run}: task=${endStatus} agent=${agentRow!.status} used=$${agentRow!.budgetUsedUsd}`);

      if (agentRow!.status === 'budget_exceeded') {
        exceededTaskId = taskId;
        break;
      }
    }
    report.stage1_runs = stage1;

    if (!exceededTaskId) throw new Error('Dollar budget never reached 100% — raise run count or lower limit');

    // Evidence: warning + exceeded events (dollar metric has used_usd payload)
    const dollarWarnings: unknown[] = [];
    const dollarExceeded: unknown[] = [];
    for (const id of taskIds) {
      for (const w of await eventsOfType(id, 'budget_warning')) {
        if ((w.payload as { used_usd?: number })?.used_usd !== undefined) dollarWarnings.push({ task: id, payload: w.payload, at: w.createdAt });
      }
      for (const x of await eventsOfType(id, 'budget_exceeded')) {
        if ((x.payload as { used_usd?: number })?.used_usd !== undefined) dollarExceeded.push({ task: id, payload: x.payload, at: x.createdAt });
      }
    }
    report.dollar_warning_events = dollarWarnings;
    report.dollar_exceeded_events = dollarExceeded;
    report.exceeding_task_status = await taskStatus(exceededTaskId);
    report.exceeding_task_blocked_event = (await eventsOfType(exceededTaskId, 'status_change'))
      .map((e) => e.payload)
      .find((p) => (p as { to?: string })?.to === 'blocked');

    // New checkout must be blocked while exceeded.
    const blockedProbeId = await createTestTask({
      projectId: project.id, agentId: supervisor.id,
      title: `Dollar-budget probe ${nonce}: must not execute`,
      description: `Create a new file named dollar-note-${nonce}-probe.txt containing "probe". Must be blocked by the exceeded budget.`,
    });
    taskIds.push(blockedProbeId);
    await triggerHeartbeatForTask(cookie, blockedProbeId);
    await new Promise((r) => setTimeout(r, 8000));
    report.blocked_probe = {
      status: await taskStatus(blockedProbeId),
      heartbeat_start_events: (await eventsOfType(blockedProbeId, 'heartbeat_start')).length,
    };

    // ── Stage 2: operator override via the real activateAgent action ──
    // The agent is genuinely budget_exceeded from stage 1's real spends.
    const beforeOverride = await db.query.agents.findFirst({ where: eq(agents.id, supervisor.id) });
    report.before_override_status = beforeOverride!.status;

    const overrideAt = new Date();
    const { activateAgent } = await import('@/lib/actions/agents');
    try {
      await activateAgent(supervisor.id);
    } catch (err) {
      // revalidatePath outside a Next request context can throw after the DB
      // writes have landed — the assertions below verify the real effects.
      report.activate_agent_threw = String(err);
    }

    const afterOverride = await db.query.agents.findFirst({ where: eq(agents.id, supervisor.id) });
    const auditRows = await db.query.approvals.findMany({
      where: (a, { eq: eqOp, and: andOp }) => andOp(eqOp(a.agentId, supervisor.id), eqOp(a.actionType, 'budget_override')),
      orderBy: (a, { desc: descOp }) => [descOp(a.createdAt)],
      limit: 1,
    });
    const auditRow = auditRows[0] && auditRows[0].createdAt >= overrideAt ? auditRows[0] : null;
    report.after_override = {
      status: afterOverride!.status,
      audit_record: auditRow
        ? { description: auditRow.description, action_type: auditRow.actionType, status: auditRow.status }
        : null,
    };

    // ── Stage 3: monthly reset via faked boundary ──
    // used still exceeds the tiny limit, so without a reset the next
    // precondition would re-pause. Fake the boundary; the lazy reset inside
    // the next heartbeat's precondition must zero the counters and let the
    // probe run.
    await db.update(agents).set({
      budgetResetAt: new Date(Date.now() - 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(agents.id, supervisor.id));

    const resetProbeStart = new Date().toISOString();
    await triggerHeartbeatForTask(cookie, blockedProbeId);
    await waitForRunEnd(blockedProbeId, resetProbeStart);

    const afterReset = await db.query.agents.findFirst({ where: eq(agents.id, supervisor.id) });
    report.after_reset = {
      status: afterReset!.status,
      used_usd: afterReset!.budgetUsedUsd,
      used_runs: afterReset!.budgetUsedRuns,
      reset_at_advanced_to: afterReset!.budgetResetAt,
      reset_probe_ran: (await eventsOfType(blockedProbeId, 'heartbeat_start')).length > 0,
    };

    evidence('budget-thresholds', report);

    const pass =
      dollarWarnings.length >= 1 &&
      dollarExceeded.length >= 1 &&
      report.exceeding_task_status === 'blocked' &&
      (report.blocked_probe as { heartbeat_start_events: number }).heartbeat_start_events === 0 &&
      report.before_override_status === 'budget_exceeded' &&
      afterOverride!.status === 'active' &&
      auditRow !== null &&
      (report.after_reset as { status: string }).status === 'active' &&
      parseFloat((report.after_reset as { used_usd: string }).used_usd) < 0.01 &&
      (report.after_reset as { reset_probe_ran: boolean }).reset_probe_ran === true;
    console.log(pass ? 'PASS: dollar 80%/100%, blocked checkout, logged override, faked reset' : 'FAIL: see evidence');
    process.exitCode = pass ? 0 : 1;
  } finally {
    await restoreAgentBudget(supervisor.id, snap);
    for (const id of taskIds) {
      const status = await taskStatus(id).catch(() => null);
      if (status && ['open', 'review', 'blocked', 'waiting_for_human'].includes(status)) {
        await db.update(tasks).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(tasks.id, id));
      }
    }
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
