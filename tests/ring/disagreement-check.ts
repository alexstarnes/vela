/**
 * Phase 8 criterion (e): "at least two reviewers visibly disagree on at least
 * one point." The synthesizer's escalations are the primary signal; when it
 * resolves contradictions itself (legitimately, per protocol, when one side
 * is factually wrong or both are satisfiable), this check inspects the actual
 * findings for a concrete contradiction pair, judged by an opus CLI call at
 * $0 marginal — and requires exact quoted refs so the judge cannot hand-wave.
 *
 * Run: npx tsx tests/ring/disagreement-check.ts <prdTaskId>
 */
import '../governance/load-env';
import { db, evidence } from '../governance/util';
import { reviewerSubmissionSchema } from '@/lib/mastra/workflows/steps/ring-shared';
import { executeCliTask } from '@/lib/helper/client';

const taskId = process.argv[2];

async function main() {
  const events = await db.query.taskEvents.findMany({
    where: (e, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(e.taskId, taskId), eqOp(e.eventType, 'ring_findings')),
    orderBy: (e, { asc }) => [asc(e.createdAt)],
  });
  const submissions = events
    .map((e) => (e.payload as { submission?: unknown }).submission)
    .map((s) => reviewerSubmissionSchema.parse(s));

  const findingsList = submissions
    .map((s) =>
      s.findings
        .map(
          (f, i) =>
            `${s.reviewer}/${i + 1} [${f.type}/${f.severity}] target=${f.target}\n  claim: ${f.claim}\n  proposal: ${f.proposal}\n  tradeoff: ${f.tradeoff}`,
        )
        .join('\n'),
    )
    .join('\n\n');

  const prompt = `Three independent reviewers critiqued the same PRD. Below are all their findings, referenced as "<reviewer>/<n>".

${findingsList}

Question: do any two findings from DIFFERENT reviewers genuinely disagree — i.e., their proposals conflict such that accepting one requires rejecting or materially weakening the other? Superficial overlap or different emphasis is NOT disagreement; require a real tension (e.g. one argues to build/keep X, the other argues to cut/defer X; or incompatible scope/priority calls on the same target).

Reply with ONE fenced json block:
\`\`\`json
{
  "disagreement_found": true,
  "pairs": [
    {
      "ref_a": "<reviewer>/<n>",
      "ref_b": "<reviewer>/<n>",
      "tension": "<one sentence stating the concrete conflict>"
    }
  ]
}
\`\`\`
If there is truly no such pair, return {"disagreement_found": false, "pairs": []} — do not manufacture tension that is not there.`;

  const result = await executeCliTask({
    cli: 'claude',
    prompt,
    model: 'opus',
    maxTurns: 4,
    timeoutMs: 5 * 60 * 1000,
    allowedTools: [],
    permissionMode: 'default',
  });
  if (!result.ok) throw new Error(`Judge call failed: ${result.errorKind}`);

  const jsonMatch = result.resultText.match(/\{[\s\S]*\}/);
  const verdict = JSON.parse(jsonMatch![0]) as {
    disagreement_found: boolean;
    pairs: Array<{ ref_a: string; ref_b: string; tension: string }>;
  };

  // Verify quoted refs actually exist.
  const validRefs = new Set(
    submissions.flatMap((s) => s.findings.map((_, i) => `${s.reviewer}/${i + 1}`)),
  );
  const validPairs = verdict.pairs.filter(
    (p) => validRefs.has(p.ref_a) && validRefs.has(p.ref_b) && p.ref_a.split('/')[0] !== p.ref_b.split('/')[0],
  );

  evidence('disagreement-check', {
    judge_lane: 'cli (subscription, $0 metered)',
    disagreement_found: verdict.disagreement_found && validPairs.length > 0,
    pairs: validPairs,
  });
  console.log(
    verdict.disagreement_found && validPairs.length > 0
      ? `PASS: ${validPairs.length} concrete cross-reviewer contradiction(s) identified`
      : 'FAIL: no genuine cross-reviewer disagreement found',
  );
  process.exit(verdict.disagreement_found && validPairs.length > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
