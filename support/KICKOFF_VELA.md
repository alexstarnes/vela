# Kickoff prompt — Vela completion

Paste everything below the line into Claude Code, opened in the Vela repo.

Before pasting, place these files in the repo:

| File | Path |
|---|---|
| The plan | `support/VELA_COMPLETION_PLAN.md` |
| Current state | `support/STATUS_20260821.md` *(already there)* |
| The critique protocol | `docs/agent-protocols/critique-protocol.md` |
| The 17th role | `docs/agent-roles/differentiation-monetization-strategist.md` |

`docs/agent-roles/` and `docs/agent-protocols/` are new directories — see §15 of the plan for why
they go there and how they relate to `.agents/skills/agent-orchestration/`. The other sixteen roles
get **moved** into `docs/agent-roles/` during Phase 4; you do not need to do that by hand.

Set `BUILD_WEBHOOK` in your environment if you want progress on your phone (see rule 4).

---

## GOAL

Execute `support/VELA_COMPLETION_PLAN.md` end to end, Phase 0 through Phase 8, in this repo. Read
the whole plan and `support/STATUS_20260821.md` before starting. The plan is the specification;
this message sets the operating rules around it.

You are taking Vela from *feature-complete but unexercised* to *running the loop*: I draft a PRD, a
three-reviewer ring critiques it independently, a synthesizer reconciles it into a backlog, I
approve from Discord, and the existing build pipeline executes it.

**Read `AGENTS.md` first.** Load the `mastra` skill before touching anything under
`src/lib/mastra`. Non-negotiable.

## OPERATING RULES

**1. Work continuously. Do not check in for permission.**
Complete each phase, run its `VERIFY` block, report, move on. Do not stop to ask whether to proceed,
whether an approach is acceptable, or whether I like the result. I am not watching. Assume yes.

**2. Escalate only on a genuine blocker.** Four conditions justify stopping:

- **Something only I can provide** — a credential, a Discord server, an OAuth authorization, a
  decision about spending money. State exactly what you need and stop.
- **A `VERIFY` block fails after two distinct remediation attempts** and the failure suggests the
  plan is wrong rather than the execution. Report what you tried and what you infer.
- **A destructive or irreversible operation** — dropping a table, rotating
  `GITHUB_TOKEN_ENCRYPTION_KEY` when connections exist, force-pushing, deleting a workspace.
- **A security finding**: a credential reaching somewhere it should not, or an agent able to act
  outside its intended boundary. Stop immediately; do not work around it.

Everything else you resolve yourself — ambiguity, a stale doc, a missing flag, a design detail the
plan left open. Record the decision and reasoning in `support/BUILD_LOG.md` and continue. When the
plan and reality disagree, **reality wins**: amend the plan file and note the amendment.

**3. Spend nothing you don't have to.**
Route by judgment density: high-volume work on the local Ollama lane, the four judgment seats on the
CLI subscription lane, cloud API as the lane of last resort. The full cycle in Phase 8 should cost
approximately $0.

Watch for the §0.3 trap: if `ANTHROPIC_API_KEY` is visible to the spawned `claude` process, the key
wins over subscription auth and every "free" run becomes metered — no error, just a bill. Verify by
inspecting the child environment, not the config.

**4. Report as you go.**
Keep `support/BUILD_LOG.md` current — every VERIFY result, every `⚠` item you checked, every
decision under rule 2, every plan amendment. That log is a deliverable. If `BUILD_WEBHOOK` is set,
POST a one-line summary to it at the end of each phase:

```bash
notify() {
  printf '%s\n' "$1" >> support/BUILD_LOG.md
  [ -n "$BUILD_WEBHOOK" ] && curl -sS -X POST -H 'Content-Type: application/json' \
    -d "$(jq -Rn --arg c "$1" '{content:$c}')" "$BUILD_WEBHOOK" >/dev/null
}
```

**5. Do not skip Phases 0, 1, and 2.**
They produce no new features and are the most tempting to rush. They exist because the status audit
says governance code is *present* but was never *exercised*, and concurrency was never tested. A
build that adds the critique ring on top of unproven governance has built a nicer front door onto a
foundation nobody checked.

**6. Phase 7 (Hermes) is out of scope for this run.**
If you finish Phases 0–8, stop and tell me. Do not start it.

**7. Trust the code over the docs.**
`support/STATUS_20260821.md` is a snapshot and says so. `support/NEXT_BUILD_PLAN.md` is stale — do
not treat it as current. `support/IMPLEMENTATION_PLAN.md` is the original intent, largely shipped.
`PAPERCLIP_HERMES_IMPLEMENTATION_PLAN.md`, if present, is **withdrawn** — see §1 of the completion
plan. Verify anything load-bearing against the actual source.

## DEFINITION OF COMPLETE

Done when **all nine** are true and evidenced in `support/BUILD_LOG.md`:

1. Every model lane makes a real, logged call, and the CLI lane is confirmed subscription-billed
   rather than metered.
2. One task runs the full existing pipeline end to end — real file change, approval gate held,
   activity feed live.
3. `support/GOVERNANCE_PROOF.md` exists, containing event-log evidence that budget enforcement and
   loop detection **actually fired** under real conditions — not that the code exists.
4. Budget counts something beyond dollars, or the log documents why it doesn't need to.
5. Concurrency tested: N simultaneous heartbeats, no task ever checked out twice, no lost budget
   writes, no permanently locked task after a killed process.
6. The critique ring runs, and a test that inspects the **actual assembled context payload** proves
   no reviewer saw a peer's findings.
7. 17 roles ported; the 4 ring agents run on the subscription lane at zero marginal cost.
8. Discord approvals work end to end, **including the negative test** — a non-allowlisted user
   cannot approve.
9. **The Phase 8 acceptance test passes in full**, including the two hardest assertions: at least
   two reviewers visibly disagree on a deliberately weak PRD, and the synthesizer accounts for 100%
   of findings with a disposition and reason for each.

Criterion 9 is the acceptance test for the entire build. **If the ring returns three agreeable
critiques of a bad PRD, the system does not work** — treat that as a failure and diagnose it. It
will look like success, which is exactly why it is the thing to watch for.

## FINAL REPORT

Post and write to `support/BUILD_LOG.md`:
- Pass/fail for each of the nine criteria.
- Every `⚠` item and what you actually found — especially whether budget counts non-dollar metrics,
  whether the CLI lane leaks an API key, and whether the GitHub clone path is reliable.
- Every decision you made under rule 2, with reasoning.
- Everything in the plan that turned out to be wrong, and how you amended it.
- Total wall-clock time and total metered spend (which should be near zero).

Begin with Phase 0.
