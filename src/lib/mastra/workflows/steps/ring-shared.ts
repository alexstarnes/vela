/**
 * Critique ring — shared context assembly, output contracts, and seat
 * invocation.
 *
 * Independence is the load-bearing requirement (completion plan §3.4): a ring
 * reviewer's context is assembled HERE, explicitly and only here — the PRD,
 * goal ancestry, the reviewer's own role skill, and the critique protocol.
 * Never task history, never peer findings. `buildRingReviewerContext` is a
 * pure function so tests can capture the exact payload a reviewer sees.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { db } from '@/lib/db';
import {
  agentModelAccess,
  agents,
  modelConfigs,
  skills,
  type Agent as DbAgent,
  type Project,
  type Task,
} from '@/lib/db/schema';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';
import { executeCliTask } from '@/lib/helper/client';
import {
  cliModelFlagForModelId,
  cliNameForModelId,
  isCliFailoverErrorKind,
  setCliLaneCooldown,
} from '@/lib/orchestration/cli-lane';
import { resolveModel } from '@/lib/mastra/router';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';

// ─── Output contracts ─────────────────────────────────────────────

export const ringFindingSchema = z.object({
  type: z.enum(['gap', 'risk', 'recommendation']),
  severity: z.enum(['critical', 'major', 'minor']),
  target: z.string().min(1),
  claim: z.string().min(1),
  evidence: z.string().min(1),
  proposal: z.string().min(1),
  tradeoff: z.string().min(1),
});

export const commercialSummarySchema = z.object({
  buyer: z.string().min(1),
  pays_today: z.string().min(1),
  pricing_model: z.string().min(1),
  revenue_range_estimate: z.string().min(1),
  defensibility: z.enum(['commodity', 'hard-to-copy', 'structurally-defensible']),
  moat_source: z.string().min(1),
  wedge: z.string().min(1),
  verdict: z.enum(['proceed', 'proceed-with-changes', 'reconsider-scope', 'do-not-build']),
});

export const reviewerSubmissionSchema = z.object({
  reviewer: z.string().min(1),
  target_document: z.string().min(1),
  contaminated: z.boolean(),
  findings: z.array(ringFindingSchema),
  no_findings_reason: z.string().optional(),
  commercial_summary: commercialSummarySchema.optional(),
});
export type ReviewerSubmission = z.infer<typeof reviewerSubmissionSchema>;

export const synthesisSchema = z.object({
  revised_prd_md: z.string().min(50),
  backlog: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      acceptance_criteria: z.array(z.string().min(1)).min(1),
      source_findings: z.array(z.string()),
      // Indices of sibling stories that must land first. An ordering hint,
      // not a contract: out-of-range indices, self-references, and cycles are
      // pruned at task creation rather than failing the ring.
      depends_on: z.array(z.number().int()).default([]),
    }),
  ),
  reconciliation: z.array(
    z.object({
      finding_ref: z.string().min(1),
      disposition: z.enum(['accepted', 'rejected', 'deferred']),
      reason: z.string().min(1),
      resulting_change: z.string().min(1),
    }),
  ),
  escalations: z.array(
    z.object({
      conflict: z.string().min(1),
      positions: z.array(z.object({ reviewer: z.string(), position: z.string() })).min(2),
      recommendation: z.string().min(1),
    }),
  ),
});
export type Synthesis = z.infer<typeof synthesisSchema>;

// ─── Role-skill lookup ────────────────────────────────────────────

/** Ring agent name → seeded role-skill name (H1 of docs/agent-roles/*.md). */
export const RING_ROLE_SKILL_BY_AGENT: Record<string, string> = {
  'PRD Auditor': 'PRD Auditor',
  'Flow Hardener': 'Flow Hardener',
  'Differentiation Strategist': 'Differentiation & Monetization Strategist',
  Synthesizer: 'Orchestrator',
};

export const CRITIQUE_PROTOCOL_SKILL_NAME = 'Critique Protocol';

export async function loadRingSkill(name: string, scope: 'role' | 'protocol'): Promise<string> {
  const row = await db.query.skills.findFirst({
    where: and(eq(skills.name, name), eq(skills.scope, scope), isNull(skills.projectId)),
  });
  if (!row?.contentMd) {
    throw new Error(
      `Ring skill "${name}" (scope ${scope}) is not seeded — run npm run db:seed after Phase 4 ports the roles`,
    );
  }
  return row.contentMd;
}

// ─── Context assembly (pure — the independence test inspects these) ──

const REVIEWER_OUTPUT_INSTRUCTIONS = `
## Output format (mandatory)

Return your complete submission as ONE fenced json code block and nothing else after it:

\`\`\`json
{
  "reviewer": "<your role name>",
  "target_document": "<task id>:prd",
  "contaminated": false,
  "findings": [
    {
      "type": "gap | risk | recommendation",
      "severity": "critical | major | minor",
      "target": "<story id, section name, or \\"prd:whole\\">",
      "claim": "<one sentence>",
      "evidence": "<from the PRD itself, or \\"unknown -- would need X\\">",
      "proposal": "<what a fix must accomplish>",
      "tradeoff": "<what accepting it costs>"
    }
  ],
  "no_findings_reason": "<only if findings is empty>",
  "commercial_summary": { "...": "only if your role defines one" }
}
\`\`\`

File at most 12 findings — prioritize the most consequential; fold or omit minor nits rather
than diluting the list. The synthesizer must account for every finding you file, so volume has
a real reconciliation cost.

Set "contaminated": true if another reviewer's findings were somehow present in this context.`;

export function buildRingReviewerContext(params: {
  reviewerName: string;
  roleSkillMd: string;
  protocolMd: string;
  prdMarkdown: string;
  prdRevision: number;
  task: Pick<Task, 'id' | 'title' | 'description'>;
  project: Pick<Project, 'name' | 'goal'> | null;
}): string {
  return [
    `You are the ${params.reviewerName}, one reviewer in an independent critique ring.`,
    'You are reviewing a document, not a codebase. You have no repository access and need none.',
    '',
    '## Your role',
    params.roleSkillMd,
    '',
    '## The critique protocol (your output contract)',
    params.protocolMd,
    '',
    '## Goal ancestry',
    params.project ? `Project: ${params.project.name}` : 'Project: (none)',
    params.project?.goal ? `Project goal: ${params.project.goal}` : '',
    `PRD task: ${params.task.title} (id ${params.task.id})`,
    params.task.description ? `Task context: ${params.task.description}` : '',
    '',
    `## The document under review — PRD revision ${params.prdRevision}`,
    '',
    params.prdMarkdown,
    REVIEWER_OUTPUT_INSTRUCTIONS.replace('<task id>', params.task.id),
  ]
    .filter((part) => part !== '')
    .join('\n');
}

const SYNTHESIZER_OUTPUT_INSTRUCTIONS = `
## Output format (mandatory)

Return ONE fenced json code block and nothing else after it:

\`\`\`json
{
  "revised_prd_md": "<the full revised PRD as markdown — the original with accepted findings incorporated>",
  "backlog": [
    {
      "title": "<user story title>",
      "description": "<story with who/what/why>",
      "acceptance_criteria": ["<testable criterion>", "..."],
      "source_findings": ["<reviewer>/<n>", "..."],
      "depends_on": [<indices of sibling stories that must land first>]
    }
  ],
  "reconciliation": [
    {
      "finding_ref": "<reviewer>/<n>",
      "disposition": "accepted | rejected | deferred",
      "reason": "<one sentence>",
      "resulting_change": "<what changed in the revised doc, or \\"none\\">"
    }
  ],
  "escalations": [
    {
      "conflict": "<one sentence>",
      "positions": [{ "reviewer": "<role>", "position": "<their argument, stated fairly>" }],
      "recommendation": "<your view, labeled as recommendation>"
    }
  ]
}
\`\`\`

Finding references use the exact form "<reviewer name>/<finding number>" with 1-based numbering
in each reviewer's submission order (e.g. "PRD Auditor/3"). EVERY finding from every reviewer
must appear in reconciliation exactly once — 100% accounting is asserted programmatically.

Order the backlog for a solo builder working one story at a time. Name each story's
prerequisites in "depends_on" as 0-based indices into the backlog array you are emitting
(a story that presumes code another story creates depends on it). Most stories should have
0-2 prerequisites; use [] for anything that can start immediately. Do not describe ordering
in prose alone — the indices are what the scheduler reads.`;

export function buildSynthesizerContext(params: {
  roleSkillMd: string;
  protocolMd: string;
  prdMarkdown: string;
  prdRevision: number;
  task: Pick<Task, 'id' | 'title' | 'description'>;
  project: Pick<Project, 'name' | 'goal'> | null;
  submissions: ReviewerSubmission[];
}): string {
  const submissionBlocks = params.submissions.map((submission) =>
    [
      `### Submission from ${submission.reviewer}`,
      `contaminated: ${submission.contaminated}`,
      ...submission.findings.map(
        (finding, index) =>
          `${submission.reviewer}/${index + 1}: [${finding.type}/${finding.severity}] target=${finding.target}\n` +
          `  claim: ${finding.claim}\n  evidence: ${finding.evidence}\n  proposal: ${finding.proposal}\n  tradeoff: ${finding.tradeoff}`,
      ),
      submission.findings.length === 0
        ? `(no findings — reason: ${submission.no_findings_reason ?? 'not given'})`
        : '',
      submission.commercial_summary
        ? `commercial_summary: ${JSON.stringify(submission.commercial_summary, null, 2)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return [
    'You are the Synthesizer for an independent critique ring. You alone read every submission.',
    '',
    '## Your role',
    params.roleSkillMd,
    '',
    '## The critique protocol — follow the Synthesizer Protocol section exactly',
    params.protocolMd,
    '',
    '## Goal ancestry',
    params.project ? `Project: ${params.project.name}` : 'Project: (none)',
    params.project?.goal ? `Project goal: ${params.project.goal}` : '',
    `PRD task: ${params.task.title} (id ${params.task.id})`,
    '',
    `## The original document — PRD revision ${params.prdRevision}`,
    '',
    params.prdMarkdown,
    '',
    '## Reviewer submissions',
    ...submissionBlocks,
    SYNTHESIZER_OUTPUT_INSTRUCTIONS,
  ]
    .filter((part) => part !== '')
    .join('\n');
}

export function contextSha256(context: string): string {
  return createHash('sha256').update(context).digest('hex');
}

// ─── JSON extraction ──────────────────────────────────────────────

/**
 * Extract the balanced JSON object starting at `start`. String- and
 * escape-aware, so fences or braces INSIDE JSON strings (e.g. a revised PRD
 * containing markdown code blocks) never truncate the candidate — the failure
 * mode of naive ```-to-``` regex matching.
 */
function extractBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJsonBlock(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    // Not bare JSON — scan for candidates.
  }

  // Candidate starts: the first '{' after each ```json (or bare ```) fence
  // opening, latest first (models sometimes emit a draft before the final
  // block), then the first '{' in the whole text as a last resort.
  const starts: number[] = [];
  const fenceRe = /```(?:json)?\s*\n/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    const braceIdx = text.indexOf('{', match.index + match[0].length);
    if (braceIdx !== -1) starts.push(braceIdx);
  }
  starts.reverse();
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1 && !starts.includes(firstBrace)) starts.push(firstBrace);

  for (const start of starts) {
    const candidate = extractBalancedObject(text, start);
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning
    }
  }
  throw new Error('No parseable JSON block found in model output');
}

// ─── Seat invocation ──────────────────────────────────────────────

export interface RingSeatResult {
  text: string;
  lane: 'cli' | 'ollama' | 'cloud';
  resolvedModelId: string;
  totalTokens: number;
  /** Metered cost only — CLI subscription and local lanes report 0. */
  totalCostUsd: string;
}

const RING_CLI_TIMEOUT_MS = 8 * 60 * 1000;

/**
 * Run one ring seat as a completion: CLI subscription lane first (no
 * workspace, no tools — §14.5), falling back to the agent's local-model
 * access when the lane is capped or the bridge is down.
 */
export async function invokeRingSeat(params: {
  agentRow: DbAgent;
  prompt: string;
  taskId: string;
  stepId: string;
  /** Override for seats whose single response is long (synthesizer). */
  timeoutMs?: number;
  /** Big-output seats should fall back to cloud, not a slow local model. */
  fallbackPreference?: 'local-first' | 'cloud-first';
}): Promise<RingSeatResult> {
  // Judgment seats are pinned to their configured lane (the CLI subscription
  // lane per the plan) — the router's local-first preference must not divert
  // them to a small local model. The router is only consulted for fallback.
  const configured = params.agentRow.modelConfigId
    ? await db.query.modelConfigs.findFirst({
        where: eq(modelConfigs.id, params.agentRow.modelConfigId),
      })
    : null;

  let attemptedCli = false;
  if (configured?.provider === 'cli' && configured.isAvailable) {
    attemptedCli = true;
    const cliModelId = configured.modelId;
    const cli = cliNameForModelId(cliModelId);
    let result: Awaited<ReturnType<typeof executeCliTask>> | null = null;
    try {
      result = await executeCliTask({
        // No workspacePath: the helper runs the CLI in its empty sandbox.
        cli,
        prompt: params.prompt,
        model: cliModelFlagForModelId(cliModelId),
        maxTurns: 12,
        timeoutMs: params.timeoutMs ?? RING_CLI_TIMEOUT_MS,
        allowedTools: [],
        permissionMode: 'default',
      });
    } catch (error) {
      // Only a genuine bridge/transport failure opens the lane cooldown — a
      // DB hiccup while logging must never discard a successful CLI result.
      setCliLaneCooldown(cli);
      console.warn(
        `[ring] CLI bridge unavailable for ${params.agentRow.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (result) {
      try {
        await logTaskEvent({
          taskId: params.taskId,
          agentId: params.agentRow.id,
          eventType: 'model_call',
          payload: {
            workflow_step_id: params.stepId,
            model: `cli/${cliModelId}`,
            lane: 'cli',
            total_tokens: result.usage?.totalTokens ?? 0,
            total_cost_usd: '0.000000',
            reported_cost_usd: result.reportedCostUsd,
            num_turns: result.numTurns,
            duration_ms: result.durationMs,
            error_kind: result.errorKind,
          },
          tokensUsed: result.usage?.totalTokens ?? 0,
          costUsd: '0.000000',
        });
      } catch (logError) {
        console.error('[ring] failed to log CLI model_call event:', logError);
      }

      if (result.ok && result.resultText.trim()) {
        return {
          text: result.resultText,
          lane: 'cli',
          resolvedModelId: `cli/${cliModelId}`,
          totalTokens: result.usage?.totalTokens ?? 0,
          totalCostUsd: '0.000000',
        };
      }

      if (isCliFailoverErrorKind(result.errorKind)) {
        setCliLaneCooldown(cli);
      }
      console.warn(
        `[ring] CLI seat failed (${result.errorKind ?? 'empty'}) for ${params.agentRow.name} — falling back`,
      );
    }
  }

  // Fallback: the agent's own non-CLI model access — local lane first, then
  // metered cloud (with real cost accounting) as the lane of last resort.
  const fallback = await resolveRingFallbackModel(params.agentRow, params.fallbackPreference ?? 'local-first');
  if (!fallback) {
    throw new Error(
      `Ring seat ${params.agentRow.name}: ${attemptedCli ? 'CLI lane failed and ' : ''}no non-CLI fallback model is accessible`,
    );
  }

  const agent = new Agent({
    id: `ring-${params.agentRow.id}`,
    name: params.agentRow.name,
    instructions:
      `You are ${params.agentRow.name}. Follow the instructions in the user message exactly. ` +
      'Do not ask questions; produce the requested output in full.',
    model: fallback.resolved.modelId,
  });

  const response = await agent.generate(params.prompt, {
    maxSteps: 1,
    // The synthesizer must re-emit the whole revised PRD inside the JSON
    // block, so the ceiling has to be generous.
    modelSettings: { maxOutputTokens: 16384 },
    abortSignal: AbortSignal.timeout(params.timeoutMs ?? RING_CLI_TIMEOUT_MS),
  });

  const usage = response.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? inputTokens + outputTokens;
  const lane = fallback.resolved.provider === 'ollama' ? 'ollama' : 'cloud';

  // Metered lanes bill for real — account for it so budget enforcement sees it.
  let costUsd = '0.000000';
  if (lane === 'cloud') {
    const rates = await getModelCostRates({
      modelConfigId: fallback.configId,
      resolvedModelId: fallback.resolved.resolvedModelId,
    });
    costUsd = estimateCostUsd(inputTokens, outputTokens, rates.inputCostPerToken, rates.outputCostPerToken);
  }

  await logTaskEvent({
    taskId: params.taskId,
    agentId: params.agentRow.id,
    eventType: 'model_call',
    payload: {
      workflow_step_id: params.stepId,
      model: fallback.resolved.resolvedModelId,
      lane,
      total_tokens: totalTokens,
      total_cost_usd: costUsd,
      fallback_from_cli: attemptedCli,
    },
    tokensUsed: totalTokens,
    costUsd,
  });

  return {
    text: response.text,
    lane,
    resolvedModelId: fallback.resolved.resolvedModelId,
    totalTokens,
    totalCostUsd: costUsd,
  };
}

async function resolveRingFallbackModel(
  agentRow: DbAgent,
  preference: 'local-first' | 'cloud-first' = 'local-first',
) {
  const accessRows = await db
    .select({ modelConfigId: agentModelAccess.modelConfigId })
    .from(agentModelAccess)
    .where(eq(agentModelAccess.agentId, agentRow.id));
  if (accessRows.length === 0) return null;

  const configs = await db.query.modelConfigs.findMany({
    where: and(
      inArray(modelConfigs.id, accessRows.map((row) => row.modelConfigId)),
      eq(modelConfigs.isAvailable, true),
    ),
  });

  const local = configs.filter((config) => config.provider === 'ollama');
  const cloud = configs.filter((config) => config.provider !== 'ollama' && config.provider !== 'cli');
  // Local first by default (free); cloud-first for seats whose long single
  // response would crawl on a local model.
  const ordered = preference === 'cloud-first' ? [...cloud, ...local] : [...local, ...cloud];

  for (const config of ordered) {
    const resolved = await resolveModel(config.id, undefined, agentRow.id);
    if (resolved.provider !== 'cli') {
      return { resolved, configId: config.id };
    }
  }
  return null;
}

export async function getRingAgentRow(name: string): Promise<DbAgent> {
  const row = await db.query.agents.findFirst({
    where: and(eq(agents.name, name), eq(agents.agentKind, 'runtime'), isNull(agents.projectId)),
  });
  if (!row) {
    throw new Error(`Ring agent "${name}" not found — run npm run db:seed`);
  }
  return row;
}
