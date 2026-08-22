/**
 * Phase 5 authorization exercise — drives the REAL bot approval handler with
 * synthetic button interactions against the live dev server + DB.
 *
 * The mandatory negative test: a non-allowlisted Discord user pressing
 * Approve must be rejected and logged, and the approval must stay pending.
 * Then the positive path: an allowlisted press approves through the app's
 * API, the audit trail names the operator, and the task advances.
 *
 * Run: npx tsx tests/discord/handler-auth.ts   (dev server must be running)
 */
process.env.VELA_DISCORD_BOT_NO_START = '1';

import '../governance/load-env';
import { db, tasks, taskEvents, eq, evidence } from '../governance/util';
import { getProjectByName, createTestTask } from '../governance/util';
import { approvals, agents } from '@/lib/db/schema';

type Reply = { content?: string; ephemeral?: boolean };

function makeInteraction(params: {
  customId: string;
  userId: string;
  tag: string;
}) {
  const calls: { replies: Reply[]; updated: boolean; followUps: Reply[] } = {
    replies: [],
    updated: false,
    followUps: [],
  };
  const interaction = {
    customId: params.customId,
    user: { id: params.userId, tag: params.tag, username: params.tag.split('#')[0] },
    message: { embeds: [] },
    reply: async (payload: Reply) => {
      calls.replies.push(payload);
    },
    update: async () => {
      calls.updated = true;
    },
    followUp: async (payload: Reply) => {
      calls.followUps.push(payload);
    },
  };
  return { interaction, calls };
}

async function main() {
  const bot = await import('../../scripts/vela-discord-bot');
  const project = await getProjectByName('Phase0 E2E');
  const synthesizer = await db.query.agents.findFirst({
    where: (a, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(a.name, 'Synthesizer'), eqOp(a.agentKind, 'runtime')),
  });

  const operatorId = (process.env.DISCORD_OPERATOR_IDS ?? '').split(',')[0].trim();
  if (!operatorId) throw new Error('DISCORD_OPERATOR_IDS not configured');

  const taskId = await createTestTask({
    projectId: project.id,
    agentId: synthesizer!.id,
    title: 'Discord auth exercise task',
    description: 'Scratch task holding a pending approval for the Discord allowlist exercise.',
  });
  await db.update(tasks).set({ status: 'in_progress' }).where(eq(tasks.id, taskId));
  await db.update(tasks).set({ status: 'waiting_for_human' }).where(eq(tasks.id, taskId));

  const [approval] = await db
    .insert(approvals)
    .values({
      agentId: synthesizer!.id,
      taskId,
      actionType: 'prd_backlog',
      description: 'Discord allowlist exercise approval',
      payload: { backlog: [], project_id: project.id, prd_revision: 1 },
      status: 'pending',
    })
    .returning();

  const report: Record<string, unknown> = {};

  try {
    // ── Negative test: non-allowlisted user presses Approve ──
    const intruder = makeInteraction({
      customId: `vela-approve:${approval.id}`,
      userId: '111111111111111111',
      tag: 'intruder#0001',
    });
    await bot.handleApprovalButton(intruder.interaction as never);

    const afterIntruder = await db.query.approvals.findFirst({ where: eq(approvals.id, approval.id) });
    report.negative = {
      is_operator: bot.isOperator('111111111111111111'),
      approval_status_after: afterIntruder!.status,
      rejection_reply: intruder.calls.replies[0]?.content ?? null,
      api_side_effect: afterIntruder!.status === 'pending' ? 'none — enforcement held' : 'APPROVAL CHANGED — FAILURE',
    };

    // ── Positive test: the allowlisted operator presses Approve ──
    const operator = makeInteraction({
      customId: `vela-approve:${approval.id}`,
      userId: operatorId,
      tag: 'operator#0000',
    });
    await bot.handleApprovalButton(operator.interaction as never);

    const afterOperator = await db.query.approvals.findFirst({ where: eq(approvals.id, approval.id) });
    const taskAfter = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
    report.positive = {
      is_operator: bot.isOperator(operatorId),
      approval_status_after: afterOperator!.status,
      reviewer_notes: afterOperator!.reviewerNotes,
      task_status_after: taskAfter!.status,
      followup_reply: operator.calls.followUps[0]?.content ?? operator.calls.replies[0]?.content ?? null,
    };

    evidence('discord-handler-auth', report);

    const negativeOk =
      report.negative &&
      (report.negative as { approval_status_after: string }).approval_status_after === 'pending' &&
      String((report.negative as { rejection_reply: string }).rejection_reply ?? '').toLowerCase().includes('not authorized');
    const positiveOk =
      (report.positive as { approval_status_after: string }).approval_status_after === 'approved' &&
      String((report.positive as { reviewer_notes: string }).reviewer_notes ?? '').includes(operatorId) &&
      (report.positive as { task_status_after: string }).task_status_after === 'open';

    console.log(
      negativeOk && positiveOk
        ? 'PASS: non-allowlisted press rejected + logged, approval untouched; operator press approved with audit trail and task advance'
        : 'FAIL: see evidence',
    );
    process.exitCode = negativeOk && positiveOk ? 0 : 1;
  } finally {
    await db.delete(approvals).where(eq(approvals.id, approval.id));
    await db.delete(taskEvents).where(eq(taskEvents.taskId, taskId));
    await db.delete(tasks).where(eq(tasks.id, taskId));
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
