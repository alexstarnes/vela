# Vela — Completion Plan

> **What this is.** The plan to take Vela from *feature-complete but unexercised* to *running the
> loop*: you draft a PRD, a review ring critiques it, you approve a backlog, the existing build
> pipeline executes it, and a standing strategist comes back with ideas.
>
> **Who executes it.** Claude Code, in the Vela repo.
>
> **How to use it.** Phases in order. Every phase ends in a `VERIFY` block — do not advance until
> it passes. `⚠` marks something the 2026-08-21 status audit flagged as unverified; check reality,
> don't trust the doc.
>
> **Supersedes.** `PAPERCLIP_HERMES_IMPLEMENTATION_PLAN.md`, which targeted a fork of another
> project. That plan rested on the premise that Vela was a specification and Paperclip was shipped
> software. The premise was wrong — see §1. The plan's *test discipline* survives; its *target*
> does not.
>
> **Reads before starting.** `support/STATUS_20260821.md` (current state), `AGENTS.md` (load the
> `mastra` skill before touching `src/lib/mastra`), `docs/architecture.md`.

---

## §1 — Why the plan changed

An August 2026 evaluation compared Vela against Paperclip (an MIT agent control plane) and Hermes
Agent (an open-source agent runtime), and recommended forking Paperclip. That recommendation was
withdrawn when the repo's actual state came to light. The record, so nobody relitigates it:

**The Paperclip case rested on one claim: Vela is a plan, Paperclip is shipped.** False. All five
Vela phases are functionally complete, `tsc --noEmit` is clean, 27/27 unit tests pass, and
`scripts/vela-helper.ts` is a working 1,038-line bridge.

**Three findings that settle it:**

1. **Vela's model routing is better than Paperclip's, on the requirement that mattered most.**
   Vela: Ollama → CLI subscription lane → cloud API, failing over automatically (`router.ts`,
   `cli-lane.ts`). Paperclip: `MODEL_PROFILE_KEYS = ["cheap"]` — one opt-in lane, no cost routing,
   no model fallback, local models only via two *undocumented* env vars. Adopting Paperclip would
   have been a downgrade on cost control.

2. **`vela-helper` already solves the CLI-auth topology problem.** Subscription-authenticated CLIs
   must run where the login lives. Vela's two-process split — web app anywhere, helper next to the
   repos — is the correct answer and was already built. The Paperclip plan's workaround was to move
   the whole control plane onto the operator's machine.

3. **The trust motivation is satisfied by Vela and permanently taxed by Paperclip.** A fork would
   mean a rebase treadmill against ~19 commits/day from a bus-factor-1 project, plus a standing
   patch set for: telemetry on by default, the host environment leaking into every agent process,
   `--dangerously-skip-permissions: true` as a default, and `npm install` + in-process load as the
   plugin path. Vela has none of that exposure, and its budget governance is yours to change —
   Paperclip's `BUDGET_METRICS = ["billed_cents"]` is a hard wall that ignores free local models.

**What Paperclip is still good for: ideas.** Three of its designs are worth stealing and appear as
optional items below — issue *documents* with revision history, execution-policy review stages, and
skill trust levels with commit-SHA pinning.

**What Hermes is still good for: memory.** Deferred to Phase 7, scoped to the seats where it earns
its keep. Not the build lane, not the messaging surface. See §9.

---

## §2 — The loop this plan completes

```
YOU draft a PRD
   ↓
CRITIQUE RING — three reviewers, independent, no shared context        ← NEW (Phase 3)
   ↓
SYNTHESIZER reconciles → revised PRD + proposed backlog                ← NEW (Phase 3)
   ↓
APPROVAL GATE — you approve from Discord                               ← exists / NEW surface (Phase 5)
   ↓
approved stories become child tasks
   ↓
EXISTING PIPELINE: classify → repo-map → plan → implement → verify → review   ← ALREADY BUILT
   ↓
human approval → done
   ↓
STRATEGIST standing routine files new ideas back at the PRD stage      ← NEW (Phase 6)
```

**You already built the bottom half.** Phases 3–6 build the top half and close the circle.

---

## §3 — Phase 0: Prove what's built

**Goal.** Move from "the code exists" to "I have watched it work." The status audit is explicit that
governance code is present but never *exercised*; that distinction is the whole point of this phase.

### 0.1 Close the environment gaps

Both throw at runtime if absent. Without them the helper bridge and GitHub OAuth are dead, which
kills file ops, git, the CLI lane, and dev-server control.

```bash
# .env
VELA_HELPER_SECRET=$(openssl rand -hex 32)
GITHUB_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
APP_URL=http://localhost:3000
```

⚠ Rotating `GITHUB_TOKEN_ENCRYPTION_KEY` invalidates any tokens already encrypted with a previous
key. If GitHub connections exist, plan to re-authorize.

### 0.2 Verify the database is real

⚠ The audit made no DB connection. Schema and 7 migrations are in sync **in the repo**; whether
they are applied to the live Supabase instance is unknown.

```bash
npm run db:migrate     # uses DIRECT_URL
npm run db:seed
```

Confirm all 10 tables exist and that `seed.ts` produced 5 runtime agents, the legacy reference
agents (`heartbeatEnabled: false`), and 11 model configs.

### 0.3 Verify the model lanes actually reach something

⚠ The audit notes `ANTHROPIC_API_KEY` and the Ollama tunnel look populated but were never
network-tested. Make one real call per lane and record the result.

| Lane | Test | Expect |
|---|---|---|
| Ollama | `curl $OLLAMA_URL/v1/models` then a real completion | 200, model list, non-empty completion |
| CLI subscription | helper → `claude -p "reply OK"` and `codex exec` | `OK`, and **no metered charge** |
| Cloud API | one Anthropic call | 200 |

⚠ **On the CLI lane, confirm no `ANTHROPIC_API_KEY` is visible to the spawned `claude` process.**
A configured API key wins over subscription auth, silently converting free subscription runs into
metered spend with no error — only a bill. This is the most expensive misconfiguration available in
the system. Check what the helper passes into the child environment.

### 0.4 The end-to-end pass

Create a project against a **local folder** (not GitHub — that path is separately unverified, §0.6).
Create one small, real task. Trigger a heartbeat manually (`POST /api/heartbeat` or Scheduler →
"Run Now"; note all 5 agents seed with `heartbeatCron: null` by design, so nothing self-executes).

Watch it go classify → repo-map → plan → implement → verify → review. Confirm:
- A real file change lands in the workspace.
- The approval gate holds — nothing completes without you.
- The activity feed streams events live.
- `task_events` carries the full tool-call trace with token and cost attribution.

### 0.5 Fix the stale comment

`src/lib/events/logger.ts:52` still says "Stub SSE emitter — Phase 4 will wire up real-time push."
The endpoint is fully implemented with `last-event-id` reconnect; delivery is 2-second DB polling.
Update the comment to say what it does. Do not re-architect — polling is fine until latency is an
actual complaint.

### 0.6 GitHub clone path

⚠ OAuth and API layers look solid; clone-through-helper has no confirmed end-to-end test. The CLI
lane and dev-server control share that bridge, so flakiness here propagates.

Clone one real repo end to end. If it fails, fix it now — Phase 4 onward assumes the helper is
trustworthy.

**VERIFY 0:**
- [ ] `tsc --noEmit` clean, 27/27 tests pass, `git status` clean.
- [ ] All 10 tables present on the live DB; seed ran.
- [ ] Each of the three lanes made one real, logged call.
- [ ] CLI lane confirmed **subscription-billed, not metered** — no API key in the child env.
- [ ] One task completed the full pipeline with a real file change and a held approval gate.
- [ ] One GitHub repo cloned through the helper.

---

## §4 — Phase 1: Exercise governance

**Goal.** Prove budget and loop governance are *enforced*, not merely *present*. The audit flags
this as unverified, and it is the control that lets you leave the system running unattended.

### 1.1 Budget enforcement

Set a deliberately tiny monthly budget on one agent. Run it until it crosses 80%, then 100%.

- [ ] 80% logs `budget_warning` and surfaces in the UI.
- [ ] 100% **auto-pauses the agent** and blocks new task checkout.
- [ ] The atomic spend path is a real transaction — concurrent heartbeats cannot both slip under the ceiling.
- [ ] Monthly reset works (fake the `budget_reset_at` boundary rather than waiting).
- [ ] Override restores the agent and logs the override.

⚠ **Ask the question Paperclip fails:** does your budget math count anything other than dollars?
Local Ollama runs cost $0, and CLI subscription runs cost $0 marginal. If `billed_cents` is the only
metric, **two of your three lanes are invisible to budgets** and a runaway local agent has no
ceiling at all. If that's the case, add a second metric — turns, wall-clock, or run count per
window. This is your code; you are not stuck with the limitation.

### 1.2 Loop detection

Construct a task that makes an agent repeat the same tool call with the same input.

- [ ] The SHA-256 signature tracker fires at the threshold.
- [ ] The task moves to `blocked` and the agent pauses.
- [ ] `loop_detected` is logged with enough detail to diagnose.
- [ ] Manual resume works after intervention.

### 1.3 Containment ceilings

- [ ] A non-terminating agent run is killed at a wall-clock boundary. **If no such timeout exists, add one** — the helper spawns child processes and must own their lifetime.
- [ ] `maxIterations` fires and does not hang.
- [ ] Stale-lock cleanup in `scheduler.ts` recovers a task whose heartbeat died mid-run (kill the process to test, don't simulate).

**VERIFY 1:** every box above, each with the event log line that proves it, recorded in
`support/GOVERNANCE_PROOF.md`. That file is the answer to "is governance enforced or just present."

---

## §5 — Phase 2: Load and concurrency

**Goal.** Close the audit's #2 gap before relying on the loop unattended.

`heartbeat.ts` uses `FOR UPDATE SKIP LOCKED` for atomic checkout. Never tested under concurrent
load.

- [ ] N concurrent heartbeats against a shared task queue. **No task is checked out twice.**
- [ ] Budget deduction under concurrency does not lose writes or double-count.
- [ ] Loop-detector state is per-run and does not bleed between concurrent runs.
- [ ] The SSE feed survives many simultaneous events without dropping or duplicating.
- [ ] A killed process leaves no permanently locked task.

Write these as repeatable scripts in `tests/load/`. They are the regression suite for every future
change to the heartbeat.

---

## §6 — Phase 3: The critique ring

**This is the new capability. Everything before it was proving what exists.**

### 3.1 The PRD object

Vela has tasks with descriptions and an append-only `task_events` log. A PRD needs to be **editable
with revision history** — the synthesizer rewrites it, and you need to see what changed.

**Recommended:** add a `documents` table.

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `task_id` | FK → tasks |
| `key` | text — reserved key `prd`; others allowed |
| `content_md` | text |
| `revision` | integer, monotonic per (task_id, key) |
| `created_by_agent_id` | FK → agents, nullable when human-authored |
| `created_at` | timestamptz |

Append a row per revision; never update in place. Latest revision is `MAX(revision)`. This is the
one design worth taking wholesale from Paperclip — keyed, revisioned, agent- and human-editable,
returned inline with the task so agents get it in context without a separate fetch.

*Alternative if you want to avoid a migration:* store the PRD as a `document` event type in
`task_events` and reconstruct by fold. Cheaper now, worse to query. Recommended only if migration
`0007` is genuinely unwelcome.

### 3.2 Route PRDs to the ring

`src/lib/orchestration/` classifies task mode on 4 axes and selects a workflow. Add a **`product`**
mode: a task carrying a `prd` document and no repo target is product work, not code work, and
selects the `critique-ring` workflow instead of the build pipeline.

Keep this in the deterministic policy layer — no AI call to decide what kind of task something is.

### 3.3 The ring workflow

New Mastra workflow, `src/lib/mastra/workflows/critique-ring.ts`. Steps:

1. **Fan out** to three reviewers. **Independently.**
2. **Collect** structured findings.
3. **Synthesize** — reconcile into a revised PRD document (new revision) plus a proposed backlog.
4. **Gate** — create an approval; nothing becomes a task until you approve.

### 3.4 Independence is the load-bearing requirement

Reviewers must not read each other's findings before writing their own. Shared context produces
consensus drift — the second reviewer agrees with the first because it read it, and three critiques
collapse into one critique with two echoes.

Vela builds agents per-heartbeat via `agent-factory.ts`, and context is assembled explicitly — which
means independence is achievable and must be *asserted*, not assumed.

- Each reviewer's context contains: the PRD, project goal ancestry, its own role skill, the
  `critique-protocol` skill. **Not** peer findings.
- Write a test that inspects the actual assembled context payload and fails if a peer's findings
  appear. Do not verify this by reading code.
- If independence cannot be guaranteed for a given execution path, run the Differentiation
  Strategist **first**, so at minimum the commercial reading is uncontaminated.

### 3.5 The output contract

`skills/critique-protocol/SKILL.md` defines the finding schema, severity rubric, independence rule,
and the synthesizer's reconciliation contract. Load it into all four ring agents.

Validate findings against the schema programmatically before the synthesizer runs. A reviewer that
emits prose instead of findings fails the step — do not let the synthesizer paper over it.

### 3.6 The synthesizer's accounting rule

Every finding gets `accepted`, `rejected`, or `deferred`, with a reason. A synthesizer that silently
drops a finding has failed its contract; a dropped `critical` finding is a defect in the system, not
a judgment call. Assert 100% coverage in the workflow, not just in the prompt.

Contradictions between reviewers escalate to you rather than being averaged away — that
disagreement is exactly the decision a human board exists to make.

### 3.7 Handoff to the pipeline you already built

Approved backlog items become **child tasks** of the PRD task, entering the existing classify →
implement → verify → review pipeline. Goal ancestry threads through, so a build agent three steps
down still knows which PRD it serves.

**VERIFY 3:** covered by the Phase 8 acceptance test.

---

## §7 — Phase 4: The role library

### 4.1 Port the roles

**See §15 for the file layout — read it before starting this phase.** Roles are *Vela runtime
skills*, not Claude Code skills; canonical home is `docs/agent-roles/`, seeded into the `skills`
table by `seed.ts`, following the existing `docs/agent-playbooks/` precedent.

Seventeen role definitions. Sixteen **moved** (not copied) from
`.agents/skills/agent-orchestration/references/`; the seventeenth —
`differentiation-monetization-strategist.md` — was written for this system because nothing
off-the-shelf covered it.

Two need their mandate flipped, because the ring reviews rather than authors:
- `product-strategist` → **PRD Auditor**. Today it writes requirements; in the ring it attacks them.
- `ux-designer` → **Flow Hardener**. Owns journeys and missing states, not pixels.

Keep the originals — the authoring mandates are still right for execution-phase work.

### 4.2 The four ring agents

| Agent | Role skill | Lane | Why |
|---|---|---|---|
| PRD Auditor | product-strategist (flipped) | CLI subscription | Judgment seat. Best model, $0 marginal. |
| Flow Hardener | ux-designer (flipped) | CLI subscription | Same. |
| Differentiation Strategist | differentiation-monetization-strategist | CLI subscription | Same. |
| Synthesizer | orchestrator | CLI subscription | The judgment seat. Reconciles, escalates. |

⚠ **Invoke the ring agents without a repo target.** The CLI lane hands them a full coding harness
with file access, and a reviewer given a repo will read the repo instead of critiquing the document —
producing plausible findings about the wrong artifact. Constrain the toolset or omit the repo. See
§14.5.

**Route by judgment density, not task type.** High volume → Ollama. High judgment → CLI
subscription lane. Cloud API is the lane of last resort, exactly as `router.ts` already has it.

⚠ Subscription quota is shared with your own interactive use — agents that burn it block your work.
That makes the CLI lane *scarce*, not unlimited. Keep it to the four low-volume judgment seats; do
not put a high-frequency routine on it.

**VERIFY 4:**
- [ ] 17 skills in the table; the two flipped mandates read as audit, not authorship.
- [ ] 4 ring agents created with correct lane access via `agent_model_access`.
- [ ] A ring agent's assembled context contains its role skill and `critique-protocol`.
- [ ] Ring runs report **zero marginal cost** — subscription lane, not metered API.

---

## §8 — Phase 5: The Discord surface

**Goal.** You approve from your phone. This is what moves you into the orchestrating lane instead of
sitting at the Kanban board.

**Build it directly against Vela's API.** Not through a third-party plugin, not through Hermes'
gateway — both put something you don't control between you and your own approval endpoint.

### 5.1 Scope

A small bot, its own process (or an extension of the helper), talking to Vela over HTTP:

| Direction | Behavior |
|---|---|
| Vela → Discord | Approval requests to `#approvals` with **Approve / Reject buttons**. Task completions and errors to `#activity` and `#errors`. |
| Discord → Vela | Button press → `POST /api/approvals/:id` with the acting user. Replies to a bot message → task comment. |
| Commands | `/vela status`, `/vela tasks`, `/vela budget`, `/vela agents` |

Feed it from the existing SSE stream (`/api/events/stream`) — it already has `last-event-id`
reconnect, so the bot survives restarts without missing events.

### 5.2 Authorization is the whole security surface

These buttons are the only thing between an agent's proposal and real work.

- Map Discord user ID → Vela operator explicitly. An allowlist, not a role check.
- **Negative test is mandatory:** a non-allowlisted Discord user pressing Approve must be rejected
  and logged.
- The approval record stores who acted.
- Bot token in the encrypted secrets path, never `.env` in plaintext.

**VERIFY 5:**
- [ ] Approval request appears in `#approvals` with working buttons.
- [ ] Approving advances the task; the audit log names the right operator.
- [ ] **A non-allowlisted user cannot approve.**
- [ ] Bot reconnects after a restart without missing events.

---

## §9 — Phase 6: The strategist routine

**Goal.** The "comes back to me with more ideas" half of the loop, made structural rather than
hopeful.

A scheduled cadence for the Differentiation Strategist, independent of any PRD:

```
heartbeatCron: "0 9 * * 1"     # Mondays 09:00
```

Its standing mandate (from the role definition): scan for competitor moves that erode a moat,
pricing shifts, emerging monetization patterns in adjacent products, and unexploited assets you
already own. File findings as tasks addressed to the PRD Auditor.

⚠ **The known weakness, stated plainly:** Vela agents are stateless per heartbeat. A weekly
strategist with no memory re-reads the world every Monday and re-files the same three ideas. It will
feel useful for a month and then become noise.

Two fixes, in order of cost:
1. **Cheap:** give the routine a rolling context of its own prior findings — query `task_events` for
   its last N filings and inject them, with an explicit instruction not to re-file. Good enough to
   start.
2. **Right:** Phase 7.

**VERIFY 6:**
- [ ] The routine fires on schedule and creates a task.
- [ ] Run it three weeks in a row (fake the clock). **The third week's findings are not a restatement of the first week's.** If they are, fix #1 above before moving on.

---

## §10 — Phase 7: The Hermes lane (deferred, optional)

**Do not start this until Phases 0–6 pass.** It is an enhancement, not a dependency.

### 7.1 What it is

A fourth provider in `model_configs`, executed through the helper exactly like the existing CLI
lane:

```
hermes -z "<prompt>" -p <profile> --usage-file <path> --max-turns N --source tool
```

`-z` is documented as: single prompt in, final response text out, nothing else on stdout.
`--usage-file` writes JSON with `estimated_cost_usd`, token counts, `model`, `provider`, and
`session_id` — even on failure. That maps cleanly onto what `budget.ts` already consumes.

Work: a `hermes` provider row, a branch in `router.ts`/`cli-lane.ts`, and usage-file parsing. The
helper already spawns headless CLIs; this is the same shape.

⚠ Verify empirically before building on them: the real exit-code semantics of `hermes -z`, and
whether a global run-timeout flag exists (documentation suggests not — wrap in `timeout`).

### 7.2 Why bother — one reason, and it's the right one

**Persistent memory.** Hermes carries SQLite session memory with full-text search and summarization
across runs. That directly fixes the §9 weakness: a strategist that remembers what it recommended in
March, and whether it worked, is a different thing from one that reads the world fresh every Monday.

Secondary: self-improving skills (it authors and refines its own procedural memory), sandboxed
terminal backends via `terminal.backend: docker` (an upgrade over the helper running shell on the
host), and a browser/vision/search toolbelt the research seats don't have.

### 7.3 Where it does *not* go

- **Not the build lane.** Claude Code CLI is better at code and already wired.
- **Not the messaging surface.** Phase 5's bot talks to your API directly; inserting a gateway you
  don't control between you and your approvals is a downgrade.
- **Not a replacement for any existing lane.** Additive only.

Scope it to the strategist and research seats. If it doesn't earn its place there, delete the branch.

---

## §11 — Phase 8: The acceptance test

**This is the definition of done for the whole plan.**

Feed the ring a **deliberately weak PRD** — vague success criteria, an obviously commodity feature,
a missing error state — and assert:

- [ ] **PRD Auditor** flags the untestable success criteria specifically, not generically.
- [ ] **Flow Hardener** flags the missing error state.
- [ ] **Differentiation Strategist** classifies the commodity feature as `commodity` and returns a `critical` or `major` finding with a `commercial_summary`.
- [ ] All findings are schema-valid, verified programmatically.
- [ ] **At least two reviewers visibly disagree on at least one point.** Unanimity on a bad PRD means independence is broken or the reviewers are being agreeable — both are failures.
- [ ] Context inspection proves no reviewer saw a peer's findings.
- [ ] Synthesizer's reconciliation accounts for **100%** of findings, each with a disposition and reason.
- [ ] The revised PRD is a new document revision; the original is intact.
- [ ] **No task is created until you approve.**
- [ ] Approval arrives in Discord and works from your phone.
- [ ] On approval, backlog items become child tasks that enter the existing build pipeline with goal ancestry intact.
- [ ] One of those child tasks runs to `review` and produces a real file change.
- [ ] The whole cycle cost approximately **$0** — Ollama and subscription lanes only.

**If the ring produces three agreeable critiques of a bad PRD, the system does not work, regardless
of what else passes.** That is the failure mode to watch for, and it will look like success.

---

## §12 — What "done" means

1. Phase 0 proven: every lane makes real calls, one task completes the pipeline end to end.
2. `support/GOVERNANCE_PROOF.md` exists, with event-log evidence that budget and loop governance
   actually fire.
3. Concurrency tested; no task is ever checked out twice.
4. Budget counts something other than dollars, or it is documented why not.
5. The critique ring runs with **asserted** independence.
6. 17 roles ported; 4 ring agents on the subscription lane at $0 marginal.
7. Discord approvals work from your phone, with the negative auth test passing.
8. The strategist routine does not repeat itself by week three.
9. **The Phase 8 acceptance test passes in full.**

Phase 7 (Hermes) is explicitly **not** required for done.

---

## §13 — Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Budget counts only dollars → local and CLI lanes have no ceiling | **High** | §4.1 — add a second metric. This is your code. |
| API key leaks into the CLI child process → silent metered billing | **High** | §0.3 — inspect the child env, not the config |
| Ring reviewers converge (independence broken) | **High** | §6.4 assert on the actual context payload; §11 requires visible disagreement |
| Governance present but never fires | Medium | Phase 1 exists solely to disprove this |
| Concurrency bug in atomic checkout | Medium | Phase 2 |
| Helper bridge flakiness propagates to CLI lane and dev-server | Medium | §0.6 — fix before Phase 4 |
| Strategist becomes noise | Medium | §9 rolling context; Phase 7 if it persists |
| Discord approval spoofing | Medium | Allowlist + mandatory negative test |
| Repo is young (10 commits) and unexercised | Low | The entire first half of this plan |

---

## §14 — Appendix A: the stack, and where Mastra sits

Written down because it is obvious now and will not be in three months.

### A.1 Mastra is a library, not a service

This is the whole distinction. Paperclip and Hermes are programs you run; Mastra is a dependency you
import. It competes with neither — it is the layer underneath your control plane.

| | What it is | Runs where | Used via |
|---|---|---|---|
| **Mastra** | TypeScript agent framework | inside the Next.js process | `import` |
| **Hermes** | Standalone agent program | its own process | subprocess |
| **Claude Code CLI** | Standalone coding agent | its own process | subprocess, via the helper |
| **Paperclip** | Control plane application | its own server | HTTP / UI |
| **Vela** | *This* control plane | the Next.js process | HTTP / UI |

Vela and Paperclip occupy the same slot. Hermes and Claude Code CLI occupy the same slot. Mastra
occupies a slot nothing else here does — which is why a Paperclip fork would have meant dropping
Mastra entirely.

### A.2 What is Mastra's and what is yours

```
Next.js process
├── UI + API routes                    ← yours
├── src/lib/orchestration/             ← yours: policy layer, no AI calls
├── src/lib/governance/                ← yours: budget, loop detection
├── src/lib/mastra/
│   ├── index.ts        Mastra singleton (agents: {} — see A.3)
│   ├── agent-factory.ts  builds an Agent per invocation      ← Mastra API, your logic
│   ├── workflows/        3 workflows, 13 steps               ← Mastra primitives
│   ├── heartbeat.ts      ← yours, despite the directory
│   ├── router.ts         ← yours, despite the directory
│   └── scheduler.ts      ← yours, despite the directory
└── vela-helper (separate process) → claude -p / codex exec / shell / git
```

Mastra supplies four things: the `Agent` primitive, the tool-calling loop, workflow orchestration
(steps, branching, suspend/resume), and eval/telemetry hooks. Everything that makes Vela a control
plane rather than an agent script — heartbeat, atomic checkout, three-lane routing, budget
enforcement, loop detection, mode classification — is yours. The directory name understates that.

### A.3 Vela uses Mastra unusually, on purpose

The singleton declares `agents: {}` — nothing statically registered. `agent-factory.ts` builds a
configured Agent per heartbeat from Postgres.

That is the right call for this product: agents are database rows edited in the UI, not code that
requires a redeploy. The consequence is that Mastra features assuming statically-declared agents do
not apply — which is exactly why `src/mastra/` (the Studio scaffold) was deleted in `a35fb7b`.

⚠ **Stale reference:** `.claude/launch.json` still carries a `dev:mastra` entry on port 4111
pointing at that deleted scaffold. Harmless, but it will mislead the next reader. Remove it during
Phase 0.5 alongside the SSE comment.

### A.4 The lanes are two different shapes — this matters

| Lane | Who owns the agent loop | Model is |
|---|---|---|
| Ollama, cloud API | **Mastra.** It does the tool calling. | a completion endpoint |
| CLI subscription | **The CLI.** `claude -p` reads files, edits, runs commands, returns a result. | a whole agent |

Vela already runs nested agent loops, and it works because the boundary is clean: the CLI lane is
treated as a "do this task" black box, not a "complete this turn" model. A Hermes lane (Phase 7)
would be a third instance of the same pattern — no new architectural problem.

### A.5 ⚠ The consequence for the critique ring

**Ring reviewers do not need an agent loop.** They read a PRD and emit findings — a
completion-shaped task.

Running them on the CLI subscription lane is still correct: a frontier model at zero marginal cost.
But that lane hands them a full coding harness with file access, and **a reviewer given a repo will
go read the repo instead of critiquing the document.** The findings will look plausible and be about
the wrong artifact.

When wiring the ring agents in Phase 4: invoke them **without a repo target**, or constrain the
toolset so they cannot wander. One line of configuration; otherwise a confusing afternoon.

---

## §15 — Appendix B: where the role and protocol files live

The completion plan references role definitions and a critique protocol. These are **Vela runtime
skills** — markdown injected into Vela's own agents at heartbeat time — not Claude Code skills.
Keeping the two straight matters:

| Kind | Lives in | Read by | Example |
|---|---|---|---|
| **Claude Code skill** | `.agents/skills/` | the agent *building* Vela | `agent-orchestration/SKILL.md` |
| **Vela runtime skill** | `skills` table in Postgres | Vela's *own* agents, per heartbeat | the 17 roles, `critique-protocol` |

Runtime skills live in the database, but database rows are not in git. The repo already has a
precedent for version-controlled markdown that gets injected into agent prompts —
`docs/agent-playbooks/` (`web.md`, `supabase.md`, `ios.md`), loaded by
`src/lib/orchestration/playbook-loader.ts`. Follow it.

### B.1 Layout

```
docs/
├── agent-playbooks/          ← exists, unchanged
│   ├── web.md
│   ├── supabase.md
│   └── ios.md
├── agent-roles/              ← NEW — canonical home for the 17 roles
│   ├── product-strategist.md
│   ├── ux-designer.md
│   ├── differentiation-monetization-strategist.md
│   └── … (14 more)
└── agent-protocols/          ← NEW
    └── critique-protocol.md
```

`src/lib/db/seed.ts` reads both new directories into the `skills` table (global scope) on seed, the
same way playbooks are already loaded from disk. Editing a role becomes: change the markdown, commit
it, re-seed. Git is the source of truth; the table is the runtime cache.

### B.2 Do not duplicate the roles

Sixteen role definitions already exist at
`.agents/skills/agent-orchestration/references/*.md`. **Move them, do not copy them.** Two copies
guarantees drift, and drift in a role definition is invisible until an agent behaves oddly.

- `docs/agent-roles/` becomes canonical.
- `.agents/skills/agent-orchestration/SKILL.md` **keeps** its genuinely skill-shaped content — the
  roster matrix, tier routing, phase activation, handoff protocol — and points at `docs/agent-roles/`
  for the individual definitions instead of carrying its own copies.

One source, two consumers: Claude Code reads it as a skill, Vela seeds it as runtime content.

### B.3 The two flipped mandates

Per §7 (Phase 4), the ring reviews rather than authors. Add the audit variants as **separate files**
rather than editing the originals — the authoring mandates are still correct for execution-phase
work:

```
docs/agent-roles/
├── product-strategist.md              ← authoring mandate, unchanged
├── prd-auditor.md                     ← NEW: the flipped variant
├── ux-designer.md                     ← authoring mandate, unchanged
└── flow-hardener.md                   ← NEW: the flipped variant
```
