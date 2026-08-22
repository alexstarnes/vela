/**
 * Exercise: containment ceilings.
 *
 * A) maxIterations — Supervisor temporarily capped at 2 iterations; a task
 *    that invites endless exploration must stop at ≤2 iterations per step
 *    and terminate (no hang).
 * B) wall-clock — createWorkflowStepTelemetry with a 1.5s ceiling must abort
 *    a non-terminating agent loop and log the wall_clock_timeout event.
 * C) CLI child lifetime — the helper must kill a claude run at timeoutMs and
 *    leave no orphan process.
 */
import './load-env';
import {
  db, agents, tasks, eq,
  getAgentByName, getProjectByName, snapshotAgentBudget, restoreAgentBudget,
  createTestTask, login, triggerHeartbeatForTask, waitFor, taskStatus,
  eventsOfType, evidence,
} from './util';
import { execSync } from 'node:child_process';

async function main() {
  const supervisor = await getAgentByName('Supervisor');
  const project = await getProjectByName('Phase0 E2E');
  const snap = await snapshotAgentBudget(supervisor.id);
  const cookie = await login();
  const report: Record<string, unknown> = {};
  const taskIds: string[] = [];

  try {
    // ── A) maxIterations ──
    await db.update(agents).set({
      maxIterations: 2, budgetMonthlyUsd: null, budgetMonthlyRuns: null,
      status: 'active', updatedAt: new Date(),
    }).where(eq(agents.id, supervisor.id));

    const iterTaskId = await createTestTask({
      projectId: project.id, agentId: supervisor.id,
      title: 'Containment probe: survey the repository',
      description:
        'Read every file in the repository one at a time with read_workspace_file and produce a long summary of each. ' +
        'Do not edit or create any files. Be exhaustive.',
    });
    taskIds.push(iterTaskId);
    const t0 = new Date().toISOString();
    await triggerHeartbeatForTask(cookie, iterTaskId);
    const iterStatus = await waitFor(
      async () => {
        const row = await db.query.tasks.findFirst({ where: eq(tasks.id, iterTaskId) });
        if (!row || row.lockedBy !== null || row.status === 'in_progress') return null;
        if (['review', 'blocked', 'waiting_for_human', 'done'].includes(row.status)) return row.status;
        if (row.status === 'open' && (await eventsOfType(iterTaskId, 'scorecard')).some((s) => s.createdAt.toISOString() > t0)) return row.status;
        return null;
      },
      { timeoutMs: 8 * 60_000, label: 'maxIterations probe to terminate' },
    );

    const modelCalls = await eventsOfType(iterTaskId, 'model_call');
    const iterationsByStep = new Map<string, number>();
    for (const call of modelCalls) {
      const p = call.payload as { workflow_step_id?: string; iteration?: number };
      if (p?.workflow_step_id && typeof p.iteration === 'number') {
        iterationsByStep.set(p.workflow_step_id, Math.max(iterationsByStep.get(p.workflow_step_id) ?? 0, p.iteration));
      }
    }
    report.max_iterations = {
      final_status: iterStatus,
      cap: 2,
      max_iteration_seen_per_step: Object.fromEntries(iterationsByStep),
      terminated_without_hang: true,
    };

    // Restore iteration cap before the next stages.
    await db.update(agents).set({ maxIterations: snap.maxIterations, updatedAt: new Date() }).where(eq(agents.id, supervisor.id));

    // ── B) wall-clock ceiling on the step telemetry ──
    const { createWorkflowStepTelemetry } = await import('@/lib/mastra/workflows/steps/agent-telemetry');
    const wcTaskId = await createTestTask({
      projectId: project.id, agentId: supervisor.id,
      title: 'Containment probe: wall-clock telemetry target',
      description: 'Holds the task_events for the wall-clock telemetry exercise. Never executed.',
    });
    taskIds.push(wcTaskId);
    await db.update(tasks).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(tasks.id, wcTaskId));

    const telemetry = createWorkflowStepTelemetry({
      taskId: wcTaskId,
      agentId: supervisor.id,
      stepId: 'containment-wallclock-probe',
      resolvedModelId: 'test/non-terminating',
      maxWallClockMs: 1500,
    });

    const start = Date.now();
    const aborted = await Promise.race([
      new Promise<boolean>((resolve) => {
        if (telemetry.abortSignal.aborted) resolve(true);
        telemetry.abortSignal.addEventListener('abort', () => resolve(true));
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    const elapsedMs = Date.now() - start;
    await new Promise((r) => setTimeout(r, 1000)); // let the event insert land
    const wcEvents = (await eventsOfType(wcTaskId, 'error'))
      .filter((e) => (e.payload as { kind?: string })?.kind === 'wall_clock_timeout');

    report.wall_clock = {
      ceiling_ms: 1500,
      aborted,
      elapsed_ms: elapsedMs,
      timeout_events: wcEvents.map((e) => e.payload),
    };

    // ── C) CLI child lifetime via the helper ──
    const helperSecret = process.env.VELA_HELPER_SECRET!;
    const helperUrl = process.env.VELA_HELPER_URL ?? 'http://localhost:4312';
    const cliRes = await fetch(`${helperUrl}/cli/execute`, {
      method: 'POST',
      headers: { 'x-vela-helper-secret': helperSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cli: 'claude',
        workspacePath: project.workspacePath,
        prompt: 'Containment timeout probe — reply OK',
        timeoutMs: 1500,
        maxTurns: 1,
      }),
    }).then((r) => r.json());

    let orphans = '';
    try {
      orphans = execSync("pgrep -lf 'Containment timeout probe' || true", { encoding: 'utf8' }).trim();
    } catch { /* pgrep exit 1 = none */ }

    report.cli_child_lifetime = {
      error_kind: cliRes?.data?.errorKind,
      result_snippet: String(cliRes?.data?.resultText ?? '').slice(0, 120),
      orphan_processes_after: orphans || 'none',
    };

    evidence('containment', report);

    const maxIterOk = [...iterationsByStep.values()].every((n) => n <= 2) && !!iterStatus;
    const wallClockOk = aborted && elapsedMs < 4000 && wcEvents.length === 1;
    const cliOk = cliRes?.data?.errorKind === 'timeout' && !orphans;
    console.log(`maxIterations: ${maxIterOk ? 'PASS' : 'FAIL'} | wall-clock: ${wallClockOk ? 'PASS' : 'FAIL'} | CLI timeout: ${cliOk ? 'PASS' : 'FAIL'}`);
    process.exitCode = maxIterOk && wallClockOk && cliOk ? 0 : 1;
  } finally {
    await restoreAgentBudget(supervisor.id, snap);
    for (const id of taskIds) {
      const s = await taskStatus(id).catch(() => null);
      if (s && ['open', 'review', 'blocked', 'waiting_for_human'].includes(s)) {
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
