# Vela — Project Status

**Last updated: 2026-08-22**

> This is the **living status document** for Vela — written for a fresh agent (or the user) picking up this repo cold. It reflects the current state, verified against the actual code, not against older docs.
>
> **Maintenance rule:** update this file *in place* as the project evolves. Don't create a new dated `STATUS_YYYY-MM-DD.md` file for the next check-in — edit this one and bump the "Last updated" line above. If a section changes so much that the old version is worth preserving (e.g. before a major rewrite), copy the outgoing section into a dated file under `support/archive/` first, note it in `support/archive/README.md`, then edit this file. See `support/archive/README.md` for what's already been retired this way — including the previous "what's left" doc this file replaced.
>
> **Re-verify anything load-bearing before you build on it** — even a same-day update is a snapshot, not a live source of truth.
>
> Before touching anything under `src/lib/mastra` or `src/mastra`: load the `mastra` skill first, per `AGENTS.md`. Non-negotiable.

---

## 1. What Vela is

A self-hosted **agent orchestration platform**: register projects (local folders or GitHub clones), create tasks, and a supervised pipeline of agents — classify → repo-map → plan → implement → verify → review — writes real code changes into the project workspace, with deterministic verification gates and human approval at the end. Single-user by design: one password, one operator, agents working while you're away.

**Two-process architecture:**
| Process | Does | Runs where |
|---|---|---|
| Web app (Next.js) | UI, API, scheduler, heartbeat loop, model routing, budgets, verification policy | Anywhere (Railway/VPS/local) |
| `vela-helper` | Workspace file access, git ops, shell commands, headless `claude -p` / `codex exec` CLI execution, dev-server control | An always-on machine you control, next to your cloned repos |

They talk over HTTP (`VELA_HELPER_URL`) with a shared secret (`VELA_HELPER_SECRET`).

**Model routing**, in priority order, fails over automatically: local Ollama (free/private) → CLI subscription lane (`claude`/`codex` CLI via the helper, avoids metered billing) → cloud API (Anthropic/OpenAI, lane of last resort). Controlled by the `model_configs` table (`src/lib/db/seed.ts`); per-agent access via `agent_model_access`.

The full up-to-date architecture is also documented in [`docs/architecture.md`](../docs/architecture.md) (short) and the root [`README.md`](../README.md) (setup + env vars) — both were cross-checked against code for this report and are accurate as of this commit.

---

## 2. Bottom line

**The completion plan (`support/VELA_COMPLETION_PLAN.md`, Phases 0–8) executed to done on 2026-08-21** — full evidence trail in [`support/BUILD_LOG.md`](BUILD_LOG.md) (final report at the bottom) and [`support/GOVERNANCE_PROOF.md`](GOVERNANCE_PROOF.md). Headlines:

- **Governance is enforced, not just present**: dollar + run-count budgets fire live (80%/100%/pause/override/monthly reset), loop detection works on the workflow path, wall-clock ceilings abort hung steps, killed-process recovery verified with a real SIGKILL, zero double-checkouts under concurrent load.
- **The critique ring works**: 3 independent CLI-opus reviewers + synthesizer tore apart a deliberately weak PRD (50 schema-valid findings, 3 genuine cross-reviewer escalations, 100% reconciliation), gate held until a real Discord approval from the operator's phone, 21 backlog child tasks created with ancestry, and one child ran the full pipeline to `review` with a real +332-line change — via the tier-escalation ladder (qwen failed 3×, escalated to CLI opus, passed).
- **Cost**: $0.10 metered for the entire run (scorer calls); all agent generation on local Ollama + CLI subscription lanes.
- **Phase 7 (Hermes) intentionally not started** — explicitly out of scope per the plan.

What's left is the follow-up list in §5.

---

## 3. Architecture map (verified against code, not docs)

| Area | State |
|---|---|
| `src/app/` | Next.js App Router. `(app)` route group: projects, tasks (Kanban + list, `@hello-pangea/dnd`), agents, scheduler, activity (SSE feed), skills, settings, orchestration-model (renders `support/AGENT_ORCHESTRATION_V2.md`). 14 API routes: auth, heartbeat trigger, SSE stream, GitHub OAuth (connect/callback/repos/branches/refresh), helper proxy, model configs, dev-server control, approvals. |
| `src/lib/mastra/` | **Product runtime.** `index.ts` (Mastra singleton, `agents: {}` — agents are built dynamically per heartbeat, not statically registered), `agent-factory.ts` (442 lines — builds a configured Mastra Agent per invocation), `heartbeat.ts` (979 lines — atomic checkout, budget, loop detection, approval gating), `router.ts` (601 lines — Ollama→CLI→API failover), `scheduler.ts` (176 lines — node-cron + stale-lock cleanup), plus `agents/` (5 definitions), `tools/`, `workflows/` (3 workflows, 13 step files), `evals/`, `analytics/`. |
| `src/lib/orchestration/` | Deterministic policy layer, no AI calls: mode classification (4-axis scoring), workflow selection, model-selection, task-shape (execution policy), verification-policy, implementation-audit, cli-lane (cooldown tracking), escalation, routing-tuning, playbook-loader, template-injector, low-risk-discovery. Has its own test suite (4 files). |
| `src/lib/db/` | Drizzle schema, 11 migrations (`0000`–`0010`), `seed.ts`. `0010` adds `task_dependencies` (backlog ordering as data). |
| `src/lib/actions/` | Server actions (agents, approvals, model-configs, projects, skills, tasks), all Zod-validated. |
| `src/lib/governance/` | `budget.ts` (atomic spend, 80%/100% thresholds, monthly reset), `loop-detector.ts` (SHA-256 tool-call signature tracking). |
| `src/lib/helper/client.ts` | HTTP client for the helper bridge — file IO, git, shell, CLI execution, dev-server control. |
| `src/lib/events/logger.ts` | Writes `task_events`; SSE clients pick it up via 2s DB polling (see §5). |
| `src/lib/auth/`, `src/lib/security/`, `src/lib/github/`, `src/lib/tasks/state-machine.ts` | Session cookie auth, AES-256-GCM token encryption, GitHub OAuth, task status transitions — all implemented, no stubs found. |
| `src/lib/workspace/branch-lifecycle.ts` | Branch-per-task lifecycle: quarantine a dirty tree, run on `vela/task-<id8>`, commit on review-pass, squash-merge on approve, plus the workspace-health query behind the project flight view. |
| `src/lib/tasks/dependency-graph.ts` / `dependencies.ts` | Backlog ordering: `depends_on` hint validation (drops out-of-range/self/cyclic hints), topological layering for the flight view, and the `task_dependencies` persistence the checkout gate reads. Pure half is split out so it unit-tests without a DB. |
| `src/mastra/` | **Deleted** in `a35fb7b`. If any older doc or memory references it as a "studio scaffold to ignore," that's now moot — it no longer exists. |

---

## 4. Database & seeded agents

10 tables: `projects`, `github_connections`, `model_configs`, `agents`, `agent_model_access`, `skills`, `tasks`, `task_events`, `heartbeats`, `approvals`. Schema and 7 migrations are in sync in the repo; **whether migrations have actually been applied to the live Supabase database was not verified** (no DB connection made during this audit) — check with `npm run db:migrate` / a `list_tables` call before assuming.

`seed.ts` seeds:
- **5 runtime agents** (the intended product model): Supervisor, Repo Mapper, Implementer, Reviewer, Verifier — sourced from `src/lib/mastra/agents/index.ts`.
- 16 legacy reference agents (`agentKind: 'legacy_reference'`, `heartbeatEnabled: false`) — kept for reference, explicitly not scheduled. In-flight tasks on legacy agents get reassigned to Supervisor on seed.
- 11 model configs (Opus/Sonnet/Haiku, Qwen3-Coder 30B, Qwen3 8B, GPT-4o mini, GPT-5.4 mini, Claude Code CLI × 3 tiers, Codex CLI).

**Important gotcha:** all 5 runtime agents seed with `heartbeatCron: null`. Nothing self-executes until a cron is set on an agent (via the Agents UI) or the heartbeat is triggered manually (`POST /api/heartbeat` or the Scheduler page's "Run Now"). This is by design, not a bug, but it surprises anyone expecting autonomy out of the box.

---

## 5. Known gaps (the real "what's left" list)

Everything in the previous version of this list was resolved by the 2026-08-21 completion run (load testing done, governance exercised live, GitHub-clone-through-helper verified E2E, env gaps were a stale audit — secrets live in `.env.local`). The current list is the follow-ups filed in `BUILD_LOG.md`'s final report:

1. ~~**Workspace hygiene between tasks (systemic)**~~ — **fixed 2026-08-22** by workstream A of `ORCHESTRATION_HARDENING_PLAN.md`. Every code workflow now quarantines a dirty tree to `vela/quarantine/<stamp>` (never discards), runs on `vela/task-<id8>`, commits on review-pass and returns the tree to base, and squash-merges into base on operator approve. Per-project serialization stops two tasks sharing a working tree. Verified end-to-end against a real git repo (`tests/workspace/branch-lifecycle.ts`).
2. ~~**Backlog dependency ordering**~~ — **fixed 2026-08-22** by workstream B. The synthesizer emits `depends_on` indices, approval writes `task_dependencies` edges, and checkout eligibility is computed from those edges every time (`tests/governance/dependency-ordering.ts`). **Still to do by the operator:** retro-fit Clipper's existing 18 children with `scripts/propose-task-dependencies.ts` and prune the graph in the project flight view before enabling any cron.
3. **Two children parked at `waiting_for_human`** for operator triage: empty-states (real work, 5 honest review rejections at the requeue limit) and duplicate-detection (blocked on sibling save/import stories — the case workstream B now prevents recurring).
4. Budget-warning latch: re-warns on every heartbeat while in the 80–100% band; should fire once per crossing.
5. mode_selection UI renders "score undefined/8" for product-mode rows (cosmetic).
6. Richer strategist signal test on the CLI lane — the week-3 no-repeat test passed, but all three weeks returned reasoned `nothing_new` (the seat had been diverted to qwen by a since-fixed router bug).
7. Discord approval card: visually disable buttons on finalize in all edit paths (a re-press is already safe, just cosmetically confusing).
8. **Build freshness:** `.next/` may hold a stale dev build; the Dockerfile runs its own production build, so this only matters for local prod testing.

Two `return null` branches (`verification-policy.ts:94`, `implementation-audit.ts:128`) were checked and are **not bugs** — one is a documented conservative "stay blocking" default, the other is the null-means-no-issue happy path. Listed here only so nobody re-flags them without reading the docstrings first.

---

## 6. Test & build health (verified this session)

```
npx tsc --noEmit        → clean, 0 errors (re-verified 2026-08-22)
npm run build           → clean
npm run test:unit       → 45/45 pass (18 new: backlog ordering + execution layering)
tests/workspace/*       → branch-lifecycle passes (real git repo + real helper)
tests/governance/*      → dependency-ordering + the pure-DB budget/loop exercises pass;
                          the server-dependent ones (containment, loop-detection,
                          budget-thresholds, run-budget, stale-lock) not re-run on 2026-08-22
tests/load/*            → checkout-contention passes, now also asserting per-project
                          serialization; sse-under-load not re-run
tests/ring/*            → independence + phase8 acceptance pass (2026-08-21)
tests/discord/*         → handler auth (negative + positive) pass (2026-08-21)
```

`tests/workspace/branch-lifecycle.ts` and the governance/load scripts need `npm run dev:helper` and/or `npm run dev` running — each prints what it needs and exits rather than failing obscurely.

---

## 7. Recent history (for context on *why* things look the way they do)

Only 10 commits total — this is a young, fast-moving repo:

```
495e968 fixed docker issue                                        (cosmetic: Dockerfile newline, public/.gitkeep)
a35fb7b CLI integration to model behavior and forwarding...        (huge: 65 files, +16418/-938 — see below)
b604ab3 added sidebar and orchestration model route.
ed6b51c new architure is fully implemented! ...                    (marks the post-MVP architecture rewrite)
5214b70 updates to local model behaviors.
bb3e1bc added github connections to clone repo.
0afb860 cleaning up build error
c9f1349 seeded agents and skills
0f20eab MVP commit!
aba205e "Initial commit from Mastra"
```

`a35fb7b` is the commit that closed out most of the archived next-build plan (`support/archive/NEXT_BUILD_PLAN_2026-07-09.md`): added `Dockerfile` + `railway.json`, added `scripts/vela-helper.ts` (1038-line standalone bridge server), added the CLI lane (`src/lib/orchestration/cli-lane.ts` + router rewrite), added `task-shape.ts` / `verification-policy.ts` / `implementation-audit.ts` / `low-risk-discovery.ts` / `model-selection.ts`, added dev-server control UI and helper endpoints, rewrote `README.md` from the original Mastra scaffold text into real docs, and **deleted the entire unused `src/mastra/` studio scaffold**.

---

## 8. Practical setup checklist for a fresh agent

1. `.env` needs two more vars added: `VELA_HELPER_SECRET=<random>`, `GITHUB_TOKEN_ENCRYPTION_KEY=<random>` (see §5.5).
2. `npm run db:migrate` (uses `DIRECT_URL`) — confirm live schema matches, don't assume.
3. `npm run db:seed` — seeds model configs + 5 runtime agents + legacy reference agents.
4. Terminal 1: `npm run dev:helper` (port 4312).
5. Terminal 2: `npm run dev` (port 3000). `.claude/launch.json` has this and Mastra Studio (`dev:mastra`, port 4111 — scaffold only, not the product path) pre-configured for Claude Code's browser preview tools.
6. Log in with `VELA_PASSWORD`.
7. If autonomous execution is wanted: set a `heartbeatCron` on the Supervisor agent via the Agents UI, or trigger manually via Scheduler → "Run Now" / `POST /api/heartbeat`.

---

## 9. Where the docs and plans live

**Active — still current, still referenced by code or agent definitions:**

- [`docs/architecture.md`](../docs/architecture.md) — short, accurate architecture summary (verified this session).
- [`docs/definition-of-done.md`](../docs/definition-of-done.md), [`docs/agent-playbooks/`](../docs/agent-playbooks/) (`web.md`, `supabase.md`, `ios.md`) — injected into agent prompts by `src/lib/orchestration/playbook-loader.ts` based on task/repo stack match.
- [`support/IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — the original 5-phase plan (1149 lines). All 5 phases it describes are now complete (§2 above) — read it for original intent/rationale, not for current status. Still referenced by name in every `vela-*` specialist agent definition under `.claude/agents/`, so it stays in place rather than moving to archive.
- [`support/AGENT_ORCHESTRATION_V2.md`](AGENT_ORCHESTRATION_V2.md) — orchestration philosophy, the 4-axis mode-classification model referenced throughout `src/lib/orchestration/`. **Live-rendered in the app itself** at the Orchestration Model page (`src/app/(app)/orchestration-model/page.tsx`) — do not archive or rename without updating that route.
- [`support/CLAUDE_CODE_AGENTS.md`](CLAUDE_CODE_AGENTS.md) — the specialist subagent roster (vela-foundation, vela-core-loop, vela-orchestration-engine, vela-product-ui, vela-governance, vela-qa, vela-orchestrator) mapped to phases — still the right agents to reach for on new work in matching areas. Referenced by the `vela-orchestrator` agent definition.
- [`support/vela-ui-spec.jsx`](vela-ui-spec.jsx) — UI density/interaction spec, referenced by six `vela-*` agent definitions (`vela-foundation`, `vela-core-loop`, `vela-orchestration-engine`, `vela-product-ui`, `vela-governance`, `vela-design-tokens`).
- `.agents/skills/agent-orchestration/SKILL.md` — a Claude Code skill exposing the agent roster/role matrix to any agent that loads it.
- `product-ui-design-director.zip` (repo root) — unreferenced by code, likely a design-skill package; safe to ignore.

**Archived — superseded or unreferenced, kept for history only.** See [`support/archive/README.md`](archive/README.md) for the full list and why each entry moved there.

---

## 10. Suggested next actions

**[`support/ORCHESTRATION_HARDENING_PLAN.md`](ORCHESTRATION_HARDENING_PLAN.md) is built** (workstreams A, B, C on 2026-08-22; §D earlier the same day). Its build record documents what shipped, the two places the build corrected the plan, and the verification evidence.

In rough priority order:

1. **Finish VERIFY C — the one piece of that plan still open.** Retro-fit dependency edges onto Clipper's 18 open children and prune the graph before enabling any cron:
   ```
   npx tsx scripts/propose-task-dependencies.ts --parent <prd-task-id> --dry-run
   ```
   then re-run without `--dry-run`, and review the layers on the project page (each "after:" chip has a delete control).
2. Triage the parked children (empty-states, duplicate-detection) when convenient. Note the shared tree they left dirty will now be quarantined to a branch by the next run rather than leaking into it.
3. Enable the strategist's weekly cron on the Agents UI when ready for standing surveillance (deliberately left off per the no-self-execution seed invariant).
4. Remaining cosmetics: budget-warning once-per-crossing latch, Discord card button disable on finalize.
5. Phase 2 of workspace hygiene if within-project parallelism is ever wanted: git *worktrees* instead of per-project serialization (more helper surface, dev-server path ambiguity, cleanup lifecycle — nothing needs it today).
