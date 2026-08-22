# Orchestration Hardening Plan — workspace hygiene, dependency ordering, flight view

**Written 2026-08-22. Workstreams A, B and C built 2026-08-22 — see §Build record at the bottom for what shipped, what was verified, and the two things the build changed about the plan.** Successor plan to `VELA_COMPLETION_PLAN.md` (done — see `BUILD_LOG.md` final report). Solves the two systemic gaps that plan filed as follow-ups, plus the project-level execution view the operator asked for. The two small refinements (approval labels, autostart toggle) were approved and built the same night this plan was written — recorded in §D as done.

**Why this order matters:** A (hygiene) is the safety gate for any unattended run — without it, one failed task corrupts the next task's review. B (ordering) makes an approved backlog *executable* instead of merely staged. C (flight view) is the operator's window into both, and consumes B's data. So: **A → B → C**, with D already landed.

---

## Workstream A — Workspace hygiene: branch-per-task lifecycle  ·  **BUILT**

### The problem, precisely

All tasks of a project share one working tree (`projects.workspacePath`). The workflow path implements directly on whatever tree state it finds. Observed failure during the acceptance run: the empty-states task's rejected work sat uncommitted; the duplicate-detection task's implementation audit and reviewer then saw those leftovers as part of *its* diff and sent it to rework for changes it never made. Work also never gets committed — the approved dark-mode change sat uncommitted until the operator committed it by hand.

### Design: make the branch the unit of work, keep the tree disposable

1. **A.1 Quarantine gate (pre-implement).** New first step on the workflow path: helper `git status --porcelain`. If the tree is dirty, commit the leftovers to a branch `vela/quarantine/<yyyymmdd>-<hhmm>` (never discard — leftover work has repeatedly been real), then hard-reset the tree to the project base branch. Log a `workspace_quarantine` task event naming the branch so the operator can recover it.
2. **A.2 Branch per task.** Before implement: `git checkout -B vela/task-<id8>` from the base branch (`projects.defaultBranch`, falling back to the current branch). Rework attempts re-enter the same branch, so failure history accumulates in one place.
3. **A.3 Commit on review-pass.** When the workflow finishes with the task at `review`: `git add -A && git commit` on the task branch (message: task title + id), then check the base branch back out. **This is the hygiene moment** — the deliverable survives on the branch, and the tree is clean for whatever runs next. The task page's review panel switches from "uncommitted tree diff" to `git diff <base>...vela/task-<id8>` so the operator reviews exactly and only this task's work.
4. **A.4 Merge on operator approve.** The `review → done` transition squash-merges the task branch into base (one base commit per task, titled by the task) and deletes the branch. On merge conflict: task goes to `waiting_for_human` with the conflict output in a task event — an honest failure, not a silent one. `Request changes` keeps the branch; `Cancel` leaves the branch for forensics.
5. **A.5 Per-project serialization.** The heartbeat checkout query skips any project that already has an `in_progress` task. Two tasks sharing one working tree cannot both run, branches or not — git's checked-out state is repo-global. (Git *worktrees* would allow true parallelism per project; that is deliberately phase 2 — more helper surface, dev-server path ambiguity, cleanup lifecycle — and nothing today needs within-project parallelism.)

### Touch points

- Helper (`scripts/vela-helper.ts`): new tightly-validated endpoints — `git-branch-save` (add+commit on named branch), `git-merge-squash`, `git-reset-hard` (used only by the quarantine gate after the save). Prefer dedicated endpoints over the generic command runner: the helper's security posture is "small verbs, validated args."
- Workflow (`src/lib/mastra/workflows/*`): new `prepare-workspace` step at the head of `featureWorkflow`; commit logic in the finalization path that sets `review`.
- Transitions (`src/lib/actions/tasks.ts`): merge-on-approve inside the `review → done` branch; conflict → `waiting_for_human`.
- Checkout (`src/lib/mastra/heartbeat.ts`): serialization predicate.

### VERIFY A (scripted, like the governance exercises)

Task 1 implements and is made to fail review (leaves work). Task 2 runs on the same project. Assert: (1) task 2's audit diff contains only task 2's changes; (2) task 1's work is intact on its branch; (3) approving task 2 produces exactly one squash commit on base; (4) a concurrent heartbeat cannot check out two tasks of one project (extend the existing concurrency test).

---

## Workstream B — Dependency ordering of the backlog  ·  **BUILT**

### The problem, precisely

Synthesizer stories carry implicit ordering ("Duplicate detection" presumes save/import code that only sibling stories create). Children are created flat and `open`; checkout picks by priority/age; a dependent story can run first against a skeleton and honestly produce nothing.

### Design: dependencies as data, enforced at checkout

1. **B.1 Synthesizer emits ordering.** `backlog[]` items gain `depends_on: number[]` — indices of sibling stories that must land first. Update `synthesisSchema` (`ring-shared.ts`) + `docs/agent-protocols/critique-protocol.md` (instruction: "order for a solo builder; name prerequisites by index; most stories should have 0–2"). Validation: indices in range, no self-reference; cycles broken by dropping the back-edge with a logged warning (never fail the ring over a hint).
2. **B.2 Schema.** New table `task_dependencies (task_id, depends_on_task_id, created_at)`, unique pair, both FK → tasks, cascade on delete. A join table (not an array column) so both directions query cleanly: "what am I waiting on" and "who is waiting on me."
3. **B.3 Creation.** The `prd_backlog` approval handler runs two passes: insert all children, then map indices → task ids and insert edges. (Handler: `src/lib/actions/approvals.ts` `prd_backlog` branch.)
4. **B.4 Enforcement at checkout, not via status.** Heartbeat eligibility adds `NOT EXISTS (dependency whose task is not done)`. Statuses stay honest (`open` = wants to run); the gate is computed from data every time, so it cannot drift the way status-flipping on completion events could (miss one unblock hook and a task strands forever). Cancelled dependencies count as unsatisfied → the dependent surfaces in the flight view as needing an operator decision (re-point or delete the edge).
5. **B.5 UI.** "waiting on: <task>" chips on task cards and the task page sidebar, computed from the join.
6. **B.6 Retro-fit Clipper.** One-shot script: a single CLI-opus call over the 18 open children proposing edges; write them; the operator reviews the resulting graph in the flight view (C) before enabling any cron, deleting any edge that looks wrong (C ships an edge-delete control).

### VERIFY B

Synthetic backlog (3 stories, chain A→B→C): checkout with all open picks only A; marking A done makes B eligible; C never runs early. Ring-side: re-run the weak-PRD fixture through the synthesizer prompt update and assert `depends_on` parses and survives task creation.

---

## Workstream C — Project flight view  ·  **BUILT**

**What the operator sees today:** a flat task list with status pills. **What they asked for:** at the project level — what is in flight, in what order, and what depends on what.

1. **C.1 "In flight" strip** at the top of the project page: `in_progress`, `review`, `waiting_for_human` tasks as prominent cards (these are the ones needing eyes), each linking to its task page.
2. **C.2 Execution plan section:** the project's open/blocked children laid out in **topological layers** (layer 0 = no unmet dependencies = eligible now; layer N = waits on layer < N). CSS grid of status-colored cards with "after: <task>" chips; no graph library — layered columns communicate order without edge-routing complexity. Each card: title, status, assignee, waiting-on chips, edge-delete control (operator-only pruning from B.6).
3. **C.3 Workspace card** (ties A into visibility): current branch + clean/dirty from the helper, and the quarantine branches if any exist — so "is the tree healthy" is answerable at a glance.
4. Ordering within a layer follows task priority then age — same keys the checkout uses, so the view predicts execution order truthfully.

### VERIFY C

Clipper renders: 18 children in layers consistent with B.6's edges; the in-flight strip matches reality; deleting an edge re-layers the view and changes checkout eligibility (assert via one heartbeat dry-run).

---

## §D — Approved refinements (BUILT 2026-08-22, same night as this plan)

1. **D.1 Distinct approval labels.** The two sign-offs no longer look alike: the Discord card and the approval review page now say **"Approve backlog — creates N tasks"** for `prd_backlog` approvals, and the task-header control on a PRD-carrier task at `review` reads **"Accept & close"** instead of "Approve" (the review panel already explains it closes out the ring task).
2. **D.2 Autostart toggle.** `projects.autostart_on_backlog_approval` (default **off**), surfaced in Edit Project. When on, approving a backlog kicks a heartbeat for the first created child immediately instead of waiting for a cron. Once B lands, "first" becomes "first dependency-free." The default stays off — the no-self-execution invariant holds unless the operator opts a project in.

---

## Sequencing & effort

| Phase | Contents | Size | Risk |
|---|---|---|---|
| D | Labels + autostart | done | — |
| A | Quarantine, branch lifecycle, merge-on-approve, serialization | largest (helper + workflow + transitions) | git edge cases — mitigated by VERIFY A script |
| B | Dep schema, synthesizer, checkout gate, retro-fit | medium | synthesizer compliance — mitigated by fixture re-run |
| C | Flight view | medium (UI-heavy) | low |

Open decisions, all taken as recommended: squash-merge on approve (one story-shaped commit per task); per-project serialization over worktrees; retro-fit edges via one opus call then operator prune.

---

## Build record — 2026-08-22

### What shipped

**A — workspace hygiene.** Helper gained five validated git verbs (`git-branch-ensure`, `git-branch-save`, `git-merge-squash`, `git-reset-hard`, `git-branch-list`) plus a `baseRef`/`headRef` range on `git-diff`; refs are validated against a strict pattern, no generic command runner. `src/lib/workspace/branch-lifecycle.ts` holds the lifecycle (quarantine → branch → commit → merge) and an overview query for the flight view. A `prepare-workspace` step heads **all three** code workflows (feature, high-risk, debug — the plan named only `featureWorkflow`, but the same tree corruption applies to each), and the legacy agent path now calls the same gate instead of its own ad-hoc `checkout -b`. `finalizeTaskStep` commits on review-pass and returns the tree to base; `transitionTask` squash-merges on `review → done`, redirecting to `waiting_for_human` on conflict. The review panel now shows `git diff <base>...vela/task-<id8>` instead of the working tree.

**B — dependency ordering.** `task_dependencies` join table (migration `0010`, applied). `synthesisSchema.backlog[].depends_on` plus prompt and `critique-protocol.md` instructions. The `prd_backlog` approval handler runs the two passes and logs a `dependency_graph` event with any dropped hints. Checkout eligibility gains the dependency predicate; autostart now picks the first *dependency-free* child. Waiting-on chips on the task page; `scripts/propose-task-dependencies.ts` retro-fits an existing backlog with one CLI-opus call (`--dry-run` supported).

**C — flight view.** In-flight strip, topologically layered execution plan with per-chip edge-delete, and a workspace health card (branch, clean/dirty, quarantine branches) on the project page.

### Two things the build changed about the plan

1. **`NOT EXISTS` alone does not serialize (A.5).** The plan's per-project predicate is not sufficient on its own: under READ COMMITTED every concurrent checkout reads the same pre-update snapshot, so all of them pass it. The extended contention test caught this immediately — 8 workers checked out all 4 tasks of one project. The gate now also takes a row lock on the *project* (`FOR UPDATE OF t, p SKIP LOCKED`), so the first checkout of a project holds that row for the statement and rivals skip the project rather than queue behind it. The same predicate and lock were added to the direct-dispatch path (manual run, autostart), which had the identical race. Re-run: exactly 1 of 4 admitted.

2. **Quarantined work is preserved, not replayed.** A.1 says leftovers are never discarded, and they are not — but they land on the quarantine branch, *not* back on the originating task's branch. When that task is reworked it re-enters `vela/task-<id8>`, which does not carry the quarantined edits. This is the honest behaviour (silently replaying someone else's uncommitted work into a new run is worse), but it means the recovery step is an operator `git checkout vela/quarantine/<stamp>`, and the `workspace_quarantine` event says so explicitly.

### Verification

| Check | Result |
|---|---|
| `tests/workspace/branch-lifecycle.ts` (VERIFY A 1–3, real git repo + real helper) | **PASS** — task 2's review diff contained only `duplicates.ts`; task 1's `empty-states.ts` intact on `vela/quarantine/20260822-0053`; base went 1 → 2 commits (exactly one squash commit, titled by the task); branch deleted; tree clean |
| `tests/load/checkout-contention.ts` (VERIFY A 4, extended) | **PASS** — 8 workers, 10/10 tasks across 10 projects, zero duplicates, zero lingering locks; per-project serialization admitted exactly 1 of 4 tasks sharing a project |
| `tests/governance/dependency-ordering.ts` (VERIFY B) | **PASS** — A → B → C admitted strictly in order, C never early, nothing checked out while A ran, and a synthesizer `depends_on` survived schema → normalize → `task_dependencies` rows |
| `src/lib/tasks/dependencies.test.ts` (18 unit tests, wired into `npm run test:unit`) | **PASS** — 45/45 overall |
| `npx tsc --noEmit`, `npm run build` | clean |

Not re-run: the governance exercises that need a live dev server and real model calls (`containment`, `loop-detection`, `budget-thresholds`, `run-budget`, `stale-lock`, `sse-under-load`) and the ring fixtures. The pure-DB ones (`budget-atomicity`, `budget-concurrency`, `loop-tracker-isolation`) were re-run and pass.

### Operator follow-ups

- **VERIFY C is not done.** It needs Clipper's real 18 children: run `npx tsx scripts/propose-task-dependencies.ts --parent <prd-task-id> --dry-run`, read the proposal, run it for real, then check the flight view lays the stories out in sensible layers and that deleting an edge re-layers it. Do this **before** enabling any cron — that is what B.6 was for.
- The two children parked at `waiting_for_human` from the completion run are still parked; the duplicate-detection one is exactly the case B exists to prevent recurring.
