/**
 * Stale-lock recovery exercise — staged, because the process kill happens
 * outside this script (the orchestrator kills the dev server for real).
 *
 *   setup   — create+trigger a task, wait until it is in_progress and locked
 *   check   — after the kill: assert the task is stuck locked, then age the
 *             lock past the 10-minute threshold (clock-fake; the kill itself
 *             was real)
 *   verify  — after dev-server restart: wait for scheduler cleanup to requeue
 *             the task (open, unlocked)
 *
 * Run: npx tsx tests/governance/stale-lock.ts <setup|check|verify> [taskId]
 */
import './load-env';
import {
  db, tasks, eq,
  getAgentByName, getProjectByName, createTestTask, login,
  triggerHeartbeatForTask, waitFor, evidence,
} from './util';

const stage = process.argv[2];
const argTaskId = process.argv[3];

async function main() {
  if (stage === 'setup') {
    const supervisor = await getAgentByName('Supervisor');
    const project = await getProjectByName('Phase0 E2E');
    const cookie = await login();
    const taskId = await createTestTask({
      projectId: project.id,
      agentId: supervisor.id,
      title: `Stale-lock exercise ${Date.now().toString(36)}`,
      description:
        'Read every file in the repository with read_workspace_file and summarize each one in detail. Do not edit anything.',
    });
    await triggerHeartbeatForTask(cookie, taskId);
    await waitFor(
      async () => {
        const row = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
        return row?.status === 'in_progress' && row.lockedBy ? row : null;
      },
      { timeoutMs: 60_000, intervalMs: 2000, label: 'task to be checked out and locked' },
    );
    console.log(`TASK_ID=${taskId}`);
    process.exit(0);
  }

  if (stage === 'check') {
    const row = await db.query.tasks.findFirst({ where: eq(tasks.id, argTaskId!) });
    evidence('stale-lock-after-kill', {
      status: row!.status,
      locked_by: row!.lockedBy,
      locked_at: row!.lockedAt,
      stuck: row!.status === 'in_progress' && row!.lockedBy !== null,
    });
    if (!(row!.status === 'in_progress' && row!.lockedBy)) {
      console.log('FAIL: task is not stuck-locked after the kill');
      process.exit(1);
    }
    // The kill was real; only the 10-minute clock is faked.
    await db
      .update(tasks)
      .set({ lockedAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(tasks.id, argTaskId!));
    console.log('PASS: task stuck-locked; lock aged past the threshold');
    process.exit(0);
  }

  if (stage === 'verify') {
    const recovered = await waitFor(
      async () => {
        const row = await db.query.tasks.findFirst({ where: eq(tasks.id, argTaskId!) });
        return row?.status === 'open' && row.lockedBy === null && row.lockedAt === null ? row : null;
      },
      { timeoutMs: 6.5 * 60_000, intervalMs: 10_000, label: 'scheduler cleanup to requeue the task' },
    );
    evidence('stale-lock-recovered', {
      status: recovered.status,
      locked_by: recovered.lockedBy,
      locked_at: recovered.lockedAt,
    });
    // Park it so nothing picks it up again.
    await db.update(tasks).set({ status: 'cancelled' }).where(eq(tasks.id, argTaskId!));
    console.log('PASS: killed-process task recovered to open with locks cleared');
    process.exit(0);
  }

  console.error('Usage: stale-lock.ts <setup|check|verify> [taskId]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
