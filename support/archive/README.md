# Archive

Documents here are kept for historical context only. Nothing in this folder is referenced by application code or by any `.claude/agents/*.md` definition — that's what makes a doc a candidate for archiving in the first place. **Do not treat anything here as current.** For current state, see [`support/PROJECT_STATUS.md`](../PROJECT_STATUS.md).

## Contents

| File | What it was | Why it's archived |
|---|---|---|
| `NEXT_BUILD_PLAN_2026-07-09.md` | A dated "what's left" work order written 2026-07-09, scoping auth hardening, deploy config, orchestration-core hardening, the CLI execution lane, and dev-server control. | Superseded — nearly everything it scoped shipped in commit `a35fb7b` (2026-08-ish). Its few still-open items (the three "Adequate → Strong" design notes, heartbeat load testing) were carried forward into `support/PROJECT_STATUS.md` §5 so nothing was lost, just consolidated. |
| `agent-orchestration-landscape-2026.html` | A one-time competitive-landscape research snapshot (Vela vs. Ship Studio and others), dated April 2026. | Point-in-time market research, not project state. Not referenced by code. Kept in case the competitive framing is useful again later. |
| `vela-brand-kit.jsx` | An early standalone design-tokens/color-swatch reference component (198 lines, April 2026). | Superseded by the much more complete `support/vela-ui-spec.jsx` (759 lines, July 2026), which is what every UI-facing `vela-*` agent definition actually points to. Not referenced anywhere in code or agent definitions. |

## Adding to this archive

When `support/PROJECT_STATUS.md` gets a substantial rewrite (not a routine "Last updated" bump — an actual restructuring or a point where a section's claims are being replaced wholesale), copy the outgoing version here first as `PROJECT_STATUS_<date-it-stopped-being-current>.md`, add a row to the table above, then edit the live doc. This keeps one evergreen status doc as the default read while still preserving the trail of what was true when.

The same pattern applies to any other doc that starts making claims about project state rather than stable reference material (architecture philosophy, specs, playbooks): if it's superseded and nothing in the codebase points to it by path, it belongs here, not deleted — deleting loses the "why did we used to think X" context that's often exactly what a future agent needs when something looks like a regression but is actually an intentional pivot.
