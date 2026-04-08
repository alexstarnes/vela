# Agent Orchestration v2 — Merged Model

> Harness-first orchestration for Vela, built on Mastra.
> Merges the agent-orchestration skill (specialist depth, quality gates, handoff protocol) with the Mastra blueprint (runtime shape, cost ladder, mode selection, workflow-encoded pipelines).
> This document is the implementation spec for Claude Code.

---

## Philosophy

The model is 15–20% of system quality. The harness is the other 80%.

1. **Harness-first.** Design the infrastructure around the agent — context, tools, verification, cost controls, observability — before optimizing the model.
2. **Verification-driven.** Every task passes a mechanical quality gate before it moves forward. Gates are code (linters, tests, type checks), not opinions.
3. **Cost-aware.** Route by task complexity. The cheapest successful path is the best path. Tier-1 for everything is a budget failure.
4. **Progressive disclosure.** Give agents a map, not a manual. Short index with pointers to structured docs. Load context on demand, not up front.
5. **Repository as system of record.** If it is not in the repo, it does not exist for the agent.
6. **Agent decides, workflow orchestrates, tool executes.** Agents handle open-ended reasoning. Mastra workflows handle deterministic orchestration, branching, gates, and fan-out/fan-in. Tools handle mechanical operations. Never mix these responsibilities.

---

## System Shape

### Human (you)

Owns: product direction, architecture sign-off, security-sensitive decisions, schema/migration approvals, deployment approvals for production.

### Supervisor Agent

The entry point for all work. Runs at Tier-1 for complex/delegated tasks, Tier-2 for simple/single-agent tasks.

Owns: task intake, classification, mode selection (single/delegated/team), plan generation, tier/model assignment, verification gate enforcement, final synthesis.

Does NOT: write code, make design decisions, bypass quality gates.

### Specialist Agents

Activated by the Supervisor based on task classification. Not all specialists run on every task — the Supervisor selects the minimum set needed.

### Mastra Workflows

Encode the three execution pipelines (feature, high-risk, debug) as repeatable, observable, testable workflow definitions. Workflows call agents as steps, enforce gate ordering, handle fan-out/fan-in, and manage retries/escalation mechanically.

### Tools

Deterministic operations: run lint, run typecheck, run tests, run build, read repo, diff summary, create subtask, update task status. These are NOT agent prompts — they are tool calls with predictable outputs.

---

## Mode Selection

Before routing to specialists, the Supervisor classifies every task on 4 axes (0–2 each):

| Axis | 0 | 1 | 2 |
|------|---|---|---|
| **Ambiguity** | Requirements clear, solution obvious | Some unknowns, 1–2 approaches | Vague, needs exploration |
| **Blast radius** | 1–2 files, no side effects | 3–5 files, bounded module | Cross-module, data/auth/infra |
| **Cross-stack complexity** | Single layer (UI only, API only) | Two layers (UI + API) | Three+ layers (UI + API + DB + infra) |
| **Verification difficulty** | Lint + typecheck sufficient | Needs tests + manual check | Needs security review or integration test |

### Score → Mode

| Score | Mode | Pattern |
|-------|------|---------|
| **0–2** | Single-agent | Supervisor handles directly or delegates to one specialist. Verifier runs after. |
| **3–5** | Delegated | Supervisor plans → 1–3 specialists execute → Reviewer checks → Verifier gates. |
| **6–7** | Delegated + premium | Premium supervisor planning. Standard workers. Premium review mandatory. |
| **8** | Team (rare) | Multiple parallel streams with premium planning + review. Time-boxed. Human approval gates. |

### Security override

Any task touching auth, payments, RLS, secrets, or infrastructure → minimum Tier-1 review regardless of score. Security Auditor involvement mandatory for scores 6+.

---

## Model Pool & Tier Mapping

Concrete models mapped to tiers. The router resolves at execution time based on tier, Ollama availability, and task priority.

### Tier-3 (Fast)

Use for: repo scanning, file lookup, formatting, simple refactors, log summarization, deterministic routing, cheap second-opinion passes.

| Model | Type | Notes |
|-------|------|-------|
| qwen3:8b | Local | Cheapest. Default for mechanical tasks. |
| GPT-4o mini | Cloud | Cheap cloud fallback. Structured extraction, log triage, routing. |

### Tier-2 (Standard)

Use for: normal feature work, bounded debugging, moderate cross-file edits, implementation with clear requirements, routine review, parallel worker subtasks.

| Model | Type | Notes |
|-------|------|-------|
| qwen3:coder-next:Q4_K_M | Local | Default local coding model. Zero-cost iteration loops. |
| GPT-5.4 mini | Cloud | Default cloud coding/subagent model. Use before Sonnet. |
| Claude Haiku 4.5 | Cloud | Tier-2 ceiling. Better judgment than mini models, cheaper than Sonnet. |

### Tier-1 (Premium)

Use for: architecture decisions, multi-step planning, ambiguous debugging, security review, schema/auth/RLS design, large refactors, final synthesis, cross-stack work.

| Model | Type | Notes |
|-------|------|-------|
| Claude Sonnet 4.5 | Cloud | Default premium. Planning, review, architecture, hard debugging. |
| Claude Opus 4.6 | Cloud | Reserve for hardest planning/architecture/security only. |

### Routing Rules

1. Start as low as possible.
2. Escalate when confidence drops or verification fails.
3. Use premium mainly for planning, architecture, and final review.
4. Do not waste premium on rote edits or file discovery.
5. Prefer standard for actual code writing once the plan is clear.
6. Use GPT-4o mini as cloud utility before escalating to Claude.
7. Use GPT-5.4 mini as default cloud coding worker before Sonnet.
8. Ollama offline → fallback to cloud model in same tier automatically.

### Escalation Rules (enforced in code)

```
Tier-3 fails twice on same task → escalate to Tier-2
Tier-2 fails twice on same task → escalate to Tier-1
Tier-1 fails → flag for human review with full context
Security/auth/payments → minimum Tier-1, always
```

Implementation: persist `failure_count` per task. On each failed verification gate or agent error, increment. When threshold hit, `resolveModel()` bumps the tier before retry. Log the escalation as a task event.

### Practical Routing Matrix

| Task | Model |
|------|-------|
| Repo discovery, file tree | qwen3:8b or GPT-4o mini |
| Simple UI tweak | qwen3:coder-next or GPT-5.4 mini |
| New feature (one layer) | qwen3:coder-next or GPT-5.4 mini |
| Feature (UI + backend) | Supervisor on Sonnet, workers on coder-next / GPT-5.4 mini |
| Auth / security / payments / RLS | Sonnet review mandatory, Opus for highest-risk |
| Production incident triage | Supervisor on Sonnet, parallel diagnostics on GPT-5.4 mini / Haiku |
| Large migration / refactor | Sonnet planning, coder-next / GPT-5.4 mini implementation, Sonnet review |
| Structured extraction / routing / log cleanup | GPT-4o mini |

---

## Agent Roster

### Runtime agents (always available, instantiated per-task)

These are the agents that actually run as Mastra agent instances during task execution. Kept small to minimize coordination overhead.

| Agent | Role | Default Tier | Escalates To |
|-------|------|-------------|--------------|
| **Supervisor** | Classify, plan, route, synthesize | Tier-1 (Sonnet) or Tier-2 (GPT-5.4 mini / Haiku) | Opus for hardest planning |
| **Repo Mapper** | Read repo, find files, trace deps, build implementation map | Tier-3 (qwen3:8b) | GPT-4o mini, coder-next |
| **Implementer** | Write/edit code within the plan | Tier-2 (coder-next) | GPT-5.4 mini, Sonnet for ambiguous work |
| **Reviewer** | Inspect diffs, detect edge cases, confirm plan adherence | Tier-2 (GPT-5.4 mini) | Sonnet, Opus for architecture/security |
| **Verifier** | Run lint, typecheck, tests, build. Report failures as structured data. | Tier-3 (qwen3:8b) | GPT-4o mini for tricky failure diagnosis |

**Supervisor tier routing:** The Supervisor does NOT always need Tier-1. Route based on the task's mode score:

- **Score 0–2 (single-agent):** Supervisor runs at Tier-2 (GPT-5.4 mini or Haiku). Simple classification and direct delegation — no complex planning needed.
- **Score 3–5 (delegated):** Supervisor runs at Tier-1 (Sonnet). Multi-step planning, decomposition, and synthesis require stronger reasoning.
- **Score 6+ (high-risk/team):** Supervisor runs at Tier-1 (Sonnet), with Opus available for the hardest architecture/security planning.

Implementation: `resolveModel()` for the Supervisor checks the task's mode score. If score ≤ 2 and no security flags, resolve to Tier-2. Otherwise Tier-1. This saves significant cost on the majority of tasks which are routine.

### Specialist prompt templates (loaded into Implementer/Reviewer when relevant)

These are NOT separate runtime agents. They are prompt templates injected into the Implementer or Reviewer when the task domain matches. This keeps runtime agent count low while preserving specialist depth from the original 16-agent roster.

| Template | Injected When | Source |
|----------|---------------|--------|
| Frontend Web | Task touches React/Next.js UI, routing, components, client/server boundaries | references/frontend-engineer.md |
| Backend | Task touches APIs, business logic, server-side integrations | references/backend-engineer.md |
| Database | Task touches schema, migrations, query optimization, RLS | references/database-engineer.md |
| Supabase | Task touches Supabase auth, storage, edge functions | Stack playbook |
| SwiftUI | Task touches iOS views, navigation, state | references/frontend-engineer.md (iOS variant) |
| Apple Platform | Task touches entitlements, capabilities, build settings | Stack playbook |
| API Integration | Task touches networking, decoding, async flows | Stack playbook |
| Security | Task touches auth, secrets, permissions, dependency risk | references/security-auditor.md |
| DevOps/Infra | Task touches env vars, deploy config, CI/CD | references/devops-engineer.md |
| Performance | Task touches bundle/runtime/build/perf regressions | references/performance-engineer.md |

### Full specialist roster (for human planning & phase management)

The original 16-agent roster is preserved as the **reference library** for understanding capabilities, anti-patterns, handoff rules, and collaboration maps. Use it when:

- Planning project phases (which domains are active)
- Writing agent playbooks or AGENTS.md
- Reviewing agent output quality
- Deciding which prompt template to inject

The phase activation matrix, domain assignments, and reference doc routing table from the original skill remain valid. Load the reference doc when that specialist template is activated.

---

## Execution Pipelines (Mastra Workflows)

### Pipeline A: Default Feature Workflow

Triggered when: mode is `single-agent` or `delegated`, score 0–5.

```
intake
  → classify (mode, tier, stacks affected)
  → [if delegated] repo_map
  → plan (Supervisor generates implementation plan)
  → implement (1–N Implementer agents, parallel if independent)
  → verify (Verifier: lint → typecheck → test → build)
    → FAIL? retry with same tier, then escalate
  → review (Reviewer: diff quality, edge cases, plan adherence)
    → FAIL? send feedback to Implementer, re-implement, re-verify
  → synthesize (Supervisor: summary of changes, risks, next actions)
```

### Pipeline B: High-Risk Workflow

Triggered when: score 6+, or task touches auth/security/payments/schema/production.

```
intake
  → classify (risk flags detected)
  → premium_plan (Supervisor at Sonnet/Opus)
  → human_approval_gate (if schema/auth/prod changes)
    → REJECTED? stop, return to human
  → [if delegated] repo_map
  → implement (specialists, premium review on each)
  → verify (full gate sequence including security gates)
  → premium_review (Reviewer at Sonnet/Opus)
    → FAIL? re-implement with premium feedback
  → deployment_readiness_summary
  → human_approval_gate (before any production action)
```

### Pipeline C: Debug Workflow

Triggered when: task is bug report, incident, or error investigation.

```
intake (logs, symptoms, error messages)
  → generate_hypotheses (Supervisor ranks 2–4 likely causes)
  → parallel_diagnostics (1–3 Implementers investigate in parallel, each hypothesis)
  → gather_evidence (Verifier runs targeted checks)
  → root_cause_selection (Supervisor picks most likely cause with evidence)
  → patch (Implementer fixes)
  → regression_check (Verifier: full gate sequence)
  → summary (cause, fix, prevention recommendation)
```

### Workflow step contracts

Each workflow step receives and produces structured data:

```typescript
interface WorkflowStepInput {
  taskId: string;
  planText?: string;
  affectedFiles?: string[];
  previousStepOutput?: Record<string, unknown>;
  tierOverride?: 'fast' | 'standard' | 'premium';
}

interface WorkflowStepOutput {
  status: 'pass' | 'fail' | 'needs_human';
  artifacts?: string[];        // file paths created/modified
  gateResults?: GateResult[];  // lint, typecheck, test, build results
  feedback?: string;           // for re-implementation loops
  escalation?: { reason: string; newTier: string };
}
```

---

## Quality Gates

### Gate ordering (cheapest and most deterministic first)

1. Format / lint
2. Typecheck (strict mode)
3. Narrow tests (unit tests for changed code)
4. Targeted build
5. Reviewer agent
6. Broader integration tests
7. Deploy checks
8. Human approval (high-risk only)

### Gate tiers

#### Minimum gates (all tasks)

- Build compiles without errors
- TypeScript strict mode passes
- No new linter violations introduced

#### Implementation gates (code changes)

- All existing tests pass
- New code has test coverage for critical paths
- No hardcoded secrets or credentials
- File size limits respected
- Import boundaries respected (no circular dependencies)

#### Architecture gates (structural changes)

- Dependency direction validated (no upward dependencies)
- API contracts match documented schemas
- Database migrations are reversible
- No new external dependencies without justification

#### Security gates (auth, data, payments)

- Input validation at all boundaries
- Authentication and authorization checks present
- No SQL injection, XSS, or CSRF vulnerabilities
- Secrets use environment variables, never hardcoded
- Dependencies scanned for known vulnerabilities

### Gate enforcement

Gates are Mastra workflow steps that call deterministic tools. They are NOT agent opinions. The Verifier agent calls `run_lint`, `run_typecheck`, `run_tests`, `run_build` tools and structures the output. Gate pass/fail is mechanical.

---

## Handoff Protocol

When an agent passes work to another agent, it provides structured state (not prose):

```typescript
interface AgentHandoff {
  whatWasDone: string;           // summary with file paths
  whatRemains: string[];         // explicit remaining tasks
  whatFailed: string[];          // errors, blocked items, concerns
  contextPointers: string[];    // docs/files the next agent should read
  qualityStatus: {
    gatesPassed: string[];
    gatesPending: string[];
    gatesFailed: string[];
  };
}
```

The receiving agent starts immediately from this handoff without re-reading conversation history.

### Escalation path

```
Agent fails → retry once at same tier
Still fails → escalate to next tier (automatic via failure_count)
Tier-1 fails → Supervisor flags for human review with full context
Human provides guidance → Supervisor re-routes with new context
```

---

## Vela-Specific Implementation Notes

### What to wire in code

1. **Mode classifier tool**: Small classification function (or cheap model call to GPT-4o mini) that scores the 4 axes and returns `single | delegated | high_risk`. Runs as the first step in every workflow.

2. **Tier escalation in resolveModel()**: Persist `failure_count` on the task record. When `failure_count >= 2`, bump the tier in `TIER_FALLBACK` lookup before resolving the model. Log the escalation as a task event.

3. **Three Mastra workflows**: `feature-workflow.ts`, `high-risk-workflow.ts`, `debug-workflow.ts` — each encoding the pipeline steps above. Agents are called within workflow steps. Gates are tools called between steps.

4. **Reviewer + Verifier as distinct steps**: The Verifier runs mechanical checks (lint, typecheck, test, build) BEFORE the Reviewer ever sees the code. This keeps Reviewer costs down and catches obvious failures cheaply.

5. **Prompt template injection**: When `createMastraAgent()` builds an Implementer for a task that touches frontend, inject `references/frontend-engineer.md` into the system prompt alongside the base Implementer prompt. Same pattern for all specialist templates.

6. **OpenAI model configs**: Add `openai/gpt-4o-mini` and `openai/gpt-5.4-mini` to model_configs in the DB. Update the router to support OpenAI provider resolution alongside Anthropic and Ollama.

7. **Repo Mapper agent or tool**: Either a lightweight agent (qwen3:8b) that reads the repo and produces a structured implementation map, or a deterministic tool that outputs file tree + dependency hints. The Supervisor uses this output to decompose tasks and assign specialists.

### What to keep from current Vela

- **Budget enforcement** in heartbeat.ts — first-class governance, runs before any agent work.
- **Loop detection** — prevents runaway agent cycles.
- **Approval gating** — human approval for delegations, budget overrides, production changes.
- **SSE event streaming** — live task/heartbeat updates to the UI.
- **Ollama health check + cloud fallback** — operational resilience already implemented in router.ts.
- **Event sourcing** — append-only task_events for full audit trail.

### What changes from current Vela

- **Orchestration moves from heartbeat prompt to Mastra workflows.** The heartbeat still triggers execution, but the execution path is a workflow, not a single agent call with an embedded instruction loop.
- **16 DB agents → 5 runtime agents + prompt templates.** The agent registry in the DB has 5 core agents. Specialist behavior comes from prompt template injection, not 16 separate agent records.
- **Router gains OpenAI provider support + escalation logic.** `resolveModel()` checks `failure_count` and supports `openai/*` model strings.
- **Mode selection happens before agent routing.** The Supervisor's first action is scoring the task and selecting single/delegated/team mode.

---

## Repo Structure (target)

```
/AGENTS.md                                  # Global rules, coding conventions
/docs/agent-playbooks/web.md                # Web stack playbook (Next.js/Supabase)
/docs/agent-playbooks/ios.md                # iOS stack playbook (SwiftUI)
/docs/agent-playbooks/supabase.md           # Supabase-specific patterns
/docs/architecture.md                       # System architecture reference
/docs/definition-of-done.md                 # What "done" means per task type

/src/lib/mastra/
  agents/
    supervisor.ts                           # Supervisor agent definition
    repo-mapper.ts                          # Repo Mapper agent
    implementer.ts                          # Implementer agent (accepts template injection)
    reviewer.ts                             # Reviewer agent
    verifier.ts                             # Verifier agent
  workflows/
    feature-workflow.ts                     # Pipeline A
    high-risk-workflow.ts                   # Pipeline B
    debug-workflow.ts                       # Pipeline C
    steps/
      classify.ts                           # Mode + tier classification step
      repo-map.ts                           # Repo mapping step
      implement.ts                          # Implementation step (handles parallel)
      verify.ts                             # Verification gate step
      review.ts                             # Review step
      synthesize.ts                         # Final synthesis step
      human-approval.ts                     # Approval gate step
  tools/
    run-lint.ts
    run-typecheck.ts
    run-tests.ts
    run-build.ts
    repo-map.ts                             # Deterministic repo tree + deps
    diff-summary.ts
    task-tools.ts                           # create_subtask, update_status, etc.
    project-tools.ts                        # read project context, skills

/src/lib/models/
  router.ts                                 # Tier resolution + escalation + OpenAI support
  providers/
    anthropic.ts
    openai.ts
    ollama.ts
  types.ts

/src/lib/orchestration/
  mode-classifier.ts                        # 4-axis scoring → mode selection
  template-injector.ts                      # Loads specialist prompt templates
  escalation.ts                             # Failure count tracking + tier bumping
```

---

## AGENTS.md Policy Rules

### Global rules

- Always produce a short plan before implementation if the task is non-trivial.
- Prefer minimal changes over broad rewrites.
- Do not change schema, auth, or infrastructure without explicit human approval.
- Run the smallest useful verification first.
- Summarize assumptions, changed files, risks, and verification results in every handoff.

### Web stack rules

- Preserve server/client boundaries in Next.js.
- Keep Supabase RLS explicit and conservative.
- Prefer type-safe database access via Drizzle.
- Do not introduce unnecessary dependencies.

### iOS stack rules

- Prefer native SwiftUI patterns before custom workarounds.
- Keep state ownership clear.
- Respect app capability and entitlement constraints.
- Do not change bundle identifiers, signing, or release settings without approval.

---

## Implementation Priority

### Phase 1 (foundation — do first)

- [ ] Mode classifier tool (`mode-classifier.ts`)
- [ ] Updated `resolveModel()` with failure_count escalation + OpenAI support
- [ ] Supervisor agent definition
- [ ] Implementer agent with template injection
- [ ] Verifier agent (mechanical gates only)
- [ ] Feature workflow (`feature-workflow.ts`)
- [ ] Repo-level `AGENTS.md`

### Phase 2 (depth)

- [ ] Reviewer agent
- [ ] Repo Mapper agent or tool
- [ ] High-risk workflow (`high-risk-workflow.ts`)
- [ ] Debug workflow (`debug-workflow.ts`)
- [ ] Human approval gates wired into workflows
- [ ] OpenAI model configs in DB (GPT-4o mini, GPT-5.4 mini)
- [ ] Stack playbooks (`/docs/agent-playbooks/`)

### Phase 3 (optimization)

- [ ] Security-specific review template (from security-auditor.md)
- [ ] Performance review template (from performance-engineer.md)
- [ ] Eval datasets for routing quality
- [ ] Routing scorecards (track tier usage, escalation frequency, cost per task)
- [ ] Automatic model escalation tuning based on failure patterns

---

## Sources

- [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) — OpenAI, Feb 2026
- [Common workflow patterns for AI agents](https://www.claude.com/blog/common-workflow-patterns-for-ai-agents-and-when-to-use-them) — Anthropic, Mar 2026
- [Building effective agents](https://www.anthropic.com/research/building-effective-agents) — Anthropic, 2025
- [Orchestrator-Workers Cookbook](https://platform.claude.com/cookbook/patterns-agents-orchestrator-workers) — Anthropic
- [Best practices for coding with agents](https://www.cursor.com/blog/agent-best-practices) — Cursor, 2026
- [Cursor Subagents](https://cursor.com/docs/agent/subagents) — Cursor Docs
