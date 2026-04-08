# Vela Architecture

Vela is a Next.js application with an embedded Mastra runtime for task orchestration.

## Core boundaries

- `src/lib/mastra`: production orchestration runtime. This is where runtime agents, workflow definitions, heartbeat execution, verification tools, routing analytics, and scheduler integration live.
- `src/lib/orchestration`: deterministic routing logic. Mode classification, template injection, workflow selection, playbook loading, and routing-tier tuning belong here.
- `src/lib/db`: Drizzle schema and persistence for `projects`, `agents`, `tasks`, `task_events`, `heartbeats`, and `approvals`.
- `src/lib/helper`: bridge to the local helper service for workspace file IO, command execution, and git operations.
- `src/app`: product UI and API routes.
- `src/mastra`: studio/example scaffold only. Do not use it for product orchestration changes unless a change is explicitly scaffold-facing.

## Runtime model

The active runtime uses five agents:

- `Supervisor`: classify, plan, route, synthesize
- `Repo Mapper`: repo discovery and dependency mapping
- `Implementer`: code changes
- `Reviewer`: semantic review after mechanical verification
- `Verifier`: deterministic gate execution through tools

The embedded runtime is workflow-first:

- agents reason
- workflows orchestrate
- tools execute deterministic operations

## Workflow suite

Three workflow ids are registered in the embedded Mastra singleton:

- `featureWorkflow`
- `highRiskWorkflow`
- `debugWorkflow`

Heartbeat routing is responsible for selecting the workflow from task classification. Workflow-specific branching owns final task status outcomes:

- verified plus review pass -> `review`
- verify fail or review fail -> `open`
- approval requested -> `waiting_for_human`

## Persistence and observability

The current source of truth is relational state, not Mastra snapshot storage:

- `tasks`: current assignment and lifecycle state
- `task_events`: workflow, verification, escalation, review, and scorecard events
- `heartbeats`: execution-loop accounting
- `approvals`: human approval gates for high-risk actions

Phase 3 routing analytics aggregate from these tables. Routing quality must stay conservative: history may raise the starting tier floor for risky buckets, but never reduce safety requirements.

## Verification model

Mechanical gates are mandatory. The verifier runs repository commands and returns structured results for:

- `lint`
- `typecheck`
- `tests`
- `build`
- `security_audit` for high-risk paths

Agents do not self-certify success. Build and test outcomes must come from command output.
