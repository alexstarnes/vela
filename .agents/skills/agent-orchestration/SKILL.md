---
name: agent-orchestration
description: >
  Agent orchestration skill for multi-agent software development. Defines 16 specialist agent roles
  across 5 domains (product, architecture, implementation, quality, operations) with model tier routing,
  phase-based activation, quality gates, and structured handoff protocols. Use when assigning agents to
  tasks, selecting models for agent work, orchestrating multi-agent workflows, routing coding tasks to
  specialists, or building software products from 0-to-1 and beyond. Triggers: agent assignment, task
  routing, model selection, orchestration, code review, architecture, security audit, QA, deployment,
  multi-agent, subagent, harness engineering, agent-forward development.
license: Apache-2.0
metadata:
  author: starnescreative
  version: 1.0.0
---

# Agent Orchestration

A harness-first orchestration system for multi-agent software development. This skill defines **who** does **what** work, at **which** model tier, during **which** project phase -- and how agents hand off, escalate, and verify their work.

Grounded in harness engineering principles from OpenAI (Feb 2026), Anthropic's workflow patterns (Mar 2026), and Cursor's subagent architecture.

## Philosophy

The model is 15-20% of system quality. The harness is the other 80%.

1. **Harness-first.** Design the infrastructure around the agent -- context, tools, verification, cost controls, observability -- before optimizing the model.
2. **Verification-driven.** Every task passes a mechanical quality gate before it moves forward. Gates are code (linters, tests, type checks), not opinions.
3. **Cost-aware.** Route by task complexity. The cheapest successful path is the best path. Tier-1 for everything is a budget failure.
4. **Progressive disclosure.** Give agents a map, not a manual. Short index with pointers to structured docs. Load context on demand, not up front.
5. **Repository as system of record.** If it is not in the repo, it does not exist for the agent.

## Model Tier System

Three tiers mapped to generic capability levels. Not provider-specific -- map to your provider's model lineup.

| Tier | Capability | Route Here When | Examples of Work |
|------|-----------|----------------|-----------------|
| **Tier-1 (Premium)** | Deep reasoning, multi-file analysis, architectural judgment, security awareness | Cross-cutting concerns, novel architecture, security, orchestration decisions, complex debugging | System design, security audits, critical code review, architecture decisions, agent routing |
| **Tier-2 (Standard)** | Solid implementation, good pattern recognition, reliable execution | Standard implementation, moderate complexity, well-defined tasks with clear patterns | Feature implementation, API development, test writing, refactoring, database work, standard code review |
| **Tier-3 (Fast)** | Quick transforms, simple generation, classification, mechanical tasks | Repetitive, mechanical, or template-driven work with low risk | Triage, boilerplate, formatting, simple docs, commit messages, linting fixes, file scaffolding |

**Routing heuristic:** Start with the cheapest tier that could succeed. Escalate on failure or when the task touches security, architecture, or cross-cutting concerns. The router itself should be cheap.

**Escalation rules:**
- Tier-3 fails twice on the same task -> escalate to Tier-2
- Tier-2 fails twice on the same task -> escalate to Tier-1
- Tier-1 fails -> flag for human review with full context
- Any task involving security, auth, or payments -> minimum Tier-1

## Project Phases

Four phases with clear entry/exit criteria. Agents activate and deactivate based on phase.

### Discovery/Planning
**Entry:** New project, new major feature, or strategic pivot.
**Work:** Requirements gathering, architecture decisions, tech selection, project structure, design specs, competitive analysis, user research synthesis.
**Exit:** Approved architecture doc, defined scope, selected tech stack, initial project structure.
**Active domains:** Product & Strategy, Architecture & Planning.

### 0-to-1 Build
**Entry:** Approved architecture and scope. Initial project structure exists.
**Work:** Core feature implementation, foundational patterns, database schema, auth, CI/CD setup, initial test coverage, design system foundations.
**Exit:** Core features working end-to-end. Build passes. Tests pass. Deployable artifact exists.
**Active domains:** All domains active. Heaviest implementation phase.

### Scaling
**Entry:** Core product works. Users exist. Growth or feature expansion needed.
**Work:** Feature expansion, performance optimization, hardening, monitoring, advanced UI, API versioning, caching, load handling, accessibility hardening.
**Exit:** Product handles target scale. Performance budgets met. Monitoring in place.
**Active domains:** All domains active. Quality & Security and Operations increase in importance.

### Maintenance
**Entry:** Product is stable and in production.
**Work:** Bug fixes, dependency upgrades, tech debt reduction, incident response, monitoring improvements, documentation updates, security patches.
**Exit:** Ongoing (or transition to new major version -> back to Discovery).
**Active domains:** Quality & Security, Operations & Support, Architecture (for tech debt). Implementation as needed.

## Agent Roster Matrix

16 specialist agents across 5 domains + 1 meta-agent (Orchestrator).

### Domain x Phase Activation

| Agent | Domain | Tier | Discovery | 0-to-1 | Scaling | Maintenance |
|-------|--------|------|-----------|---------|---------|-------------|
| **Orchestrator** | Meta | 1 | Active | Active | Active | Active |
| Product Strategist | Product & Strategy | 1 | Active | -- | Active | -- |
| UX Designer | Product & Strategy | 1 | Active | Active | Active | -- |
| Architect | Architecture & Planning | 1 | Active | Active | Active | -- |
| Database Engineer | Architecture & Planning | 1/2 | -- | Active | Active | Active |
| Frontend Engineer | Implementation | 2 | -- | Active | Active | -- |
| Backend Engineer | Implementation | 2 | -- | Active | Active | -- |
| Fullstack Implementer | Implementation | 2 | -- | Active | Active | -- |
| AI/Agent Engineer | Implementation | 1 | -- | Active | Active | -- |
| Code Reviewer | Quality & Security | 1 | Active | Active | Active | Active |
| QA Engineer | Quality & Security | 2 | -- | Active | Active | Active |
| Security Auditor | Quality & Security | 1 | -- | Active | Active | Active |
| Performance Engineer | Quality & Security | 2 | -- | -- | Active | Active |
| DevOps Engineer | Operations & Support | 2 | -- | Active | Active | Active |
| Technical Writer | Operations & Support | 3 | Active | Active | Active | Active |
| Data Analyst | Operations & Support | 2 | -- | -- | Active | Active |

### Agent Selection Decision Tree

```
1. What domain does this task belong to?
   -> Product/strategy, architecture, implementation, quality, or operations

2. What phase is the project in?
   -> Filter to agents active in that phase

3. What is the task complexity?
   -> Routine (Tier-3), moderate (Tier-2), complex/critical (Tier-1)

4. Does the task touch security, auth, or payments?
   -> YES: minimum Tier-1, involve Security Auditor

5. Does the task cross domain boundaries?
   -> YES: route through Orchestrator for decomposition

6. Select the most specific agent that matches.
   -> Prefer specialists over generalists (Backend Engineer over Fullstack for pure API work)
```

## Model-Agent Access Matrix

Which models each agent can use at runtime. **default** = the model assigned at creation. The orchestrator switches to other allowed models based on task complexity, cost, or availability.

| Agent | Opus 4.6 | Sonnet 4.5 | Composer 2 | Coder-Next (local) | Haiku 4.5 | Qwen3 8B (local) |
|-------|:--------:|:----------:|:----------:|:-------------------:|:---------:|:-----------------:|
| Orchestrator | **default** | | | | | |
| Product Strategist | **default** | ✓ | | | | |
| UX Designer | **default** | ✓ | | | | |
| Architect | **default** | | | | | |
| Database Engineer | ✓ | **default** | | | | |
| Frontend Engineer | | **default** | ✓ | ✓ | | |
| Backend Engineer | | **default** | ✓ | ✓ | | |
| Fullstack Implementer | | **default** | ✓ | ✓ | | |
| AI/Agent Engineer | **default** | ✓ | | | | |
| Code Reviewer | **default** | ✓ | | | | |
| QA Engineer | | **default** | ✓ | | | |
| Security Auditor | **default** | | | | | |
| Performance Engineer | | **default** | | | | |
| DevOps Engineer | | **default** | | | | |
| Technical Writer | | | | | **default** | ✓ |
| Data Analyst | | **default** | | | | |

**Constraints:**
- **Composer 2** — Coding-focused. Restricted to implementation and QA agents that primarily produce code.
- **Qwen3-Coder-Next** — Local coding model. Same restrictions as Composer 2; use for zero-cost iteration loops.
- **Qwen3 8B** — Lightweight local model. Only for fast-tier mechanical tasks (docs, triage, formatting).
- **Opus 4.6** — Reserve for tasks requiring deep reasoning, security, or architectural judgment.

## Orchestration Workflow

```
Task Received
    |
    v
Orchestrator (Tier-1, always active)
    |-- Classify: domain, complexity, phase
    |-- Select: model tier + specialist agent
    |-- Load: relevant context via progressive disclosure
    |-- Decompose: break cross-domain tasks into subtasks
    |
    v
Specialist Agent (assigned tier)
    |-- Receive: task + scoped context + available tools
    |-- Execute: using file ops, shell, search, APIs
    |-- Produce: code, tests, analysis, design artifacts
    |
    v
Quality Gate (mechanical verification)
    |-- Build passes?
    |-- Types check?
    |-- Tests pass?
    |-- Linter clean?
    |-- Architecture boundaries respected?
    |-- Review agent approves? (evaluator-optimizer loop if needed)
    |
    |-- PASS -> Handoff to next agent or mark complete
    |-- FAIL -> Escalate tier, reassign agent, or flag for human review
```

### Parallel Execution

When the Orchestrator decomposes a task into independent subtasks, it may fan out to multiple specialists simultaneously:

- Frontend + Backend can work in parallel when interface contracts are defined
- QA can begin test planning while implementation is in progress
- Technical Writer can draft docs while code review happens
- Security Auditor can scan while QA runs functional tests

Fan-in happens at the Orchestrator, which aggregates results and runs the final quality gate.

## Handoff Protocol

When an agent passes work to another agent, it must provide structured state:

1. **What was done** -- summary of completed work with file paths
2. **What remains** -- explicit list of remaining tasks
3. **What failed** -- any errors, blocked items, or concerns
4. **Context pointers** -- which docs, files, or artifacts the next agent should read
5. **Quality status** -- which gates passed, which are pending

Handoffs are structured data, not prose. The receiving agent should be able to start immediately without re-reading the entire conversation history.

### Escalation Path

```
Agent fails -> Retry once at same tier
Still fails -> Escalate to next tier
Tier-1 fails -> Orchestrator flags for human review
Human provides guidance -> Orchestrator re-routes with new context
```

## Reference Doc Routing Table

Load the reference doc for a role when that agent is activated. Each doc contains the agent's full system prompt, capabilities, tools, example tasks, anti-patterns, escalation rules, and collaboration map.

| Task Type | Load This Reference | Agent |
|-----------|-------------------|-------|
| Task routing, agent selection, phase management | [orchestrator.md](references/orchestrator.md) | Orchestrator |
| Requirements, user stories, prioritization, acceptance criteria | [product-strategist.md](references/product-strategist.md) | Product Strategist |
| UI/UX design, design systems, wireframes, accessibility | [ux-designer.md](references/ux-designer.md) | UX Designer |
| System design, API design, tech decisions, dependency planning | [architect.md](references/architect.md) | Architect |
| Schema design, migrations, query optimization, data modeling | [database-engineer.md](references/database-engineer.md) | Database Engineer |
| UI components, state management, styling, client-side logic | [frontend-engineer.md](references/frontend-engineer.md) | Frontend Engineer |
| APIs, business logic, server-side integrations, auth flows | [backend-engineer.md](references/backend-engineer.md) | Backend Engineer |
| Cross-stack features, full vertical slices | [fullstack-implementer.md](references/fullstack-implementer.md) | Fullstack Implementer |
| Agent implementation, prompt engineering, tools, RAG, MCP | [ai-engineer.md](references/ai-engineer.md) | AI/Agent Engineer |
| Code correctness, patterns, maintainability, style | [code-reviewer.md](references/code-reviewer.md) | Code Reviewer |
| Test strategy, test writing, coverage analysis, automation | [qa-engineer.md](references/qa-engineer.md) | QA Engineer |
| Vulnerabilities, auth patterns, secrets, dependency audits | [security-auditor.md](references/security-auditor.md) | Security Auditor |
| Profiling, optimization, bundle analysis, load testing | [performance-engineer.md](references/performance-engineer.md) | Performance Engineer |
| CI/CD, deployment, containers, monitoring, infrastructure | [devops-engineer.md](references/devops-engineer.md) | DevOps Engineer |
| Technical docs, API docs, user guides, changelogs | [technical-writer.md](references/technical-writer.md) | Technical Writer |
| Data pipelines, analytics, metrics, dashboards | [data-analyst.md](references/data-analyst.md) | Data Analyst |

## Quality Gate Definitions

### Minimum Gates (all tasks)
- Build compiles without errors
- TypeScript strict mode passes (or language-equivalent type checking)
- No new linter violations introduced

### Implementation Gates (code changes)
- All existing tests pass
- New code has test coverage for critical paths
- No hardcoded secrets or credentials
- File size limits respected
- Import boundaries respected (no circular dependencies)

### Architecture Gates (structural changes)
- Dependency direction validated (no upward dependencies)
- API contracts match documented schemas
- Database migrations are reversible
- No new external dependencies without justification

### Security Gates (auth, data, payments)
- Input validation at all boundaries
- Authentication and authorization checks present
- No SQL injection, XSS, or CSRF vulnerabilities
- Secrets use environment variables, never hardcoded
- Dependencies scanned for known vulnerabilities

## Sources & Further Reading

- [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) -- OpenAI, Feb 2026
- [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/) -- OpenAI, Feb 2026
- [Common workflow patterns for AI agents](https://www.claude.com/blog/common-workflow-patterns-for-ai-agents-and-when-to-use-them) -- Anthropic, Mar 2026
- [Building effective agents](https://www.anthropic.com/research/building-effective-agents) -- Anthropic, 2025
- [Orchestrator-Workers Cookbook](https://platform.claude.com/cookbook/patterns-agents-orchestrator-workers) -- Anthropic
- [Build the harness, not the code](https://vitthalmirji.com/2026/02/build-the-harness-not-the-code-a-staff/principal-engineers-guide-to-ai-agent-systems/) -- Vitthal Mirji, Feb 2026
- [Best practices for coding with agents](https://www.cursor.com/blog/agent-best-practices) -- Cursor, 2026
- [Cursor Subagents](https://cursor.com/docs/agent/subagents) -- Cursor Docs
