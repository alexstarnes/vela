# Agentic Harness Blueprint for Mastra

## Core recommendation

Use a **dynamic supervisor + specialist workers** pattern, not a permanent PM/CTO/engineer hierarchy.

### Why

- Most app work is only partially parallelizable.
- Extra hierarchy adds token cost and coordination overhead.
- Strong harness design beats fancy org charts.
- Your stacks (Next.js/Supabase/Railway and SwiftUI) benefit more from reusable specialists than from executive-style roles.

---

## System shape

### 1) Human

Owns:

- product direction
- architecture sign-off
- security-sensitive decisions
- schema / migration approvals
- deployment approvals for production

### 2) Supervisor agent

Owns:

- task intake
- plan generation
- deciding whether to stay single-agent or delegate
- assigning the right tier/model
- enforcing verification gates
- synthesizing final output

### 3) Specialist agents

#### Always-available core specialists

- **Repo Mapper** — reads repo, finds files, traces dependencies, builds task map
- **Implementer** — writes or edits code for the task
- **Reviewer** — checks correctness, edge cases, code quality, missing tests
- **Verifier** — runs lint, tests, typecheck, build, and reports failures cleanly

#### Web stack specialists

- **Frontend Web Agent** — React / Next.js UI, routing, components, client/server boundaries
- **Supabase Agent** — schema, migrations, auth, RLS, storage, edge functions
- **Railway / Infra Agent** — env vars, deploy config, runtime issues, CI/CD sanity

#### iOS specialists

- **SwiftUI Agent** — views, navigation, state, design system consistency
- **Apple Platform Agent** — entitlements, capabilities, build settings, TestFlight/App Store issues
- **API Integration Agent** — networking, decoding, async flows, backend integration

#### Optional specialists

- **Security Agent** — auth, secrets, permissions, dependency risk, insecure flows
- **UX Consistency Agent** — interaction quality, copy clarity, component consistency
- **Performance Agent** — bundle/runtime/build/perf regressions

---

## Model allocation policy

You already use model tiers: **fast**, **standard**, **premium**. Keep that. Do not bind a single model permanently to a single role. Instead, route by **task difficulty + failure cost + context load**.

### Updated model pool

#### Local models

- **qwen3:8b** — cheapest local utility model for scanning, summarization, and low-risk tasks
- **qwen3\:coder-next****:Q4\_K\_M** — default local coding model for routine implementation and refactors

#### Cloud budget models

- **GPT-4o mini** — fast, cheap cloud model for routing help, structured extraction, log triage, lightweight review, and fallback utility work
- **GPT-5.4 mini** — stronger mini model for coding, tool use, subagents, and harder mid-tier tasks where Claude would be overkill

#### Premium models

- **Claude Haiku 4.5** — lightweight premium-ish cloud option when you want stronger reasoning than local models without jumping straight to Sonnet
- **Claude Sonnet 4.5** — default premium model for planning, high-value review, architecture, and difficult debugging
- **Claude Opus 4.6** — reserve for the hardest planning, architecture, security, and final judgment tasks only

### Tier definitions

#### Fast tier

Use for:

- repo scanning
- file lookup
- formatting tasks
- simple refactors
- summarization of logs / compiler output
- deterministic routing support
- cheap second-opinion passes on small changes

Good candidates:

- qwen3:8b
- GPT-4o mini

#### Standard tier

Use for:

- normal feature work
- debugging with a few hypotheses
- moderate cross-file edits
- React / Next / SwiftUI implementation with clear requirements
- review passes on routine work
- parallel worker agents on bounded subtasks

Good candidates:

- qwen3\:coder-next\:Q4\_K\_M
- GPT-5.4 mini
- Claude Haiku 4.5 when you want better judgment than the cheaper pool

#### Premium tier

Use for:

- architecture decisions
- multi-step planning
- ambiguous debugging
- security review
- schema / auth / RLS design
- large refactors
- final synthesis for complex work
- work that spans backend + frontend + deployment

Good candidates:

- Claude Sonnet 4.5 as default premium worker
- Claude Opus 4.6 for the hardest planning / architecture / review tasks only

### Routing rules

1. **Start as low as possible**.
2. **Escalate when confidence drops**.
3. **Use premium mainly for planning, architecture, and final review**.
4. **Do not waste premium on rote edits or file discovery**.
5. **Prefer standard over premium for most actual code writing once the plan is clear**.
6. **Use GPT-4o mini as a cloud utility layer before escalating to Claude**.
7. **Use GPT-5.4 mini as the default cloud coding/subagent model before Sonnet**.

### Practical routing matrix

- Repo discovery → qwen3:8b or GPT-4o mini
- Simple UI tweak → qwen3\:coder-next or GPT-5.4 mini
- New feature in one layer → qwen3\:coder-next or GPT-5.4 mini
- Feature across UI + backend → Supervisor on Sonnet, workers on qwen3\:coder-next / GPT-5.4 mini
- Auth / security / payments / RLS → Sonnet review mandatory, Opus optional for highest-risk work
- Production incident triage → Supervisor on Sonnet, parallel diagnostics on GPT-5.4 mini / Haiku / qwen3\:coder-next
- Large migration / refactor → Sonnet planning, qwen3\:coder-next / GPT-5.4 mini implementation, Sonnet review
- Structured extraction / routing / log cleanup → GPT-4o mini

### Practical recommendation for your pool

Yes — **adding GPT-5.4 mini and GPT-4o mini is a good move**.

Best use:

- **GPT-4o mini** becomes your cheap cloud utility model
- **GPT-5.4 mini** becomes your primary non-Claude cloud worker for coding and delegation
- **Claude Sonnet** stays reserved for planning, hard debugging, architecture, and review
- **Claude Opus** stays rare and intentional

That gives you a much better cost ladder than jumping from local Qwen models straight to Claude.

## When to use single-agent vs delegated mode

### Single-agent mode

Use when the task is:

- under \~3 files
- mostly sequential
- low-risk
- easy to verify

Pattern:

- Supervisor handles the work directly
- Reviewer or Verifier runs afterward

### Delegated mode

Use when the task is:

- cross-cutting
- parallelizable
- ambiguous
- high-risk
- likely to benefit from separate context windows

Pattern:

- Supervisor plans
- Repo Mapper maps affected areas
- 1–3 specialists execute in parallel
- Reviewer compares outputs
- Verifier runs checks
- Supervisor synthesizes final result

### Team mode (rare)

Use only for:

- large greenfield builds
- major migrations
- architecture-heavy multi-stream work
- thorny debugging where multiple independent hypotheses should be explored

Keep team mode time-boxed and heavily verified.

---

## Harness design rules

### Feedforward controls

These prevent bad outputs before generation:

- repo-level `AGENTS.md`
- stack playbooks (`/docs/agent-playbooks/web.md`, `/docs/agent-playbooks/ios.md`)
- architecture notes
- coding conventions
- file ownership / module boundary rules
- migration rules
- explicit “definition of done”

### Feedback controls

These catch and correct issues after generation:

- lint
- typecheck
- tests
- build
- simulator / preview / app launch checks
- schema validation
- security scan
- review agent
- human approval for risky actions

### Left-shifted quality gates

Run cheapest and most deterministic checks earliest:

1. format / lint
2. typecheck
3. narrow tests
4. targeted build
5. reviewer agent
6. broader integration tests
7. deploy checks
8. human approval

---

## Recommended execution pipeline in Mastra

### Pattern A: Default feature workflow

1. Intake step
2. Classify task (scope, risk, stacks affected)
3. Choose single-agent or delegated mode
4. Build plan
5. Run repo mapping if needed
6. Implement
7. Verify
8. Review
9. Summarize changes, risks, and next actions

### Pattern B: High-risk workflow

1. Intake
2. Risk classification
3. Premium planning
4. Request explicit approval if schema/auth/prod changes
5. Implement with specialists
6. Verification gates
7. Premium review
8. Deployment readiness summary

### Pattern C: Debug workflow

1. Intake logs / symptoms
2. Generate ranked hypotheses
3. Assign parallel diagnostic workers
4. Gather evidence
5. Pick most likely root cause
6. Patch
7. Regression checks
8. Summary with cause/fix/prevention

---

## Mastra implementation guidance

### Use agents for

- open-ended reasoning
- planning
- diagnosing
- code review
- synthesis

### Use workflows for

- deterministic orchestration
- branching logic
- approval gates
- parallel fan-out / fan-in
- retries and state transitions
- verification sequences

### Architectural recommendation

- Build a **Supervisor Agent** as the entry point.
- Put repeatable orchestration in **Mastra Workflows**.
- Treat specialist agents as callable units inside workflow steps.
- Put deterministic operations into **tools**, not agent prompts.

### Good separation of responsibilities

- **Agent** decides
- **Workflow** orchestrates
- **Tool** executes deterministic logic

---

## Suggested agent roster

### 1. SupervisorAgent

Responsibilities:

- classify request
- decide routing mode
- assign tier/model
- generate execution plan
- collect and synthesize results

Default model:

- Claude Sonnet 4.5 Fallbacks:
- GPT-5.4 mini for medium-complexity supervised runs when budget matters
- Claude Opus 4.6 for hardest planning
- qwen3\:coder-next for simpler scoped tasks

### 2. RepoMapperAgent

Responsibilities:

- inspect repo structure
- identify affected files/modules
- surface dependencies and risks
- produce implementation map

Default model:

- qwen3:8b Escalate to:
- GPT-4o mini for better structured summaries
- qwen3\:coder-next when code reasoning matters more

### 3. ImplementerAgent

Responsibilities:

- make code changes
- keep within plan
- note assumptions and unresolved risks

Default model:

- qwen3\:coder-next\:Q4\_K\_M Escalate to:
- GPT-5.4 mini for harder bounded implementation
- Claude Sonnet 4.5 for ambiguous refactors or tricky architecture-sensitive code

### 4. ReviewerAgent

Responsibilities:

- inspect diffs
- identify edge cases
- detect overengineering / regressions
- confirm plan adherence

Default model:

- GPT-5.4 mini for routine review Escalate to:
- Claude Sonnet 4.5 for high-value review
- Claude Opus 4.6 for architecture/security review

### 5. VerifierAgent

Responsibilities:

- run or request checks
- summarize failing tests / logs
- turn failures into actionable feedback

Default model:

- qwen3:8b or GPT-4o mini for log summarization Escalate to:
- GPT-5.4 mini, Claude Haiku 4.5, or Sonnet 4.5 for tricky failure diagnosis

### 6. Stack specialists

- FrontendWebAgent → qwen3\:coder-next or GPT-5.4 mini; Sonnet 4.5 for harder interaction architecture
- SupabaseAgent → GPT-5.4 mini by default; Sonnet 4.5 for RLS/auth/schema-sensitive work
- RailwayAgent → GPT-4o mini or Haiku 4.5 for operational triage; Sonnet 4.5 for ambiguous infra issues
- SwiftUIAgent → qwen3\:coder-next for implementation, GPT-5.4 mini for harder flows, Sonnet 4.5 for architectural issues
- ApplePlatformAgent → GPT-5.4 mini or Sonnet 4.5 depending on signing/release risk
- SecurityAgent → Sonnet 4.5 or Opus 4.6 only

---

## Suggested task-classification rubric

Score each request on 4 axes from 0–2:

- **Ambiguity**
- **Blast radius**
- **Cross-stack complexity**
- **Verification difficulty**

### Total score interpretation

- **0–2** → Single-agent, Fast or Standard
- **3–5** → Single-agent with Reviewer, Standard
- **6–7** → Delegated workflow, Premium supervisor + Standard workers
- **8+** → High-risk workflow, Premium planning + review mandatory

---

## Repo file structure recommendation

```text
/AGENTS.md
/docs/agent-playbooks/web.md
/docs/agent-playbooks/ios.md
/docs/agent-playbooks/supabase.md
/docs/architecture.md
/docs/definition-of-done.md
/mastra/agents/supervisor.ts
/mastra/agents/repo-mapper.ts
/mastra/agents/implementer.ts
/mastra/agents/reviewer.ts
/mastra/agents/verifier.ts
/mastra/agents/specialists/frontend-web.ts
/mastra/agents/specialists/supabase.ts
/mastra/agents/specialists/swiftui.ts
/mastra/workflows/feature-workflow.ts
/mastra/workflows/debug-workflow.ts
/mastra/workflows/high-risk-workflow.ts
/mastra/tools/run-tests.ts
/mastra/tools/run-typecheck.ts
/mastra/tools/run-build.ts
/mastra/tools/repo-map.ts
/mastra/tools/diff-summary.ts
```

---

## Example policy rules for `AGENTS.md`

### Global rules

- Always produce a short plan before implementation if the task is non-trivial.
- Prefer minimal changes over broad rewrites.
- Do not change schema, auth, or infrastructure without explicit approval.
- Run the smallest useful verification first.
- Summarize assumptions, changed files, risks, and verification results.

### Web rules

- Preserve server/client boundaries in Next.js.
- Keep Supabase RLS explicit and conservative.
- Prefer type-safe database access.
- Do not introduce unnecessary dependencies.

### iOS rules

- Prefer native SwiftUI patterns before custom workarounds.
- Keep state ownership clear.
- Respect app capability and entitlement constraints.
- Do not change bundle identifiers, signing, or release settings without approval.

---

## What I would actually deploy first

### Phase 1

- SupervisorAgent
- ImplementerAgent
- ReviewerAgent
- VerifierAgent
- FeatureWorkflow
- DebugWorkflow
- Tier-based model router
- Repo-level `AGENTS.md`

### Phase 2

- RepoMapperAgent
- SupabaseAgent
- SwiftUIAgent
- RailwayAgent
- HighRiskWorkflow
- approval gates for migrations / auth / deploys

### Phase 3

- SecurityAgent
- UX Consistency Agent
- Performance Agent
- eval datasets and routing scorecards
- automatic model escalation based on failure patterns

---

## Final recommendation

For your setup, the best baseline is:

**Mastra workflow orchestration + one premium supervisor + mostly standard workers + fast utility/repo agents + hard verification gates.**

That will be cheaper, easier to maintain, and more reliable than a permanent PM/CTO hierarchy.

The whole point is to make the system feel smarter through better routing and stronger checks, not through more titles.

