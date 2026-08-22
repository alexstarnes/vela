/**
 * Exercise: concurrent spendBudget calls must not lose writes or double-count.
 * 20 parallel spends of $0.01 against a scratch agent must land exactly at $0.20.
 */
import './load-env';
import { db, agents, eq, evidence } from './util';
import { spendBudget } from '@/lib/governance/budget';

async function main() {
  const [scratch] = await db
    .insert(agents)
    .values({
      name: `Atomicity Scratch ${Date.now()}`,
      role: 'governance test scratch agent',
      agentKind: 'legacy_reference',
      heartbeatEnabled: false,
      status: 'active',
      budgetMonthlyUsd: '100.00',
    })
    .returning();

  try {
    const N = 20;
    const SPEND = '0.0100';
    await Promise.all(
      Array.from({ length: N }, () => spendBudget(scratch.id, SPEND, crypto.randomUUID())),
    );

    const after = await db.query.agents.findFirst({ where: eq(agents.id, scratch.id) });
    const used = parseFloat(after!.budgetUsedUsd);
    const expected = N * 0.01;

    evidence('budget-atomicity', {
      concurrent_spends: N,
      spend_each_usd: SPEND,
      expected_total: expected.toFixed(4),
      actual_total: used.toFixed(4),
      exact_match: Math.abs(used - expected) < 1e-9,
    });

    if (Math.abs(used - expected) > 1e-9) {
      console.error('FAIL: lost or duplicated budget writes under concurrency');
      process.exitCode = 1;
    } else {
      console.log('PASS: 20 concurrent spends, zero lost writes, zero double-counts');
    }
  } finally {
    await db.delete(agents).where(eq(agents.id, scratch.id));
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
