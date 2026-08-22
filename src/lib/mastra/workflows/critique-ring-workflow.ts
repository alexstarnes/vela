/**
 * Critique-ring workflow — the product-mode pipeline (completion plan §6).
 *
 *   load-prd → ring-review (3 independent reviewers) → ring-synthesize →
 *   ring-gate (approval; nothing becomes a task until the human approves)
 *
 * Independence is enforced by construction: each reviewer's context is built
 * by the pure `buildRingReviewerContext` — PRD + goal ancestry + own role
 * skill + critique protocol — and the exact payload is logged as a
 * `ring_context` event so tests can assert no peer findings appear.
 */
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects, tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';
import { appendDocumentRevision, getLatestDocument, PRD_DOCUMENT_KEY } from '@/lib/documents';
import { createApprovalRequest } from '@/lib/actions/approvals';
import { ringReviewerNames } from '@/lib/mastra/agents';
import {
  buildRingReviewerContext,
  buildSynthesizerContext,
  contextSha256,
  CRITIQUE_PROTOCOL_SKILL_NAME,
  extractJsonBlock,
  getRingAgentRow,
  invokeRingSeat,
  loadRingSkill,
  reviewerSubmissionSchema,
  RING_ROLE_SKILL_BY_AGENT,
  synthesisSchema,
  type ReviewerSubmission,
  type Synthesis,
} from './steps/ring-shared';

// ─── Step schemas ─────────────────────────────────────────────────

const ringInputSchema = z.object({
  taskId: z.string().uuid(),
  agentId: z.string().uuid(),
  heartbeatId: z.string().uuid().optional(),
});

const usageSchema = z.object({
  totalTokens: z.number(),
  totalCostUsd: z.string(),
});

const ringLoadedSchema = ringInputSchema.extend({
  // 'run' = execute the ring; 'already_approved' = the gate has been passed,
  // finish the task; 'gate_pending' = an unanswered approval already covers
  // this revision — hold at the gate without re-spending the ring.
  ringPhase: z.enum(['run', 'already_approved', 'gate_pending']),
  prdMarkdown: z.string(),
  prdRevision: z.number(),
  usage: usageSchema,
});

const ringReviewedSchema = ringLoadedSchema.extend({
  submissions: z.array(reviewerSubmissionSchema),
  reviewerLanes: z.array(z.object({ reviewer: z.string(), lane: z.string(), model: z.string() })),
});

const ringSynthesizedSchema = ringReviewedSchema.extend({
  synthesis: synthesisSchema.nullable(),
});

const ringOutputSchema = z.object({
  taskId: z.string().uuid(),
  agentId: z.string().uuid(),
  heartbeatId: z.string().uuid().optional(),
  summary: z.string(),
  usage: usageSchema,
  finalStatus: z.enum(['review', 'open', 'waiting_for_human']),
  outcome: z.object({
    kind: z.enum(['review_ready', 'requeue', 'waiting_for_human']),
    statusTarget: z.enum(['review', 'open', 'waiting_for_human']),
    reason: z.string(),
  }),
});

// ─── load-prd ─────────────────────────────────────────────────────

const loadPrdStep = createStep({
  id: 'ring-load-prd',
  inputSchema: ringInputSchema,
  outputSchema: ringLoadedSchema,
  execute: async ({ inputData }) => {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) });
    if (!task) throw new Error(`Task ${inputData.taskId} not found`);

    const prd = await getLatestDocument(task.id, PRD_DOCUMENT_KEY);
    if (!prd) {
      throw new Error(
        `Task ${task.id} routed to the critique ring but has no '${PRD_DOCUMENT_KEY}' document`,
      );
    }

    await db
      .update(tasks)
      .set({ workflowType: 'product', updatedAt: new Date() })
      .where(eq(tasks.id, task.id));

    await logTaskEvent({
      taskId: task.id,
      agentId: inputData.agentId,
      eventType: 'mode_selection',
      payload: {
        mode: 'product',
        workflow_id: 'critiqueRingWorkflow',
        reason: `Task carries a '${PRD_DOCUMENT_KEY}' document — product work routes to the critique ring`,
        prd_revision: prd.revision,
      },
    });

    // Gate bookkeeping. The approval payload stores prd_revision =
    // revised.revision — the revision the gate itself wrote — so:
    //   approved && payload.prd_revision >= prd.revision  → ring complete
    //   pending  && payload.prd_revision >= prd.revision  → gate already
    //     raised for the current content; do NOT re-run reviewers (a requeued
    //     task with an unanswered approval must not re-spend the ring).
    // A newer human-appended revision makes both comparisons false → fresh run.
    const latestApproval = await db.query.approvals.findFirst({
      where: (a, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(a.taskId, task.id), eqOp(a.actionType, 'prd_backlog')),
      orderBy: (a, { desc }) => [desc(a.createdAt)],
    });
    const approvalRevision =
      (latestApproval?.payload as { prd_revision?: number } | null)?.prd_revision ?? -1;
    const coversCurrentRevision = approvalRevision >= prd.revision;

    const ringPhase =
      latestApproval?.status === 'pending' && coversCurrentRevision
        ? ('gate_pending' as const)
        : latestApproval?.status === 'approved' && coversCurrentRevision
          ? ('already_approved' as const)
          : ('run' as const);

    return {
      ...inputData,
      ringPhase,
      prdMarkdown: prd.contentMd,
      prdRevision: prd.revision,
      usage: { totalTokens: 0, totalCostUsd: '0.000000' },
    };
  },
});

// ─── ring-review ──────────────────────────────────────────────────

async function runOneReviewer(params: {
  reviewerName: string;
  taskId: string;
  prdMarkdown: string;
  prdRevision: number;
  protocolMd: string;
}): Promise<{
  submission: ReviewerSubmission;
  lane: string;
  model: string;
  totalTokens: number;
  totalCostUsd: string;
}> {
  const agentRow = await getRingAgentRow(params.reviewerName);
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, params.taskId) });
  if (!task) throw new Error(`Task ${params.taskId} not found`);
  const project = task.projectId
    ? ((await db.query.projects.findFirst({ where: eq(projects.id, task.projectId) })) ?? null)
    : null;

  const roleSkillMd = await loadRingSkill(RING_ROLE_SKILL_BY_AGENT[params.reviewerName], 'role');

  const context = buildRingReviewerContext({
    reviewerName: params.reviewerName,
    roleSkillMd,
    protocolMd: params.protocolMd,
    prdMarkdown: params.prdMarkdown,
    prdRevision: params.prdRevision,
    task,
    project,
  });

  // Log the EXACT payload this reviewer sees — the independence evidence.
  await logTaskEvent({
    taskId: params.taskId,
    agentId: agentRow.id,
    eventType: 'ring_context',
    payload: {
      reviewer: params.reviewerName,
      prd_revision: params.prdRevision,
      context_chars: context.length,
      context_sha256: contextSha256(context),
      context,
    },
  });

  let totalTokens = 0;
  let totalCostUsd = 0;
  let lastError = '';
  let lane = '';
  let model = '';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt =
      attempt === 1
        ? context
        : `${context}\n\n## Resubmission required\nYour previous submission failed validation: ${lastError}\nEmit the corrected fenced json block now, following the output format exactly.`;

    const seat = await invokeRingSeat({
      agentRow,
      prompt,
      taskId: params.taskId,
      stepId: 'ring-review',
    });
    totalTokens += seat.totalTokens;
    totalCostUsd += parseFloat(seat.totalCostUsd);
    lane = seat.lane;
    model = seat.resolvedModelId;

    try {
      const parsed = reviewerSubmissionSchema.parse(extractJsonBlock(seat.text));
      const submission = { ...parsed, reviewer: params.reviewerName };
      await logTaskEvent({
        taskId: params.taskId,
        agentId: agentRow.id,
        eventType: 'ring_findings',
        payload: {
          reviewer: params.reviewerName,
          lane,
          model,
          attempt,
          finding_count: submission.findings.length,
          contaminated: submission.contaminated,
          submission: JSON.parse(JSON.stringify(submission)),
        },
      });
      return {
        submission,
        lane,
        model,
        totalTokens,
        totalCostUsd: totalCostUsd.toFixed(6),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 800) : String(error);
      console.warn(`[ring] ${params.reviewerName} attempt ${attempt} failed validation: ${lastError}`);
    }
  }

  // A reviewer that cannot emit schema-valid findings fails the step — the
  // synthesizer must never paper over it (completion plan §3.5).
  throw new Error(
    `Ring reviewer ${params.reviewerName} failed schema validation after retry: ${lastError}`,
  );
}

const ringReviewStep = createStep({
  id: 'ring-review',
  inputSchema: ringLoadedSchema,
  outputSchema: ringReviewedSchema,
  execute: async ({ inputData }) => {
    if (inputData.ringPhase !== 'run') {
      return { ...inputData, submissions: [], reviewerLanes: [] };
    }

    const protocolMd = await loadRingSkill(CRITIQUE_PROTOCOL_SKILL_NAME, 'protocol');

    // All three reviewers run concurrently; independence holds by construction
    // because each context is assembled from scratch above.
    const results = await Promise.all(
      ringReviewerNames.map((reviewerName) =>
        runOneReviewer({
          reviewerName,
          taskId: inputData.taskId,
          prdMarkdown: inputData.prdMarkdown,
          prdRevision: inputData.prdRevision,
          protocolMd,
        }),
      ),
    );

    const totalTokens =
      inputData.usage.totalTokens + results.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalCostUsd = (
      parseFloat(inputData.usage.totalCostUsd) +
      results.reduce((sum, r) => sum + parseFloat(r.totalCostUsd), 0)
    ).toFixed(6);

    return {
      ...inputData,
      submissions: results.map((r) => r.submission),
      reviewerLanes: results.map((r) => ({ reviewer: r.submission.reviewer, lane: r.lane, model: r.model })),
      usage: { totalTokens, totalCostUsd },
    };
  },
});

// ─── ring-synthesize ──────────────────────────────────────────────

function allFindingRefs(submissions: ReviewerSubmission[]): string[] {
  return submissions.flatMap((submission) =>
    submission.findings.map((_, index) => `${submission.reviewer}/${index + 1}`),
  );
}

function missingRefs(synthesis: Synthesis, submissions: ReviewerSubmission[]): string[] {
  const accounted = new Set(synthesis.reconciliation.map((entry) => entry.finding_ref.trim()));
  return allFindingRefs(submissions).filter((ref) => !accounted.has(ref));
}

const ringSynthesizeStep = createStep({
  id: 'ring-synthesize',
  inputSchema: ringReviewedSchema,
  outputSchema: ringSynthesizedSchema,
  execute: async ({ inputData }) => {
    if (inputData.ringPhase !== 'run') {
      return { ...inputData, synthesis: null };
    }

    const agentRow = await getRingAgentRow('Synthesizer');
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) });
    if (!task) throw new Error(`Task ${inputData.taskId} not found`);
    const project = task.projectId
      ? ((await db.query.projects.findFirst({ where: eq(projects.id, task.projectId) })) ?? null)
      : null;

    const [roleSkillMd, protocolMd] = await Promise.all([
      loadRingSkill(RING_ROLE_SKILL_BY_AGENT.Synthesizer, 'role'),
      loadRingSkill(CRITIQUE_PROTOCOL_SKILL_NAME, 'protocol'),
    ]);

    const baseContext = buildSynthesizerContext({
      roleSkillMd,
      protocolMd,
      prdMarkdown: inputData.prdMarkdown,
      prdRevision: inputData.prdRevision,
      task,
      project,
      submissions: inputData.submissions,
    });

    let totalTokens = inputData.usage.totalTokens;
    let totalCostUsd = parseFloat(inputData.usage.totalCostUsd);
    let feedback = '';
    let lastError = '';

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const prompt = feedback ? `${baseContext}\n\n## Resubmission required\n${feedback}` : baseContext;
      const seat = await invokeRingSeat({
        agentRow,
        prompt,
        taskId: inputData.taskId,
        stepId: 'ring-synthesize',
      });
      totalTokens += seat.totalTokens;
      totalCostUsd += parseFloat(seat.totalCostUsd);

      try {
        const synthesis = synthesisSchema.parse(extractJsonBlock(seat.text));
        const missing = missingRefs(synthesis, inputData.submissions);
        if (missing.length > 0) {
          feedback =
            `Your reconciliation is incomplete — every finding must be accounted for. ` +
            `Missing finding_refs: ${missing.join(', ')}. Emit the full corrected json block.`;
          lastError = `unaccounted findings: ${missing.join(', ')}`;
          continue;
        }

        await logTaskEvent({
          taskId: inputData.taskId,
          agentId: agentRow.id,
          eventType: 'ring_reconciliation',
          payload: {
            attempt,
            finding_count: allFindingRefs(inputData.submissions).length,
            accounted: synthesis.reconciliation.length,
            dispositions: synthesis.reconciliation.reduce<Record<string, number>>(
              (acc, entry) => ({ ...acc, [entry.disposition]: (acc[entry.disposition] ?? 0) + 1 }),
              {},
            ),
            escalations: synthesis.escalations.length,
            backlog_items: synthesis.backlog.length,
            reconciliation: synthesis.reconciliation,
            escalation_detail: synthesis.escalations,
          },
        });

        return {
          ...inputData,
          synthesis,
          usage: { totalTokens, totalCostUsd: totalCostUsd.toFixed(6) },
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message.slice(0, 800) : String(error);
        feedback = `Your previous submission failed validation: ${lastError}. Emit the corrected fenced json block, following the output format exactly.`;
      }
    }

    throw new Error(`Ring synthesizer failed its contract after retry: ${lastError}`);
  },
});

// ─── ring-gate ────────────────────────────────────────────────────

const ringGateStep = createStep({
  id: 'ring-gate',
  inputSchema: ringSynthesizedSchema,
  outputSchema: ringOutputSchema,
  execute: async ({ inputData }) => {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) });
    if (!task) throw new Error(`Task ${inputData.taskId} not found`);

    if (inputData.ringPhase === 'gate_pending') {
      // An unanswered approval already covers this revision — hold at the
      // gate; nothing is re-run and no duplicate approval is created.
      await db
        .update(tasks)
        .set({ status: 'waiting_for_human', updatedAt: new Date() })
        .where(eq(tasks.id, task.id));
      await logTaskEvent({
        taskId: task.id,
        agentId: inputData.agentId,
        eventType: 'status_change',
        payload: {
          from: task.status,
          to: 'waiting_for_human',
          reason: 'Critique-ring approval still pending — holding at the gate',
        },
      });
      return {
        taskId: inputData.taskId,
        agentId: inputData.agentId,
        heartbeatId: inputData.heartbeatId,
        summary: 'Critique-ring approval still pending; holding at the gate without re-running the ring.',
        usage: inputData.usage,
        finalStatus: 'waiting_for_human' as const,
        outcome: {
          kind: 'waiting_for_human' as const,
          statusTarget: 'waiting_for_human' as const,
          reason: 'Backlog approval still pending',
        },
      };
    }

    if (inputData.ringPhase === 'already_approved' || !inputData.synthesis) {
      // Gate already passed — the approval handler created the child tasks;
      // this run just moves the PRD task to review for final human sign-off.
      await db
        .update(tasks)
        .set({ status: 'review', updatedAt: new Date() })
        .where(eq(tasks.id, task.id));
      await logTaskEvent({
        taskId: task.id,
        agentId: inputData.agentId,
        eventType: 'status_change',
        payload: {
          from: task.status,
          to: 'review',
          reason: 'Backlog approved — critique ring complete',
        },
      });
      return {
        taskId: inputData.taskId,
        agentId: inputData.agentId,
        heartbeatId: inputData.heartbeatId,
        summary: 'Critique ring already approved; PRD task moved to review.',
        usage: inputData.usage,
        finalStatus: 'review' as const,
        outcome: {
          kind: 'review_ready' as const,
          statusTarget: 'review' as const,
          reason: 'Backlog approved by the operator',
        },
      };
    }

    const synthesizer = await getRingAgentRow('Synthesizer');

    // Persist the revised PRD as a NEW revision — the original stays intact.
    const revised = await appendDocumentRevision({
      taskId: task.id,
      key: PRD_DOCUMENT_KEY,
      contentMd: inputData.synthesis.revised_prd_md,
      createdByAgentId: synthesizer.id,
    });

    const escalationNote =
      inputData.synthesis.escalations.length > 0
        ? ` ${inputData.synthesis.escalations.length} reviewer contradiction(s) escalated for your decision.`
        : '';

    await createApprovalRequest({
      agentId: synthesizer.id,
      taskId: task.id,
      actionType: 'prd_backlog',
      description:
        `Critique ring complete for "${task.title}": ${inputData.submissions.reduce((n, s) => n + s.findings.length, 0)} findings reconciled, ` +
        `${inputData.synthesis.backlog.length} backlog item(s) proposed (PRD rev ${inputData.prdRevision} → ${revised.revision}).${escalationNote}`,
      payload: {
        prd_revision: revised.revision,
        reviewed_revision: inputData.prdRevision,
        backlog: inputData.synthesis.backlog,
        reconciliation: inputData.synthesis.reconciliation,
        escalations: inputData.synthesis.escalations,
        reviewer_lanes: inputData.reviewerLanes,
        project_id: task.projectId,
      },
    });

    await db
      .update(tasks)
      .set({ status: 'waiting_for_human', updatedAt: new Date() })
      .where(eq(tasks.id, task.id));
    await logTaskEvent({
      taskId: task.id,
      agentId: synthesizer.id,
      eventType: 'status_change',
      payload: {
        from: 'in_progress',
        to: 'waiting_for_human',
        reason: 'Critique ring complete — backlog awaiting operator approval',
      },
    });

    return {
      taskId: inputData.taskId,
      agentId: inputData.agentId,
      heartbeatId: inputData.heartbeatId,
      summary:
        `Ring reviewed PRD rev ${inputData.prdRevision}; revised to rev ${revised.revision}; ` +
        `${inputData.synthesis.backlog.length} backlog item(s) proposed and gated on approval.`,
      usage: inputData.usage,
      finalStatus: 'waiting_for_human' as const,
      outcome: {
        kind: 'waiting_for_human' as const,
        statusTarget: 'waiting_for_human' as const,
        reason: 'Backlog awaiting operator approval',
      },
    };
  },
});

// ─── Workflow ─────────────────────────────────────────────────────

export const critiqueRingWorkflow = createWorkflow({
  id: 'critiqueRingWorkflow',
  inputSchema: ringInputSchema,
  outputSchema: ringOutputSchema,
})
  .then(loadPrdStep)
  .then(ringReviewStep)
  .then(ringSynthesizeStep)
  .then(ringGateStep)
  .commit();
