# Harness Engineering & Agent Orchestration

> "Building software still demands discipline, but the discipline shows up more in the scaffolding rather than the code."
> -- Ryan Lopopolo, OpenAI (Feb 2026)

## What Is Harness Engineering?

Harness engineering is the discipline of designing the **infrastructure that surrounds an AI agent** -- everything between the user's request and the agent's output that is not the language model itself. The term was formalized by OpenAI in February 2026 when their team shipped a production product containing ~1M lines of code with zero manually-written source code, built by three engineers averaging 3.5 PRs/person/day using Codex agents.

The core insight: **humans steer, agents execute.** The engineer's job shifts from writing code to designing environments, specifying intent, and building feedback loops that allow agents to do reliable work. When something fails, the fix is almost never "try harder" -- it is always "what capability is missing, and how do I make it both legible and enforceable for the agent?"

**Sources:**
- [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) -- OpenAI, Feb 2026
- [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/) -- OpenAI, Feb 2026
- [Build the harness, not the code](https://vitthalmirji.com/2026/02/build-the-harness-not-the-code-a-staff/principal-engineers-guide-to-ai-agent-systems/) -- Vitthal Mirji, Feb 2026

---

## The Five Pillars

| Pillar | What It Does | OpenAI's Implementation |
|--------|-------------|------------------------|
| **Context Engineering** | Assembles the right information at the right time. AGENTS.md as a table of contents, not an encyclopedia. Progressive disclosure: agents start with a small, stable entry point and are taught where to look next. | Structured `docs/` directory as system of record. Short AGENTS.md (~100 lines) as a map with pointers. Design docs, exec plans, product specs, and references all versioned in-repo. |
| **Tool Orchestration** | Gives agents structured capabilities. Agents use standard dev tools directly -- `gh`, local scripts, repository-embedded skills. | Chrome DevTools Protocol for UI testing. Local observability stack (LogQL, PromQL). Per-worktree app instances for isolated validation. |
| **Verification Loops** | Validates agent output mechanically before acceptance. Custom linters, structural tests, and agent-to-agent review. | Custom linters enforce architecture boundaries (Types -> Config -> Repo -> Service -> Runtime -> UI). Agents review their own PRs, request additional agent reviews, iterate until all reviewers are satisfied. |
| **Cost & Budget Management** | Controls spend and prevents runaway consumption. Route by task complexity, not by habit. | Model tier routing. Agents restricted to operate within specific dependency layers. Short-lived PRs with minimal blocking merge gates. |
| **Observability & Evaluation** | Measures what agents produce so the system improves. Logs, metrics, traces exposed directly to agents. | Quality scoring per domain. Recurring "doc-gardening" agent scans for stale documentation. "Garbage collection" agents open targeted refactoring PRs on a regular cadence. |

**Key lesson from OpenAI:** They tried the "one big AGENTS.md" approach. It failed predictably -- context is scarce, too much guidance becomes non-guidance, it rots instantly, and it is hard to verify mechanically. The fix: treat AGENTS.md as a table of contents and push depth into structured, versioned, cross-linked docs that can be validated by CI.

---

## Agent Orchestration Patterns

Three sources converge on the same core patterns:

| Pattern | Description | When to Use | Source |
|---------|------------|-------------|--------|
| **Sequential / Pipeline** | Fixed stage order: plan, implement, review, test. Each step depends on the previous output. | Multi-stage processes with clear dependencies. Default starting point. | Anthropic, "Common workflow patterns for AI agents" (Mar 2026) |
| **Parallel / Fan-Out-Fan-In** | Multiple agents work simultaneously on independent subtasks, results aggregated. | Speed-critical work with naturally parallel subtasks. Multi-dimension evaluation. | Anthropic; Cursor subagents (Explore, Bash, Browser run in parallel) |
| **Evaluator-Optimizer** | Generator + evaluator in an iterative loop until quality threshold is met. | Code generation with specific standards, professional communications, anywhere first-draft quality falls short. | Anthropic |
| **Orchestrator-Workers (Hub-and-Spoke)** | Central orchestrator dynamically delegates to specialists based on task analysis. | Complex tasks where subtasks cannot be predicted in advance. Most software projects. | Anthropic Cookbook; Cursor's main agent + subagent model |
| **Router / Triage** | Lightweight classifier routes to the right specialist without managing execution. | High task diversity, cost control, fast dispatch. Use cheap models for the router. | Industry consensus (ToolHalla, Zylos Research, 2026 guides) |

**Anthropic's guidance:** "Start with the simplest pattern that solves your problem. Default to sequential. Move to parallel when latency is the bottleneck. Add evaluator-optimizer loops only when you can measure the quality improvement."

**Cursor's implementation:** Subagents (shipped Cursor 2.4) run in parallel with isolated context windows. Built-in types: Explore (codebase navigation), Bash (shell commands), Browser (DOM analysis). Custom subagents defined as markdown files in `.cursor/agents/`. Best-of-N runs parallel agents across different models to select the best result.

**Sources:**
- [Common workflow patterns for AI agents](https://www.claude.com/blog/common-workflow-patterns-for-ai-agents-and-when-to-use-them) -- Anthropic, Mar 2026
- [Orchestrator-Workers Cookbook](https://platform.claude.com/cookbook/patterns-agents-orchestrator-workers) -- Anthropic
- [Cursor Subagents](https://cursor.com/docs/agent/subagents) -- Cursor Docs
- [Best practices for coding with agents](https://www.cursor.com/blog/agent-best-practices) -- Cursor

---

## Model Routing Strategy

Not every task needs the most capable model. Route by task complexity, not by habit.

| Tier | Capability Level | Use For | Escalation Signal |
|------|-----------------|---------|-------------------|
| **Tier-1 (Capable)** | Deep reasoning, multi-file analysis, architectural judgment, security awareness | Architecture decisions, security audits, complex debugging, system design, critical code review, orchestration | Task involves cross-cutting concerns, security, or novel architecture |
| **Tier-2 (Balanced)** | Solid implementation, good pattern recognition, reliable execution | Feature implementation, standard code review, test writing, refactoring, API development, database work | Default for implementation tasks |
| **Tier-3 (Fast)** | Quick transforms, simple generation, classification | Triage, boilerplate, formatting, simple docs, commit messages, linting fixes, file scaffolding | Task is mechanical or repetitive |

**Routing heuristic:** Start with the cheapest tier that could succeed. Escalate on failure or when the task touches security, architecture, or cross-cutting concerns. The router itself should be cheap -- rules, keywords, and confidence thresholds, not another heavy model call.

---

## Practical Application: The Agentic Coding Workflow

```
Task arrives
    |
    v
Orchestrator (Tier-1, always active)
    |-- Classifies: domain, complexity, project phase
    |-- Selects: model tier, specialist agent
    |-- Loads: relevant context (progressive disclosure)
    |
    v
Specialist Agent (assigned tier)
    |-- Receives: task + scoped context + tools
    |-- Executes: using file ops, shell, search, APIs
    |-- Produces: code, tests, analysis, design
    |
    v
Quality Gate (mechanical, not opinion-based)
    |-- Build passes? Types check? Tests pass?
    |-- Linter clean? Architecture boundaries respected?
    |-- Review agent approves? (evaluator-optimizer loop)
    |
    |-- PASS --> Handoff to next agent or complete
    |-- FAIL --> Escalate tier, reassign, or flag for human
```

### Operating Principles

1. **Give agents a map, not a manual.** Short index file with pointers to structured docs. Progressive disclosure beats front-loading.
2. **Enforce architecture mechanically.** Custom linters, structural tests, and CI validation -- not prose guidelines. "Encode the invariant, not the instruction."
3. **One task, one owner.** Each task has a single responsible agent. Collaboration happens through structured handoffs, not shared execution.
4. **Gates before progress.** No task moves forward without passing its quality gate. This is where reliability comes from.
5. **Escalate, don't retry blindly.** If a tier-2 agent fails twice, escalate to tier-1. Don't burn tokens on repeated attempts at the same capability level.
6. **Cost is a feature.** The cheapest successful path is the best path. Tier-1 for everything is a budget failure, not a quality strategy.
7. **Treat technical debt like a high-interest loan.** Continuous small cleanups (garbage collection agents) beat painful quarterly rewrites.
8. **Repository as system of record.** If it is not in the repo, it does not exist for the agent. Slack discussions, meeting notes, and tribal knowledge must be captured as versioned artifacts.

---

## Further Reading

| Resource | Author | Date | Focus |
|----------|--------|------|-------|
| [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) | Ryan Lopopolo, OpenAI | Feb 2026 | Origin of harness engineering, 0-code experiment, operational patterns |
| [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/) | Celia Chen, OpenAI | Feb 2026 | Codex App Server architecture, JSON-RPC protocol, integration patterns |
| [Common workflow patterns for AI agents](https://www.claude.com/blog/common-workflow-patterns-for-ai-agents-and-when-to-use-them) | Anthropic | Mar 2026 | Sequential, parallel, evaluator-optimizer patterns with tradeoffs |
| [Building effective agents](https://www.anthropic.com/research/building-effective-agents) | Anthropic | 2025 | Foundational agent design principles |
| [Orchestrator-Workers Cookbook](https://platform.claude.com/cookbook/patterns-agents-orchestrator-workers) | Anthropic | 2025 | Hub-and-spoke implementation patterns |
| [Build the harness, not the code](https://vitthalmirji.com/2026/02/build-the-harness-not-the-code-a-staff/principal-engineers-guide-to-ai-agent-systems/) | Vitthal Mirji | Feb 2026 | Staff engineer's operational guide, tool-agnostic patterns |
| [Best practices for coding with agents](https://www.cursor.com/blog/agent-best-practices) | Cursor | 2026 | Planning-first approach, model tuning, context management |
| [Cursor Subagents](https://cursor.com/docs/agent/subagents) | Cursor | 2026 | Parallel subagent architecture, best-of-N patterns |
| [Context Engineering: Complete Guide](https://dev.to/vibehackers/context-engineering-the-complete-guide-for-ai-assisted-coding-2026-13m6) | DEV Community | 2026 | Evolution from prompt engineering to context engineering |
