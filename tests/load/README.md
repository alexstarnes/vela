# Phase 2 load / concurrency tests

`checkout-contention.ts` fires 8 concurrent workers against the real atomic
task-checkout SQL (kept in sync with `checkoutNextTask` in
`src/lib/mastra/heartbeat.ts:37-66`) draining 10 scratch tasks, and asserts
every task is checked out exactly once with zero lingering locks after
cleanup; `budget-concurrency.ts` fires 50 concurrent `spendBudget` calls
interleaved with 50 concurrent `recordBudgetRun` calls against one scratch
agent and asserts the final `budget_used_usd`/`budget_used_runs` land on
exactly `0.5000`/`50` with no lost or double-counted writes;
`loop-tracker-isolation.ts` is a pure in-process test that interleaves
identical-signature calls across 20 concurrent `LoopTracker` instances and
asserts each one throws only on its own 3rd call, proving no state bleeds
between instances; `sse-under-load.ts` opens 5 concurrent SSE connections to
`/api/events/stream`, bursts 100 `task_events` rows onto a scratch task, and
asserts every connection receives all 100 `seq` values with no duplicates or
gaps within 30s (accounting for the route's 2s poll cadence) — this one
requires a dev server already running at `APP_URL` (`npm run dev`,
default `http://localhost:3000`) plus `VELA_PASSWORD` in the environment;
the other three only need the database. Run any of them from the repo root
with `npx tsx tests/load/<script>.ts`; each prints `EVIDENCE [...]` JSON
blocks, a final `PASS`/`FAIL` line, and exits `0`/`1` accordingly, and each
cleans up its own scratch rows in a `finally` block regardless of outcome.
This directory is the regression suite for any change to the checkout query
or budget/run-count enforcement in `src/lib/mastra/heartbeat.ts`, the atomic
update logic in `src/lib/governance/budget.ts`, the per-instance state in
`src/lib/governance/loop-detector.ts`, or the polling/delivery logic in
`src/app/api/events/stream/route.ts` — re-run the relevant script(s) after
touching any of those files.
