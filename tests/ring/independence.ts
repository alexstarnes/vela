/**
 * Ring independence test (completion plan §3.4): inspect the ACTUAL assembled
 * context payload for every ring reviewer and fail if a peer's findings
 * appear. Includes a positive control proving the test can detect
 * contamination: the legacy buildSystemPrompt path DOES leak task history.
 *
 * Run: npx tsx tests/ring/independence.ts
 */
import '../governance/load-env';
import { readFileSync } from 'node:fs';
import { db, agents, tasks, taskEvents, eq, evidence } from '../governance/util';
import { getProjectByName, createTestTask } from '../governance/util';
import { appendDocumentRevision, PRD_DOCUMENT_KEY } from '@/lib/documents';
import { logTaskEvent } from '@/lib/events/logger';
import { ringReviewerNames } from '@/lib/mastra/agents';
import {
  buildRingReviewerContext,
  loadRingSkill,
  RING_ROLE_SKILL_BY_AGENT,
  CRITIQUE_PROTOCOL_SKILL_NAME,
} from '@/lib/mastra/workflows/steps/ring-shared';
import { buildSystemPrompt } from '@/lib/mastra/agent-factory';

const SENTINEL = 'PEER_FINDING_SENTINEL_7f3a1c';

async function main() {
  const project = await getProjectByName('Phase0 E2E');
  const supervisor = await db.query.agents.findFirst({
    where: (a, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(a.name, 'Supervisor'), eqOp(a.agentKind, 'runtime')),
  });

  const prdMarkdown = readFileSync('tests/fixtures/weak-prd.md', 'utf8');
  const taskId = await createTestTask({
    projectId: project.id,
    agentId: supervisor!.id,
    title: 'Independence test PRD task',
    description: 'Scratch PRD task for the ring independence test.',
  });

  try {
    await appendDocumentRevision({ taskId, key: PRD_DOCUMENT_KEY, contentMd: prdMarkdown });

    // Plant peer findings in the task's event log — the exact contamination
    // vector: agent-factory's Recent Activity section reads task_events.
    await logTaskEvent({
      taskId,
      eventType: 'ring_findings',
      payload: {
        reviewer: 'PRD Auditor',
        submission: {
          findings: [
            { claim: `The success criteria are untestable ${SENTINEL}`, severity: 'critical' },
          ],
        },
      },
    });
    await logTaskEvent({
      taskId,
      eventType: 'review',
      payload: { status: 'needs_rework', findings: `- legacy reviewer finding ${SENTINEL}` },
    });

    const task = (await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }))!;
    const protocolMd = await loadRingSkill(CRITIQUE_PROTOCOL_SKILL_NAME, 'protocol');

    // ── The real ring contexts ──
    const results: Record<string, { chars: number; leaked: boolean; hasPrd: boolean; hasOwnRole: boolean; hasProtocol: boolean }> = {};
    for (const reviewerName of ringReviewerNames) {
      const roleSkillMd = await loadRingSkill(RING_ROLE_SKILL_BY_AGENT[reviewerName], 'role');
      const context = buildRingReviewerContext({
        reviewerName,
        roleSkillMd,
        protocolMd,
        prdMarkdown,
        prdRevision: 1,
        task,
        project: { name: project.name, goal: project.goal },
      });
      results[reviewerName] = {
        chars: context.length,
        leaked: context.includes(SENTINEL),
        hasPrd: context.includes('Clipper'),
        hasOwnRole: context.includes(RING_ROLE_SKILL_BY_AGENT[reviewerName]),
        hasProtocol: context.includes('independence rule') || context.includes('Critique Protocol'),
      };
    }

    // ── Positive control: the LEGACY path must show the leak, proving the
    //    sentinel detection works on a contaminated payload. ──
    const legacyPrompt = await buildSystemPrompt(supervisor!, task);
    const controlLeaks = legacyPrompt.includes(SENTINEL);

    evidence('ring-independence', {
      sentinel: SENTINEL,
      reviewers: results,
      positive_control_legacy_prompt_leaks: controlLeaks,
    });

    const allClean = Object.values(results).every(
      (r) => !r.leaked && r.hasPrd && r.hasOwnRole && r.hasProtocol,
    );
    const pass = allClean && controlLeaks;
    console.log(
      pass
        ? 'PASS: no reviewer context contains peer findings; positive control confirms the detector works'
        : controlLeaks
          ? 'FAIL: a reviewer context leaked peer findings (or is missing required sections)'
          : 'INCONCLUSIVE: positive control did not leak — detector cannot be trusted',
    );
    process.exitCode = pass ? 0 : 1;
  } finally {
    await db.delete(taskEvents).where(eq(taskEvents.taskId, taskId));
    const { documents } = await import('@/lib/db/schema');
    await db.delete(documents).where(eq(documents.taskId, taskId));
    await db.delete(tasks).where(eq(tasks.id, taskId));
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
