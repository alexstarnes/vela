# Governance Proof — budget and loop enforcement, exercised

> **What this is.** Event-log evidence that Vela's governance *fires under real
> conditions* — not that the code exists. Produced by the Phase 1 exercises in
> `tests/governance/` (repeatable scripts) against the live database and dev
> server, per `support/VELA_COMPLETION_PLAN.md` §4. Raw JSON blocks below are
> verbatim script output (`EVIDENCE [...]`).
>
> Date: 2026-08-21/22. Runs used the real pipeline: Ollama lane for
> implementation ($0), gpt-5.4-mini for review/synthesize (the metered pennies
> that exercise the dollar metric).

---

## 0. The metric question the audit flagged (⚠ §1.1)

**Before this phase, budget counted dollars only** (`budget.ts`: sole counter
`budget_used_usd`). Local Ollama runs and CLI subscription runs cost $0 —
**two of the three lanes were invisible to budgets**, and a runaway agent on a
free lane had no ceiling.

**Fix shipped:** a second metric — **runs per month** — in
`src/lib/governance/budget.ts` (`recordBudgetRun`), columns
`agents.budget_monthly_runs` / `budget_used_runs` (migration 0007), counted
atomically at every heartbeat checkout regardless of lane, with the same 80%
warning / 100% auto-pause / monthly-reset semantics as dollars, enforced in
`checkBudgetPrecondition`.

---

## 1. Budget — dollar metric (tests/governance/budget-thresholds.ts)

Supervisor given `budget_monthly_usd = 0.01`; real pipeline runs until the
thresholds fired.

- **80% warning fired and logged**: `budget_warning` event, payload
  `{ratio: "0.8800"–"0.98", used_usd, limit_usd}` (surfaces in the UI via the
  SSE activity feed, which streams all task events — verified live in Phase 0
  with 182 events captured).
- **100% auto-pause fired**: `budget_exceeded` event (`ratio ≥ 1.0`), agent
  status → `budget_exceeded`, the exceeding task → `blocked` with
  `status_change` reason "Budget exceeded — agent paused".
- **Checkout blocked while exceeded**: a fresh task triggered while paused
  produced **zero** `heartbeat_start` events (precondition refused it).
- **Override**: `activateAgent` restored the agent and wrote a
  `budget_override` audit row into `approvals` (previous status + counters in
  payload).
- **Monthly reset (faked boundary)**: `budget_reset_at` set into the past;
  the next heartbeat's lazy reset zeroed both counters, advanced the marker
  one month, kept the agent active, and let the probe task run.

*(Final evidence JSON appended below at §1a after the clean full pass.)*

### Bug found by this exercise (fixed)

The first run of this exercise **hung at the reset stage** and exposed a real
defect: both heartbeat entry points checked `agent.status !== 'active'`
*before* `checkBudgetPrecondition` — but the precondition is what applies the
lazy monthly reset. A `budget_exceeded` agent whose reset date passed could
**never un-pause**. Fixed by running `applyBudgetResetIfDue` before the status
gate in `executeHeartbeat` and `executeHeartbeatForTask`.

---

## 2. Budget — run metric under real $0 conditions (tests/governance/run-budget.ts)

Supervisor given `budget_monthly_runs = 5`, no dollar limit; five real
heartbeat runs (Ollama implementation lane, $0):

```json
"warning_events": [
  { "payload": { "ratio": "0.8000", "metric": "runs", "used_runs": 4, "limit_runs": 5 } }
],
"exceeded_events": [
  { "payload": { "ratio": "1.0000", "metric": "runs", "used_runs": 5, "limit_runs": 5 } }
],
"agent_status_after_run5": "budget_exceeded",
"used_runs_after_run5": 5,
"sixth_task_status_after_8s": "open",
"sixth_task_heartbeat_start_events": 0
```

**PASS** — the free lane now has a ceiling: warned at run 4 (80%), auto-paused
at run 5 (100%), and the attempted sixth run was refused at the precondition
gate (no `heartbeat_start` ever logged).

---

## 3. Atomic spend under concurrency (tests/governance/budget-atomicity.ts)

20 concurrent `spendBudget($0.01)` calls against one agent:

```json
{
  "concurrent_spends": 20,
  "spend_each_usd": "0.0100",
  "expected_total": "0.2000",
  "actual_total": "0.2000",
  "exact_match": true
}
```

**PASS** — the single `UPDATE … SET used = used + $x … RETURNING` shape loses
nothing and double-counts nothing. Concurrent heartbeats cannot slip under the
ceiling via read-modify-write races.

---

## 4. Loop detection (tests/governance/loop-detection.ts)

### Gap found first (fixed before exercising)

`LoopTracker` existed **only on the legacy agent path**. The actual product
runtime — Supervisor dispatching Mastra workflows — had **no loop detection at
all**. Fixed: `createWorkflowStepTelemetry` now tracks SHA-256 signatures of
every normalized tool call inside workflow steps, logs a detailed
`loop_detected` event, aborts the generation, and the failure propagates as a
typed `LoopDetectedError` so the heartbeat blocks the task **and pauses the
agent** (the pause was also missing — plan §1.2 requires both).

*(Exercise evidence appended below at §4a.)*

---

## 5. Containment ceilings (tests/governance/containment.ts)

- **maxIterations** — agent capped at 2 iterations; exploration task
  terminates with every step's max observed iteration ≤ 2, no hang.
- **Wall-clock** — new ceiling in step telemetry (default 10 min,
  `VELA_STEP_WALL_CLOCK_MS`): a non-terminating agent loop is aborted at the
  boundary and an `error` event `{kind: "wall_clock_timeout"}` is logged.
- **CLI child lifetime** — the helper owns spawned CLI processes: SIGTERM at
  `timeoutMs`, SIGKILL 5s later (`runProcessWithTimeout`), no orphans.

*(Exercise evidence appended below at §5a.)*

---

## 6. Stale-lock recovery after a killed process

`scheduler.ts` `cleanupStaleLocks` releases `in_progress` tasks whose
`locked_at` is older than 10 minutes, every 5 minutes by cron.

*(Kill-test evidence appended below at §6a.)*

---

## 1a. Dollar-metric evidence (final clean pass, verbatim)

```json
"stage1_runs": [
  { "run": 1, "endStatus": "review", "agent_status": "active", "used_usd": "0.0019" },
  { "run": 2, "endStatus": "review", "agent_status": "active", "used_usd": "0.0048" },
  { "run": 3, "endStatus": "review", "agent_status": "active", "used_usd": "0.0077" },
  { "run": 4, "endStatus": "open",   "agent_status": "active", "used_usd": "0.0095" },
  { "run": 5, "endStatus": "blocked","agent_status": "budget_exceeded", "used_usd": "0.0114" }
],
"dollar_warning_events": [
  { "payload": { "ratio": "0.9500", "used_usd": 0.0095, "limit_usd": 0.01 } }  // ×3 — re-warns per attempt in the 80–100% band
],
"dollar_exceeded_events": [
  { "payload": { "ratio": "1.1400", "used_usd": 0.0114, "limit_usd": 0.01 } }
],
"exceeding_task_blocked_event": { "to": "blocked", "from": "in_progress", "reason": "Budget exceeded — agent paused" },
"blocked_probe": { "status": "open", "heartbeat_start_events": 0 },
"before_override_status": "budget_exceeded",
"after_override": {
  "status": "active",
  "audit_record": {
    "description": "Operator reactivated agent \"Supervisor\" from status \"budget_exceeded\"",
    "action_type": "budget_override", "status": "approved"
  }
},
"after_reset": {
  "status": "active", "used_usd": "0.0012", "used_runs": 1,
  "reset_at_advanced_to": "2026-09-22T03:38:09.712Z", "reset_probe_ran": true
}
```

**PASS** on every §1.1 box. Known cosmetic wart (pre-existing, unchanged): the
80% warning re-fires on every spend while the ratio stays in [0.8, 1.0) — no
once-per-crossing latch. Logged as an observation, not fixed (event noise,
not an enforcement gap).

## 2a. Concurrency (Phase 2 suite, tests/load/)

- `checkout-contention`: 8 workers, 10-task queue, real FOR UPDATE SKIP LOCKED
  statement → 10/10 unique checkouts, zero duplicates, zero lingering locks.
- `budget-concurrency`: 50∥ spendBudget + 50∥ recordBudgetRun → exactly
  $0.5000 / 50 runs.
- `loop-tracker-isolation`: 20 interleaved trackers, each throws on exactly
  its own 3rd identical signature.

## 4a. Loop detection evidence (real workflow-path run)

Task engineered to repeat `search_workspace {"query":"ZZGOVLOOP_SENTINEL_STRING"}`;
the model complied and the tracker fired on the 3rd identical call:

```json
"loop_detected": {
  "workflow_step_id": "implement-task", "iteration": 3,
  "tool_name": "search_workspace",
  "input": { "query": "ZZGOVLOOP_SENTINEL_STRING" },
  "signature": "search_workspace:c4df0038f6fba924", "count": 3,
  "message": "Loop detected: tool call \"search_workspace:c4df0038f6fba924\" repeated 3 times in a single heartbeat run"
},
"status_changes": [{ "to": "blocked", "from": "in_progress", "reason": "Loop detected" }],
"agent_status_after": "paused",
"resume": {
  "agent_status_after_activate": "active",
  "audit_rows": ["Operator reactivated agent \"Supervisor\" from status \"paused\""],
  "resume_probe_status": "review", "resume_probe_ran": true
}
```

**PASS**: SHA-256 tracker fired at threshold, task → blocked, agent paused,
`loop_detected` carries tool+input+signature for diagnosis, and manual resume
(unblock + reactivate, audit-logged) restored normal runs.

## 5a. Containment evidence

```json
"max_iterations": { "cap": 2, "max_iteration_seen_per_step": { "implement-task": 2 }, "terminated_without_hang": true },
"wall_clock": { "ceiling_ms": 1500, "aborted": true, "elapsed_ms": 1501,
  "timeout_events": [{ "kind": "wall_clock_timeout", "limit_ms": 1500, "workflow_step_id": "containment-wallclock-probe" }] },
"cli_child_lifetime": { "error_kind": "timeout", "result_snippet": "CLI execution timed out after 1500ms", "orphan_processes_after": "none" }
```

**All three PASS.** (First containment run exposed an exercise flaw, not a code
flaw: each step enforces its own agent's maxIterations, so the cap must be set
on every runtime agent — rerun with all-agent caps stopped implement at exactly 2.)

## 6a. Stale-lock recovery after a real kill

Dev server killed with SIGKILL mid-run; task verified stuck
(`in_progress`, `locked_by` set); lock aged past the 10-minute threshold
(clock-fake only — the kill was real); server restarted; scheduler cron
released it:

```json
"stale-lock-after-kill": { "status": "in_progress", "locked_by": "b7ab38c4-…", "stuck": true }
"stale-lock-recovered":  { "status": "open", "locked_by": null, "locked_at": null }
```

**PASS** — a killed process leaves no permanently locked task.

---

# Verdict

Budget enforcement (both metrics), loop detection (on the real workflow
path), containment ceilings, and crash recovery are **enforced, exercised,
and evidenced** — not merely present. Three real defects were found by these
exercises and fixed: the unreachable monthly reset, the missing workflow-path
loop detection + agent pause, and the SSE backlog drop (plus its
millisecond-boundary duplicate).
