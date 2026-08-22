/**
 * Phase 2 load test: concurrent spendBudget + recordBudgetRun writes against
 * a single scratch agent must never lose a write or double-count.
 *
 * Regression coverage for src/lib/governance/budget.ts. Both spendBudget and
 * recordBudgetRun do a single atomic `UPDATE ... SET col = col + x RETURNING`
 * (no read-modify-write in application code), so firing 50 of each — 100
 * writers total — concurrently against one row should land on an exact
 * total with zero lost updates, regardless of interleaving.
 *
 * No budgetMonthlyUsd / budgetMonthlyRuns cap is set on the scratch agent:
 * this keeps the test focused purely on write atomicity, without also
 * exercising the 80%/100% threshold side-effects (those are covered by
 * tests/governance/budget-thresholds.ts).
 */
import '../governance/load-env';
import { db } from '@/lib/db';
import { agents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { spendBudget, recordBudgetRun } from '@/lib/governance/budget';

const N_SPENDS = 50;
const N_RUNS = 50;
const SPEND_EACH_USD = '0.0100';
const EXPECTED_USD_STRING = '0.5000';
const EXPECTED_USD_NUMBER = 0.5;

function evidence(label: string, data: unknown) {
  console.log(`\nEVIDENCE [${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  let scratchId: string | null = null;

  try {
    const [scratch] = await db
      .insert(agents)
      .values({
        name: `Budget Concurrency Scratch ${Date.now()}`,
        role: 'load test scratch agent',
        agentKind: 'legacy_reference',
        heartbeatEnabled: false,
        status: 'active',
      })
      .returning();
    scratchId = scratch.id;

    evidence('setup', {
      agentId: scratchId,
      spends: N_SPENDS,
      runs: N_RUNS,
      spendEachUsd: SPEND_EACH_USD,
    });

    // Fire all 100 writes concurrently and interleaved against the same row.
    const spendPromises = Array.from({ length: N_SPENDS }, () =>
      spendBudget(scratchId!, SPEND_EACH_USD, crypto.randomUUID()),
    );
    const runPromises = Array.from({ length: N_RUNS }, () =>
      recordBudgetRun(scratchId!, crypto.randomUUID()),
    );

    await Promise.all([...spendPromises, ...runPromises]);

    const after = await db.query.agents.findFirst({ where: eq(agents.id, scratchId) });
    if (!after) throw new Error('scratch agent vanished mid-test');

    const usedUsdRaw = after.budgetUsedUsd;
    const usedUsdNumber = parseFloat(usedUsdRaw);
    const usedRuns = after.budgetUsedRuns;

    // Postgres numeric arithmetic is exact decimal — with zero lost/duplicated
    // writes the column must be the literal string '0.5000' (scale 4), not
    // just "close to" 0.5.
    const usdExactString = usedUsdRaw === EXPECTED_USD_STRING;
    const usdWithinEpsilon = Math.abs(usedUsdNumber - EXPECTED_USD_NUMBER) < 1e-9;
    const runsExact = usedRuns === N_RUNS;

    evidence('results', {
      expected_used_usd: EXPECTED_USD_STRING,
      actual_used_usd_raw: usedUsdRaw,
      actual_used_usd_number: usedUsdNumber,
      expected_used_runs: N_RUNS,
      actual_used_runs: usedRuns,
      usd_exact_string_match: usdExactString,
      usd_within_epsilon: usdWithinEpsilon,
      runs_exact_match: runsExact,
    });

    const pass = usdExactString && usdWithinEpsilon && runsExact;
    console.log(
      pass
        ? `PASS: ${N_SPENDS} concurrent spendBudget + ${N_RUNS} concurrent recordBudgetRun landed exactly on $${EXPECTED_USD_STRING} / ${N_RUNS} runs, zero lost writes, zero double-counts`
        : `FAIL: usd raw="${usedUsdRaw}" (expected "${EXPECTED_USD_STRING}"), runs=${usedRuns} (expected ${N_RUNS})`,
    );
    process.exitCode = pass ? 0 : 1;
  } finally {
    if (scratchId) {
      await db.delete(agents).where(eq(agents.id, scratchId));
    }
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
