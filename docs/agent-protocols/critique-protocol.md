---
name: critique-protocol
description: >
  Use when reviewing a PRD, spec, design doc, or proposed backlog as a member of a review ring, and
  when reconciling multiple reviewers' output into a single revised document. Defines the finding
  schema every reviewer emits, the severity rubric, the independence rule, and the synthesizer's
  reconciliation contract. Triggers: PRD review, spec critique, design review, review ring, find
  gaps, pressure-test this doc, reconcile reviews, synthesize critiques, backlog proposal.
version: 1.0.0
metadata:
  category: product
  recommendedForRoles:
    - product-strategist
    - ux-designer
    - differentiation-monetization-strategist
    - orchestrator
---

# Critique Protocol

The shared output contract for a review ring: several specialists read the same document
independently, each emits structured findings, and a synthesizer reconciles them into one revised
document plus a proposed backlog.

**Why this exists.** Free-text critique degrades into agreeable mush. Three reviewers writing
essays produce three documents nobody reads and no way to tell whether the third reviewer actually
disagreed or just restated the first. Structure makes the synthesizer's job mechanical, makes the
human's review fast, and makes it possible to *assert* that a critical finding was addressed.

---

## When to use this

- You have been assigned to review a document as part of a ring → follow **Reviewer Protocol**.
- You have been assigned to reconcile a completed ring → follow **Synthesizer Protocol**.
- You are reviewing something alone, informally → you do not need this. Use it when the output
  must be machine-checkable or when more than one reviewer is involved.

---

## The independence rule

**Read this first. It is the rule most often broken and the one that matters most.**

A reviewer must not read another reviewer's findings before writing their own.

Shared context produces consensus drift: the second reviewer agrees with the first because it read
the first, and three critiques collapse into one critique with two echoes. The entire value of a
ring is that it surfaces disagreements a single reader would miss.

**If you are a reviewer:**
- Do not fetch, search for, or read peer findings on this document before submitting yours.
- If peer findings are already in your context through no action of yours, **say so explicitly** in
  your submission (`contaminated: true`, see below) so the synthesizer can weight your findings
  accordingly. Do not pretend independence you do not have.
- Do not soften a finding because you expect another reviewer to raise it. Redundant findings are
  cheap; a missing finding is not.

**If you are the synthesizer:** you read everything. That is your job.

---

## Reviewer Protocol

### Step 1 — Read the document in full before writing anything

Including sections outside your domain. You are looking for what is *missing*, and absence is only
visible against the whole.

### Step 2 — Emit findings in this schema

```yaml
reviewer: <your role name>
target_document: <issue id + document key, e.g. "issue-4471:prd">
contaminated: false        # true if peer findings were in your context
findings:
  - type: gap | risk | recommendation
    severity: critical | major | minor
    target: <story id, section name, feature name, or "prd:whole">
    claim: <ONE sentence stating what is wrong or missing>
    evidence: <what supports this — or "unknown -- would need X" >
    proposal: <the specific change you are arguing for>
    tradeoff: <what the team gives up if they accept it>
```

**Field discipline — the schema fails quietly when these slip:**

| Field | Rule |
|---|---|
| `type` | `gap` = something absent. `risk` = something present that may fail. `recommendation` = something present that should change. If you cannot pick one, the finding is too vague. |
| `severity` | See the rubric below. Do not inflate. A ring where everything is `critical` conveys nothing. |
| `target` | Must point at something specific. `"prd:whole"` is legitimate but should be rare — prefer the narrowest true target. |
| `claim` | One sentence. If it needs two, it is two findings. |
| `evidence` | **`"unknown -- would need X"` is a valid and respected answer.** Never fabricate data, quotes, metrics, or sources to fill this field. A finding with honest uncertainty is useful; a finding with invented support is worse than none. |
| `proposal` | Must be actionable by someone. "Consider the tradeoffs" is not a proposal. |
| `tradeoff` | Every proposal costs something — scope, time, simplicity, or another goal. If you wrote "none," you have not thought about it. |

### Step 3 — Self-check before submitting

- [ ] Every finding has all seven fields populated.
- [ ] No `evidence` field contains a number, quote, or source you did not actually have.
- [ ] Severities are distributed, not uniform.
- [ ] Each `claim` is one sentence.
- [ ] You stayed inside your mandate — you did not write requirements, flows, or architecture that belong to another role. Route those as a `recommendation` instead.
- [ ] If you found nothing worth flagging, you said so explicitly rather than manufacturing filler. An empty `findings` list with a stated reason is a legitimate submission.

### Step 4 — Role-specific summary block

Some roles emit one additional structured summary alongside their findings — for example the
Differentiation & Monetization Strategist's `commercial_summary`. Consult your own role definition.
If your role does not define one, do not invent one.

---

## Severity rubric

Apply your own domain's version of this. The calibration question is always: *what happens if this
ships unaddressed?*

| Severity | Test | Typical consequence |
|---|---|---|
| `critical` | The premise is broken. Building this as specified produces something wrong, unusable, indefensible, or unshippable. | Scope must change before work begins. |
| `major` | A real gap that changes what should be built, but the premise survives. | Rework or an added story. |
| `minor` | Worth noting; improves quality but does not change scope. | A comment on an existing story. |

**Calibration guard.** If more than roughly a third of your findings are `critical`, you have
mis-calibrated — go back and ask which ones genuinely break the premise. If *none* of your findings
are above `minor` on a document you believe has real problems, you are being agreeable. Both
failures are common; the second is more common.

---

## Synthesizer Protocol

You receive every reviewer's submission. You produce a revised document, a proposed backlog, and a
reconciliation record.

### The accounting rule

**Every finding must be accounted for.** For each one, record `accepted`, `rejected`, or `deferred`,
with a reason. A synthesizer that silently drops a finding has failed its contract, and a dropped
`critical` finding is a defect in the system, not a judgment call.

```yaml
reconciliation:
  - finding_ref: <reviewer>/<index>
    disposition: accepted | rejected | deferred
    reason: <why — one sentence>
    resulting_change: <what changed in the revised doc, or "none">
```

### Handling contradictions

Reviewers will disagree. That is the ring working.

1. **State the contradiction explicitly** in the reconciliation record. Do not average it away or
   pick the more articulate one.
2. **Resolve it yourself only when one side is factually wrong** or the two are reconcilable with a
   change that satisfies both.
3. **Escalate to the human when the disagreement is a genuine judgment call between roles** —
   especially commercial viability versus user need, or scope versus quality. That escalation is
   the decision a human board exists to make. Resolving it quietly removes the operator from their
   own governance.

Escalate with:
```yaml
escalations:
  - conflict: <one sentence describing the disagreement>
    positions:
      - reviewer: <role>
        position: <their argument, stated fairly>
      - reviewer: <role>
        position: <their argument, stated fairly>
    recommendation: <your view, labeled as a recommendation, not a decision>
```

State each side as strongly as its author would. A synthesizer that steelmans one position and
strawmans the other has made the decision while appearing to escalate it.

### Output

1. **Revised document** — the original with accepted findings incorporated. Preserve the original
   as a prior revision; never overwrite history.
2. **Proposed backlog** — user stories with acceptance criteria, each traceable to the findings that
   produced or shaped it.
3. **Reconciliation record** — the accounting above.
4. **Escalations** — where present.

### What you must not do

- Do not create tickets. You propose a backlog; the approval gate creates work.
- Do not add findings of your own. You reconcile; you do not review. If you spot something all
  reviewers missed, file it as a separate issue rather than smuggling it into the synthesis.
- Do not mark yourself done. The execution policy routes your output to a human reviewer.

---

## Verification

The ring is working if a deliberately weak document produces:

- Findings that identify the actual weaknesses, not adjacent generic ones.
- At least one `critical` or `major` from each reviewer, in their own domain.
- Visible disagreement between at least two reviewers on at least one point.
- A reconciliation record accounting for 100% of findings.

The ring is **not** working if:

- All reviewers agree on everything (independence is broken, or reviewers are being agreeable).
- Findings are schema-valid but generic — they would apply to any document.
- `evidence` fields contain confident numbers nobody sourced.
- The synthesizer's output reads like a summary rather than a reconciliation.

---

## Worked example

**Input fragment (from a weak PRD):**
> *"Users should have a good experience browsing their saved items. We'll add filtering and sorting
> to make the list easier to use."*

**A well-formed finding:**

```yaml
- type: gap
  severity: major
  target: "story-12: saved items list"
  claim: Success criteria are not testable — "good experience" cannot be verified or falsified.
  evidence: The story defines no measurable outcome; no latency, task-completion, or error-rate target appears anywhere in the PRD.
  proposal: Replace with a measurable criterion, e.g. "a user with 500 saved items can locate a specific item in under 10 seconds on a mid-tier mobile device."
  tradeoff: Requires deciding a target device profile and instrumenting the flow, which adds scope to an otherwise simple story.
```

**A badly-formed finding, for contrast:**

```yaml
- type: risk
  severity: critical
  target: "prd:whole"
  claim: The UX could be better and users might churn, and we should also consider performance and accessibility and think about how this scales.
  evidence: Industry data shows 70% of users abandon slow apps.
  proposal: Improve the experience.
  tradeoff: none
```

Four failures, all common: the claim is four findings wearing one coat; severity is inflated;
the evidence is a fabricated statistic; the proposal is not actionable; and `tradeoff: none` means
the tradeoff was never considered.
