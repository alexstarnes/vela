# Claude Code CLI — Agent roster for Vela

This document defines **specialized agents** you can configure in [Claude Code](https://docs.anthropic.com/en/docs/claude-code) so implementation work maps cleanly to [`support/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) and the visual system in [`support/vela-ui-spec.jsx`](./vela-ui-spec.jsx).

**Authoritative build order:** follow the plan’s phases (1 → 2 → 3 → 4 → 5). Phase 3 (heartbeat + Mastra) is the riskiest surface; give that agent your strongest model.

---

## How to use this doc

1. Create one Claude Code **subagent** (or custom agent profile) per row below.
2. In each agent’s instructions, require:
   - **Read first:** `support/IMPLEMENTATION_PLAN.md` for scope and file layout.
   - **UI work:** `support/vela-ui-spec.jsx` for tokens, screen structure, component catalog, responsive rules, and state matrix (empty states, SSE, budget/loop/Ollama offline).
3. **Handoff rule:** each agent leaves `pnpm build` (and `pnpm exec tsc --noEmit` if applicable) passing before the next phase starts.
4. **Repo reality check:** the plan assumes a **greenfield Next.js + pnpm** app under `vela/`. If you are evolving the existing Mastra-only repo, the **Foundation** agent should explicitly reconcile the plan’s tree with what is already in the workspace (merge, don’t blindly duplicate `src/mastra` vs `src/lib/mastra`).

---

## Model recommendations (for *coding* agents)

These are **suggested Claude models for Claude Code**, not Vela’s runtime models (Sonnet/Haiku/Ollama). Map them to whatever identifiers your CLI exposes (`opus`, `sonnet`, `haiku`, etc.).

| Tier | When to use |
|------|----------------|
| **Opus** | Ambiguous orchestration logic, Mastra API alignment, heartbeat concurrency, model routing edge cases. |
| **Sonnet** | Default for full-stack feature work, Drizzle/schema correctness, most UI. |
| **Haiku** | Tight edits, lint/format-only passes, small copy or config tweaks after Sonnet work. |

---

## Agent roster

### 1. Vela — Orchestrator (phase coordinator)

| Field | Value |
|--------|--------|
| **Purpose** | Break work into phase-sized chunks, enforce dependencies, and route tasks to the right specialist agent. Minimal direct coding. |
| **Scope** | Maintain a short living checklist tied to IMPLEMENTATION_PLAN §6–11; resolve conflicts when the repo already has Mastra scaffolding; ensure Phase 3 is unblocked (schema + CRUD + env vars). |
| **Primary inputs** | `support/IMPLEMENTATION_PLAN.md`, git status, existing `package.json` / `src/` layout. |
| **Suggested model** | **Sonnet** (balanced planning). **Haiku** is acceptable if you only need lightweight task splitting. |
| **Exit criteria** | Written handoff notes: what’s done, what’s next, which agent owns it, env vars still missing. |

---

### 2. Vela — Foundation (Phase 1)

| Field | Value |
|--------|--------|
| **Purpose** | Application skeleton: Next.js App Router, Tailwind/shadcn baseline, Drizzle + Postgres, auth cookie, sidebar shell. |
| **Scope** | IMPLEMENTATION_PLAN §7: init/deps (pnpm), `drizzle.config.ts`, **full schema** in `src/lib/db/schema.ts`, migrations, seed for `model_configs`, `VELA_PASSWORD` middleware + login route, root layout + sidebar nav (Tasks, Agents, Projects, Skills, Scheduler, Activity, Settings). |
| **UI alignment** | `vela-ui-spec.jsx`: **dark-first** direction (plan §1.6); map §06 “Implementation Tokens” to `globals.css` / shadcn variables (amber primary, warm stone neutrals). Sidebar width **220px desktop** per spec. |
| **Suggested model** | **Sonnet** (high precision for schema + Next wiring). |
| **Exit criteria** | DB migrates cleanly; login protects routes; nav shell renders; `pnpm build` passes. |

---

### 3. Vela — Core loop (Phase 2)

| Field | Value |
|--------|--------|
| **Purpose** | Domain CRUD and server actions: projects, agents, tasks, skills — plus Zod validation and Drizzle types per plan §13. |
| **Scope** | IMPLEMENTATION_PLAN §8: list/detail pages, forms, task status transitions **per state machine**, `task_events` append-only logging hooks (can stub SSE emitter until Phase 4). |
| **UI alignment** | Implement screens that match **Agents** (cards + `BudgetBar`), **Projects** (cards + progress), **Skills** (split editor + preview), and **Task detail** structure (thread + sidebar slots) per `vela-ui-spec.jsx` — use **Lucide** icons, mono for machine strings, badge colors for task/agent/event states (component catalog + state matrix). |
| **Suggested model** | **Sonnet**. |
| **Exit criteria** | All CRUD paths work without running heartbeats; invalid task transitions rejected; events logged on mutations where the plan expects them. |

---

### 4. Vela — Orchestration engine (Phase 3) — *critical path*

| Field | Value |
|--------|--------|
| **Purpose** | Embedded Mastra, runtime agent factory, tools, model router, **heartbeat execution**, `node-cron` scheduler, atomic task checkout, integration with `task_events` and budget fields. |
| **Scope** | IMPLEMENTATION_PLAN §9: `src/lib/mastra/*`, `task-tools.ts`, `project-tools.ts`, `router.ts` (Ollama tunnel + tier fallback), `executeHeartbeat`, scheduler init/reschedule, API routes for heartbeat + models + health. |
| **Constraints** | Load project Mastra skill / `node_modules` docs when APIs are uncertain (per `AGENTS.md`). Heartbeat errors must not crash the process (plan §13). |
| **Suggested model** | **Opus** (first implementation). **Sonnet** for follow-up refactors once behavior is stable. |
| **Exit criteria** | Manual + cron heartbeat runs; tool calls create delegations and messages; Ollama offline triggers fallback; locks released in `finally`. |

---

### 5. Vela — Product UI (Phase 4)

| Field | Value |
|--------|--------|
| **Purpose** | Polish **task board**, **live activity**, **scheduler**, **settings** to match the spec’s density and interaction patterns. |
| **Scope** | IMPLEMENTATION_PLAN §10: Kanban + DnD, filters, task thread rendering by **event type**, SSE consumer, scheduler table + “Run now”, settings sections (models, tunnel, budgets, danger zone). |
| **UI alignment** | `vela-ui-spec.jsx` screens: approval banner on board, **Board vs List** toggle, right-rail **goal ancestry** + **cost breakdown** on task detail, filter chips, responsive rules §04 (sidebar collapse, kanban scroll). |
| **Suggested model** | **Sonnet**. |
| **Exit criteria** | Spec’s major screens are recognizable; empty/loading/error states from state matrix §05; SSE updates visible where specified. |

---

### 6. Vela — Governance & differentiation (Phase 5)

| Field | Value |
|--------|--------|
| **Purpose** | Budget enforcement, loop detection, approvals pipeline, Ollama fallback UX signals. |
| **Scope** | IMPLEMENTATION_PLAN §11: transactional budget updates, 80% warning / 100% pause, `approvals` table + rules for `create_subtask`, loop map + `LoopDetectedError`, UI cues for fallback model vs configured model. |
| **UI alignment** | State matrix: budget warning/exceeded, loop detected, Ollama offline, waiting_for_human + approval banner. |
| **Suggested model** | **Sonnet** (logic + UI wiring). **Opus** if race conditions or transaction boundaries stay buggy. |
| **Exit criteria** | Plan’s default governance rules behave as specified; user can approve/reject delegation from UI. |

---

### 7. Vela — QA & integration

| Field | Value |
|--------|--------|
| **Purpose** | Cross-phase verification: build, typecheck, critical path smoke tests, Railway/deploy script sanity (plan §15). |
| **Scope** | Run `pnpm build`; exercise login → create project → agent → task → manual heartbeat; verify SSE and migration story; confirm `.env.example` matches plan §14. |
| **Suggested model** | **Sonnet** for debugging failures; **Haiku** for trivial script/message fixes only. |
| **Exit criteria** | Reproducible “smoke” checklist checked in (as comments in PR or short `README` section — only if you want it; optional per your workflow). |

---

### 8. (Optional) Vela — Design tokens & a11y pass

| Field | Value |
|--------|--------|
| **Purpose** | Single pass to align shadcn theme, focus rings (amber, 2px offset), contrast, and responsive breakpoints with §03–§06 of the UI spec. |
| **Scope** | No feature work unless blocking visuals; WCAG-oriented contrast check on amber-on-stone. |
| **Suggested model** | **Sonnet**. |
| **Exit criteria** | Token mapping documented in code comments or `README` snippet; focus states visible on sidebar and form controls. |

---

## Suggested parallelization

| Parallel safe | Serialize |
|---------------|-----------|
| After Phase 1: **Core loop** (data + basic pages) can advance in parallel with early **Mastra spike** only if you agree on interfaces (`logTaskEvent`, agent factory inputs). | **Orchestration engine** needs schema + task/agent tables and event logger contracts from Phase 2. |
| **QA** runs after each phase merge. | **Product UI** (Phase 4) should follow at least stubbed APIs from Phases 2–3. |

---

## One-line system prompt stubs (copy into Claude Code)

Use these as starting points; expand with your preferred tooling (grep, tests, etc.).

**Foundation:**  
“You implement Vela Phase 1 from `support/IMPLEMENTATION_PLAN.md`. Use pnpm, Drizzle, Next.js App Router, and shadcn. Map visual tokens from `support/vela-ui-spec.jsx` §06. Do not skip migrations or auth.”

**Core loop:**  
“You implement Phase 2 CRUD and server actions. Enforce the task status machine exactly as in the plan. Align list/detail layouts with `support/vela-ui-spec.jsx` screen mocks.”

**Orchestration engine:**  
“You implement Phase 3: embedded Mastra, tools, model router with Ollama fallback, and the heartbeat loop with atomic checkout and event logging. Prefer Mastra docs from the installed package. This is the highest-risk area — favor correctness over shortcuts.”

**Product UI:**  
“You implement Phase 4 UI: Kanban, SSE activity feed, scheduler table, settings. Follow `support/vela-ui-spec.jsx` for structure, density, badges, and empty/loading states.”

**Governance:**  
“You implement Phase 5: budget transactions, loop detection, approvals. Match the plan’s default rules and the UI spec’s warning/error states.”

---

## Summary table

| Agent | Phase | Suggested model | Highest-risk dependency |
|-------|--------|-----------------|-------------------------|
| Orchestrator | Meta | Sonnet | Honest assessment of repo vs greenfield plan |
| Foundation | 1 | Sonnet | Drizzle schema ↔ plan §5 |
| Core loop | 2 | Sonnet | Task FSM + events |
| Orchestration engine | 3 | **Opus** (then Sonnet) | Mastra + heartbeat + locking |
| Product UI | 4 | Sonnet | SSE + Kanban complexity |
| Governance | 5 | Sonnet | DB transactions + UX edge cases |
| QA & integration | Cross-cutting | Sonnet / Haiku | None |

---

*Generated to complement the Vela implementation plan and UI spec; adjust agent names to match your Claude Code CLI configuration format.*
