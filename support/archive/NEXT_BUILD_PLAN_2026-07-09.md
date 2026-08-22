# Vela — Next Build Plan

> Scope + sequencing for the next implementation pass. Distilled from the Vela vs. Ship Studio competitive brief (2026-07-09, full brief: https://claude.ai/code/artifact/0e618163-8164-4f3a-ae90-3aea7335a6aa) plus decisions made after reviewing it. This is a work order for an implementing agent, not a design doc — it tells you *what* and *why*, not exact *how*. Where a section says "design this," that's a real gap, not an omission.

**Before touching anything under `src/lib/mastra` or `src/mastra`: load the `mastra` skill first, per `AGENTS.md`. Non-negotiable.**

Codebase facts below reflect a state audit from 2026-07-09. Re-verify file contents before trusting line-level claims — this doc is a starting map, not a live source of truth. The repo is the source of truth (`AGENT_ORCHESTRATION_V2.md` §Philosophy).

---

## Scope — what ships this pass

### 1. Fix regardless (do first — nothing else matters if this isn't safe to run)

- **Auth hardening.** `src/app/api/auth/login/route.ts` currently allows any login when `VELA_PASSWORD` is unset — a dev-mode fallback with no guard against reaching production. Close that gap; decide explicitly whether this stays single-user (per `IMPLEMENTATION_PLAN.md`'s "not multi-user" principle) or needs real sessions/roles now.
- **Deployment story.** No `Dockerfile`, no Railway config exist despite Railway being the named target in `IMPLEMENTATION_PLAN.md`. Add container/deploy config, secrets management, health checks, and structured error reporting (Vela currently has nothing playing the role Sentry plays for Ship Studio).
- **Docs.** Root `README.md` is still the unedited Mastra scaffold text. Replace it with real setup instructions; this blocks anyone but the original builder from standing this up.

### 2. Orchestration core — the actual differentiator

This is the highest-leverage bucket. Ship Studio has no equivalent to any of this; it's what Vela is *for*.

- Unstub the decision logic: `src/lib/orchestration/verification-policy.ts` and `src/lib/orchestration/implementation-audit.ts` both fall back to `null` on unhandled branches. Replace silent degradation with defined behavior for every branch.
- Harden escalation handling and load-test `src/lib/mastra/heartbeat.ts` under concurrent tasks — this loop is meant to run unattended; it needs to survive that.
- **Make the verification gate visible.** Right now nothing in the UI shows the Reviewer/Verifier gate operating. Surface it in the activity feed — this doubles as most of the "diff/what-changed view" work below, so do them together.
- **Adequate → Strong: assigned research task.** Three capabilities are currently rated "Adequate" (functional, not differentiated) and need a real answer for what "Strong" looks like before or while implementing:
  1. **Multi-agent task decomposition** — `src/lib/orchestration/task-shape.ts` / mode-classification exist and route on the 4 axes from `AGENT_ORCHESTRATION_V2.md` (ambiguity, blast radius, cross-stack complexity, verification difficulty). Verify the Supervisor actually selects the *minimum* specialist set per task rather than always running the full pipeline — confirm or fix.
  2. **Independent review/verification gate** — ties directly to the unstubbing work above. Strong means: no null-degradation, every gate outcome is auditable (see gate visibility above), and failure modes are explicit rather than swallowed.
  3. **Budget & loop governance** — `budgetMonthlyUsd` / `budgetUsedUsd` exist on the agents table and a `LoopTracker` exists in `heartbeat.ts`, but "exists and is tracked" isn't the same as "enforced." Strong means these actually throttle, block, or escalate when exceeded — confirm current behavior, then close the gap.

  Write a short design note per item (what "Strong" means, concrete change needed) before implementing — this is deliberately left open rather than prescribed.

### 3. Execution backends: CLI mode + failover

New scope, not in the original brief. Lets Vela use Claude Code CLI / Codex CLI under subscription auth as a cheaper alternative to metered API billing — the thing Ship Studio does well — without losing Vela's "runs while I'm away from my computer" property.

- Extend the existing `vela-helper` pattern (`src/lib/helper/client.ts`) — or a sibling bridge — to run headless CLI invocations (`claude -p "..."`, `codex exec ...`) on a machine the user has logged the CLI into.
- **This bridge must run on an always-on box the user controls (home server, small VPS), not their laptop.** A CLI-routed task can only execute where its login session lives — if that's a laptop, "remote when I'm away" breaks for CLI-mode tasks specifically. Surface this constraint in setup/docs, don't bury it.
- Add a third execution lane to `src/lib/mastra/router.ts` / `src/lib/orchestration/model-selection.ts`, alongside the existing Claude API and Ollama lanes.
- **Failover: CLI mode → API mode.** Subscription usage caps (rolling-window limits) are sized for individual interactive use, not an autonomous fleet running 24/7 — they'll get hit. Router needs to detect cap/unreachable-bridge conditions and fail over to API-key execution automatically, the same way it already falls back to Ollama today.

### 4. Dev server control

New scope, not in the original brief. Scaled down from an earlier "live preview" idea — no embedded preview pane, no proxying through Vela's web app. Just start/stop plus a link out.

- Dev server lifecycle (start/stop/status) as a managed process via the `vela-helper` bridge — same rationale as CLI mode: this needs to run near the user's actual cloned code, not on Railway.
- Vela's UI tracks the port the dev server bound to (reported by the helper) and renders a link/button: `Open http://localhost:<port>`. No iframe, no proxy — it opens directly in the user's own browser.
- **This works because it assumes the browser viewing Vela and the machine running `vela-helper` are the same machine.** That's true for the primary "sitting at my desktop" use case. If Vela is ever checked from a different device than the one running the helper (phone, another computer), the localhost link won't resolve there — worth noting in the UI (e.g., grey out the link if the helper reports a different host) but not a blocker for this scope.

### Explicitly out of scope (carried forward from the brief's "Skip")

Desktop packaging, visual/no-code editing, template library, one-click multi-host deploy. Off-thesis for a headless orchestrator — do not pick these up opportunistically while working on the above.

Also stripped this round: **embedded live preview** (in-app preview pane / proxied iframe of the running app). Replaced by the much smaller "Dev server control" scope in §4 — a start/stop button and a localhost link, not a rendered preview surface. Don't re-add the embedded version without a deliberate decision to revisit it.

### Heads-up, not in scope but a real dependency

The GitHub clone path (`src/lib/mastra/tools/workspace-tools.ts`, `vela-helper`) is only ~50% proven — OAuth/API layers are solid, but there's no UI flow to trigger a clone and the helper service's reliability is untested. Both CLI mode and live preview extend that same helper. If it's flaky, that flakiness inherits into both new features — worth a quick reliability pass if either workstream stalls on it, even though it wasn't explicitly greenlit this round.

---

## Suggested phase order

| Phase | Covers | Rough estimate | Depends on |
|---|---|---|---|
| 1 | Fix regardless (auth, deploy, docs) | 3–6 wks | nothing — do first |
| 2 | Orchestration core (unstub, harden, Adequate→Strong x3, gate visibility + diff view) | 5–10 wks | Phase 1 (safe to run before hardening the thing that runs unattended) |
| 3 | CLI execution mode + failover | 2–4 wks | Phase 2's router work touches the same files |
| 4 | Dev server control (start/stop + localhost link) | 1–2 wks | none — parallelizable with Phase 3 |

Total: roughly 11–22 engineer-weeks solo.

---

## Pointers into the codebase

- Auth: `src/app/api/auth/login/route.ts`, `src/app/login/page.tsx`
- Orchestration: `src/lib/orchestration/verification-policy.ts`, `implementation-audit.ts`, `task-shape.ts`, `low-risk-discovery.ts`, `model-selection.ts`
- Execution loop: `src/lib/mastra/heartbeat.ts`, `src/lib/mastra/router.ts`
- Agents: `src/lib/mastra/agents/` (implementer.ts, repo-mapper.ts confirmed; others follow the same pattern), `src/lib/mastra/agent-factory.ts`
- Workflow pipeline: `src/lib/mastra/workflows/steps/` (plan, implement, review, verify, synthesize, repo-map, debug-*)
- Local bridge to extend: `src/lib/helper/client.ts`
- GitHub/workspace: `src/lib/mastra/tools/workspace-tools.ts`
- UI: activity feed (component `ActivityFeedClient` — SSE wiring incomplete), scheduler page (`parseCronNext()` stub, returns "Scheduled" unconditionally)
- Vision docs for context: `support/IMPLEMENTATION_PLAN.md`, `support/AGENT_ORCHESTRATION_V2.md`
