# Definition Of Done

A Vela orchestration change is done only when all of the following are true.

## Runtime correctness

- Changes land in `src/lib/mastra` or `src/lib/orchestration` unless the work explicitly targets the scaffold.
- Workflow routing is deterministic and uses the shared selector logic.
- High-risk approval flow uses Vela approvals and task status transitions, not ad hoc pauses.
- Runtime agent tool access matches the intended surface area for that role.

## Verification

- The smallest relevant verification sequence has been run.
- High-risk work includes security-aware verification when applicable.
- Reviewer feedback is either addressed or the task remains requeued.
- No workflow path bypasses structured verification data.

## Persistence and status

- Task status changes are made by the owning workflow branch.
- Workflow-native events are logged when route, repo map, review, approval, or scorecard milestones happen.
- Approval-triggered tasks park in `waiting_for_human` and resume through heartbeat after approval.

## Documentation and context

- Repo-native playbooks remain accurate for the stacks they describe.
- Architecture or workflow-shape changes are reflected in docs when they affect future routing or implementation behavior.
- Prompt templates and playbook loading stay additive and scoped to relevant tasks.

## Quality bar

- TypeScript compiles cleanly.
- Added tests or eval fixtures cover the changed deterministic logic.
- No new secret handling, schema, auth, or infrastructure path ships without premium review expectations.
