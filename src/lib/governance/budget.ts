/**
 * Budget Enforcement — atomic budget updates with threshold detection.
 *
 * All DB writes use a single UPDATE ... RETURNING so two concurrent heartbeats
 * cannot double-spend: the DB row is always updated to the correct cumulative
 * total without a read-modify-write race.
 */

import { db } from '@/lib/db';
import { agents } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';

export type BudgetResult =
  | { status: 'ok'; newUsed: number; budgetLimit: number }
  | { status: 'warning'; newUsed: number; budgetLimit: number }
  | { status: 'exceeded'; newUsed: number; budgetLimit: number };

/**
 * Atomically increment an agent's budget_used_usd by `spendUsd` and return
 * the updated values.  Never reads before writing — the UPDATE itself
 * computes the new total, preventing concurrent double-spend.
 *
 * Returns a BudgetResult that callers can use to decide whether to continue
 * or pause the agent.
 *
 * @param agentId  The agent whose budget is updated
 * @param spendUsd  Dollar amount to add (as a string for numeric precision)
 * @param taskId    Used to log budget_warning / budget_exceeded events
 */
export async function spendBudget(
  agentId: string,
  spendUsd: string,
  taskId: string,
): Promise<BudgetResult> {
  // Single atomic UPDATE — computes new total in one query.
  // Using sql`` for precision arithmetic on the numeric column.
  const rows = await db
    .update(agents)
    .set({
      budgetUsedUsd: sql`${agents.budgetUsedUsd} + ${spendUsd}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId))
    .returning({
      budgetUsedUsd: agents.budgetUsedUsd,
      budgetMonthlyUsd: agents.budgetMonthlyUsd,
    });

  if (!rows || rows.length === 0) {
    // Agent not found — treat as ok so we don't crash the heartbeat
    return { status: 'ok', newUsed: 0, budgetLimit: 0 };
  }

  const row = rows[0];
  const newUsed = parseFloat(row.budgetUsedUsd ?? '0');
  const budgetLimit = parseFloat(row.budgetMonthlyUsd ?? '0');

  // No budget configured — nothing to enforce
  if (budgetLimit <= 0) {
    return { status: 'ok', newUsed, budgetLimit };
  }

  const ratio = newUsed / budgetLimit;

  if (ratio >= 1.0) {
    // Exceeded — pause agent and log event
    await db
      .update(agents)
      .set({ status: 'budget_exceeded', updatedAt: new Date() })
      .where(eq(agents.id, agentId));

    await logTaskEvent({
      taskId,
      agentId,
      eventType: 'budget_exceeded',
      payload: {
        used_usd: newUsed,
        limit_usd: budgetLimit,
        ratio: ratio.toFixed(4),
      },
    });

    return { status: 'exceeded', newUsed, budgetLimit };
  }

  if (ratio >= 0.8) {
    // Warning threshold — log event but continue
    await logTaskEvent({
      taskId,
      agentId,
      eventType: 'budget_warning',
      payload: {
        used_usd: newUsed,
        limit_usd: budgetLimit,
        ratio: ratio.toFixed(4),
      },
    });

    return { status: 'warning', newUsed, budgetLimit };
  }

  return { status: 'ok', newUsed, budgetLimit };
}

/**
 * Check current budget state without spending.
 * Used at heartbeat start to determine whether to proceed.
 */
export async function checkBudgetPrecondition(agentId: string): Promise<{
  canProceed: boolean;
  reason?: string;
}> {
  const rows = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!rows) return { canProceed: false, reason: 'Agent not found' };

  const used = parseFloat(rows.budgetUsedUsd ?? '0');
  const limit = parseFloat(rows.budgetMonthlyUsd ?? '0');

  if (limit > 0 && used >= limit) {
    return {
      canProceed: false,
      reason: `Budget exceeded: $${used.toFixed(4)} >= $${limit.toFixed(2)}`,
    };
  }

  return { canProceed: true };
}
