import { createStep } from '@mastra/core/workflows';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import {
  modelConfigs,
  projects,
  taskEvents,
  tasks,
  type Agent as DbAgent,
  type Task,
} from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from '@/lib/mastra/agent-factory';
import { getRuntimeAgentRow } from '@/lib/mastra/agents/runtime-agent-db';
import { getFallbackModelForTier, isRouterModelAvailable } from '@/lib/mastra/router';
import {
  executeCliTask,
  readWorkspaceFile,
  runWorkspaceCommand,
} from '@/lib/helper/client';
import {
  cliModelFlagForModelId,
  cliNameForModelId,
  isCliFailoverErrorKind,
  setCliLaneCooldown,
} from '@/lib/orchestration/cli-lane';
import { extractTaskSearchTerms } from '@/lib/orchestration/low-risk-discovery';
import {
  buildImplementationAudit,
  extractLikelyFilesFromText,
} from '@/lib/orchestration/implementation-audit';
import { tierRank, normalizeTier, type ExecutionTier } from '@/lib/orchestration/model-selection';
import {
  getTaskExecutionPolicy,
  normalizeRelativePath,
} from '@/lib/orchestration/task-shape';
import { eq } from 'drizzle-orm';
import { createWorkflowStepTelemetry } from './agent-telemetry';
import { approvedTaskSchema, implementedTaskSchema } from './shared';

const RETRY_SNIPPET_CONTEXT_LINES = 14;
const RETRY_SNIPPET_MAX_PER_FILE = 2;
const RETRY_SNIPPET_MAX_FILES = 2;
const RETRY_SNIPPET_CHAR_BUDGET = 7000;

/**
 * Deterministically extract the exact file regions that match the task terms
 * so a no-edit retry does not depend on the model exploring the repository.
 * The snippets contain verbatim file content suitable for apply_diff searchText.
 */
async function buildRetryContextSnippets(params: {
  workspacePath: string;
  likelyFiles: string[];
  task: Task;
}): Promise<string> {
  const searchTerms = extractTaskSearchTerms(params.task);
  if (searchTerms.length === 0) {
    return '';
  }

  const sections: string[] = [];
  let usedChars = 0;

  for (const relativePath of params.likelyFiles.slice(0, RETRY_SNIPPET_MAX_FILES)) {
    let content: string;
    try {
      ({ content } = await readWorkspaceFile({
        workspacePath: params.workspacePath,
        relativePath,
      }));
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const matchedLineIndexes: number[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const lower = lines[i].toLowerCase();
      if (searchTerms.some((term) => lower.includes(term))) {
        matchedLineIndexes.push(i);
      }
    }

    // Merge nearby matches into regions.
    const regions: Array<[number, number]> = [];
    for (const index of matchedLineIndexes) {
      const start = Math.max(0, index - RETRY_SNIPPET_CONTEXT_LINES);
      const end = Math.min(lines.length - 1, index + RETRY_SNIPPET_CONTEXT_LINES);
      const last = regions[regions.length - 1];
      if (last && start <= last[1] + 2) {
        last[1] = end;
      } else {
        regions.push([start, end]);
      }
    }

    for (const [start, end] of regions.slice(0, RETRY_SNIPPET_MAX_PER_FILE)) {
      const snippet = lines.slice(start, end + 1).join('\n');
      const section = `File: ${relativePath} (lines ${start + 1}-${end + 1})\n<<<\n${snippet}\n>>>`;
      if (usedChars + section.length > RETRY_SNIPPET_CHAR_BUDGET) {
        break;
      }
      usedChars += section.length;
      sections.push(section);
    }
  }

  return sections.join('\n\n');
}

const FEEDBACK_EVENT_LOOKBACK = 40;
const FEEDBACK_SUMMARY_MAX_CHARS = 1500;

/**
 * On rework attempts, surface the previous attempt's reviewer findings and
 * blocking verification failures so the implementer addresses them instead of
 * repeating the same change blind.
 */
async function buildPriorAttemptFeedback(taskId: string): Promise<string> {
  const events = await db.query.taskEvents.findMany({
    where: eq(taskEvents.taskId, taskId),
    orderBy: (e, { desc }) => [desc(e.createdAt)],
    limit: FEEDBACK_EVENT_LOOKBACK,
  });

  const parts: string[] = [];

  const reworkReview = events.find((event) => {
    if (event.eventType !== 'review') return false;
    const payload = event.payload as { status?: string } | null;
    return payload?.status === 'needs_rework';
  });
  if (reworkReview) {
    const payload = reworkReview.payload as { findings?: unknown };
    const findings =
      typeof payload.findings === 'string' ? payload.findings : '';
    if (findings) {
      parts.push(
        `Reviewer findings from the previous attempt:\n${findings.slice(0, FEEDBACK_SUMMARY_MAX_CHARS)}`,
      );
    }
  }

  const failedVerification = events.find((event) => {
    if (event.eventType !== 'verification') return false;
    const payload = event.payload as { status?: string } | null;
    return payload?.status === 'fail';
  });
  if (failedVerification) {
    const payload = failedVerification.payload as {
      blocking_failures?: Array<{ gate?: string; summary?: string }>;
    };
    const blocking = payload.blocking_failures ?? [];
    if (blocking.length > 0) {
      parts.push(
        `Blocking verification failures from the previous attempt:\n${blocking
          .map((failure) => `- ${failure.gate}: ${(failure.summary ?? '').slice(0, 300)}`)
          .join('\n')}`,
      );
    }
  }

  return parts.join('\n\n');
}

function emptyImplementationAudit() {
  return {
    changedFiles: [],
    sourceFilesChanged: [],
    outOfScopeChanges: [],
    hasMeaningfulSourceDiff: false,
    diffSummary: 'Implementation did not run.',
  };
}

function parseGitStatus(stdout: string): Array<{ filePath: string; status: string }> {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\?\?|[ MADRCU]{1,2})\s+(.*)$/);
      const status = match?.[1]?.trim() ?? line.slice(0, 2).trim();
      const rawPath = match?.[2]?.trim() ?? line.slice(3).trim();
      const filePath = rawPath.includes(' -> ')
        ? rawPath.split(' -> ').pop() ?? rawPath
        : rawPath;

      return {
        filePath: normalizeRelativePath(filePath),
        status,
      };
    });
}

async function captureWorkspaceSnapshot(workspacePath: string) {
  const statusResult = await runWorkspaceCommand({
    workspacePath,
    command: 'git',
    args: ['status', '--short'],
  });

  if (statusResult.exitCode !== 0) {
    throw new Error(statusResult.stderr || 'Unable to read workspace git status');
  }

  const entries = parseGitStatus(statusResult.stdout);
  const snapshot = new Map<string, string>();

  for (const entry of entries) {
    if (entry.status === '??') {
      snapshot.set(entry.filePath, 'untracked');
      continue;
    }

    const diffResult = await runWorkspaceCommand({
      workspacePath,
      command: 'git',
      args: ['diff', '--', entry.filePath],
    });
    const hash = createHash('sha1').update(diffResult.stdout).digest('hex');
    snapshot.set(entry.filePath, `${entry.status}:${hash}`);
  }

  return snapshot;
}

function diffSnapshotChangedFiles(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const changedFiles = new Set<string>();

  for (const filePath of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(filePath) !== after.get(filePath)) {
      changedFiles.add(filePath);
    }
  }

  return [...changedFiles].sort();
}

/**
 * Timeout (ms) for one Ollama generation call before triggering cloud fallback.
 * The abort covers the entire multi-step tool-calling loop, so it must allow
 * for several model iterations on large local models (30B-class models can
 * take 30s+ per iteration).
 */
const OLLAMA_GENERATION_TIMEOUT_MS = Number(
  process.env.VELA_OLLAMA_TIMEOUT_MS || '300000',
);

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return false;
}

function isRetryableProviderError(error: unknown): boolean {
  if (isAbortError(error)) {
    return true;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as {
    isRetryable?: unknown;
    statusCode?: unknown;
  };
  if (record.isRetryable === true) {
    return true;
  }

  return [408, 409, 423, 429, 500, 502, 503, 504, 524].includes(
    typeof record.statusCode === 'number' ? record.statusCode : -1,
  );
}

async function getFallbackTierForTask(
  task: Task,
  dbAgent: DbAgent,
): Promise<string> {
  const executionPolicy = getTaskExecutionPolicy(task);
  if (executionPolicy.isLowRiskFeature) {
    return executionPolicy.classification.recommendedTier;
  }

  if (!dbAgent.modelConfigId) {
    return 'standard';
  }

  const config = await db.query.modelConfigs.findFirst({
    where: eq(modelConfigs.id, dbAgent.modelConfigId),
  });

  return config?.tier ?? 'standard';
}

/**
 * One CLI-lane implementation attempt: hand the task to a subscription coding
 * CLI running inside the workspace via the helper. Returns ok=false (after
 * opening the lane cooldown where appropriate) so the caller fails over to a
 * metered API model.
 */
async function runCliImplementationAttempt(params: {
  task: Task;
  implementer: DbAgent;
  cliPrompt: string;
  workspacePath: string;
  resolvedModelId: string | null;
}): Promise<{
  ok: boolean;
  responseText: string;
  failureReason: string;
  usage: { totalTokens: number; totalCostUsd: string };
}> {
  const cliModelId = (params.resolvedModelId ?? 'cli/claude-code').split('/')[1] ?? 'claude-code';
  const cli = cliNameForModelId(cliModelId);
  const emptyUsage = { totalTokens: 0, totalCostUsd: '0.000000' };

  try {
    const result = await executeCliTask({
      workspacePath: params.workspacePath,
      cli,
      prompt: params.cliPrompt,
      model: cliModelFlagForModelId(cliModelId),
    });

    await logTaskEvent({
      taskId: params.task.id,
      agentId: params.implementer.id,
      eventType: 'model_call',
      payload: {
        workflow_step_id: 'implement-task',
        model: `cli/${cliModelId}`,
        lane: 'cli',
        total_tokens: result.usage?.totalTokens ?? 0,
        // Subscription execution: no metered cost. The CLI's own estimate is
        // kept for observability only.
        total_cost_usd: '0.000000',
        reported_cost_usd: result.reportedCostUsd,
        num_turns: result.numTurns,
        duration_ms: result.durationMs,
        error_kind: result.errorKind,
      },
      tokensUsed: result.usage?.totalTokens ?? 0,
      costUsd: '0.000000',
    });

    const usage = {
      totalTokens: result.usage?.totalTokens ?? 0,
      totalCostUsd: '0.000000',
    };

    if (result.ok) {
      return { ok: true, responseText: result.resultText, failureReason: '', usage };
    }

    if (isCliFailoverErrorKind(result.errorKind)) {
      setCliLaneCooldown(cli);
    }

    return {
      ok: false,
      responseText: '',
      failureReason: `CLI ${cli} failed (${result.errorKind ?? 'error'}): ${(result.resultText || result.rawOutput).slice(0, 300)}`,
      usage,
    };
  } catch (error) {
    // Helper unreachable or transport failure — cool the lane down so the
    // router skips CLI candidates until the bridge recovers.
    setCliLaneCooldown(cli);
    return {
      ok: false,
      responseText: '',
      failureReason: `CLI ${cli} bridge unavailable: ${error instanceof Error ? error.message : String(error)}`,
      usage: emptyUsage,
    };
  }
}

async function generateImplementationWithFallback(params: {
  implementer: DbAgent;
  task: Task;
  prompt: string;
  cliPrompt: string;
  workspacePath: string;
  maxSteps: number;
  maxOutputTokens: number;
  executionPolicy: ReturnType<typeof getTaskExecutionPolicy>;
  stepTierFloor?: ExecutionTier;
  temperature?: number;
}) {
  let activeAgent = await createMastraAgent(params.implementer, params.task, undefined, params.stepTierFloor);
  let activeModelConfigId = params.implementer.modelConfigId;
  let usageTotals = { totalTokens: 0, totalCostUsd: '0.000000' };

  while (true) {
    // CLI lane: whole-attempt execution via the helper bridge, with automatic
    // failover to a metered API model when the lane is capped or unreachable.
    if (activeAgent.provider === 'cli') {
      const cliOutcome = await runCliImplementationAttempt({
        task: params.task,
        implementer: params.implementer,
        cliPrompt: params.cliPrompt,
        workspacePath: params.workspacePath,
        resolvedModelId: activeAgent.resolvedModelId,
      });
      usageTotals = {
        totalTokens: usageTotals.totalTokens + cliOutcome.usage.totalTokens,
        totalCostUsd: (
          parseFloat(usageTotals.totalCostUsd) + parseFloat(cliOutcome.usage.totalCostUsd)
        ).toFixed(6),
      };

      if (cliOutcome.ok) {
        return {
          responseText: cliOutcome.responseText,
          provider: 'cli',
          resolvedModelId: activeAgent.resolvedModelId,
          usageTotals,
        };
      }

      let fallbackTier = await getFallbackTierForTask(params.task, params.implementer);
      if (params.stepTierFloor && tierRank(params.stepTierFloor) > tierRank(normalizeTier(fallbackTier))) {
        fallbackTier = params.stepTierFloor;
      }
      const fallbackModel = getFallbackModelForTier(fallbackTier, params.task.priority);

      if (!(await isRouterModelAvailable(fallbackModel))) {
        await logTaskEvent({
          taskId: params.task.id,
          agentId: params.implementer.id,
          eventType: 'error',
          payload: {
            message: `CLI lane failed (${cliOutcome.failureReason}) and cloud fallback ${fallbackModel} is disabled in model configs — not falling back.`,
            configured_model: activeAgent.resolvedModelId,
            fallback_model: fallbackModel,
          },
        });
        throw new Error(cliOutcome.failureReason);
      }

      await logTaskEvent({
        taskId: params.task.id,
        agentId: params.implementer.id,
        eventType: 'model_fallback',
        payload: {
          configured_model: activeAgent.resolvedModelId,
          fallback_model: fallbackModel,
          reason: cliOutcome.failureReason,
          selection_kind: 'cloud_fallback',
          fallback_tier: fallbackTier,
        },
      });

      activeAgent = await createMastraAgent(params.implementer, params.task, fallbackModel);
      activeModelConfigId = null;
      continue;
    }
    const telemetry = createWorkflowStepTelemetry({
      taskId: params.task.id,
      agentId: params.implementer.id,
      stepId: 'implement-task',
      modelConfigId: activeModelConfigId,
      resolvedModelId: activeAgent.resolvedModelId ?? activeAgent.provider,
      budget:
        activeAgent.provider === 'ollama' ? null : params.executionPolicy.implementerBudget,
      requireEditByIteration: 3,
      maxSteps: params.maxSteps,
    });

    try {
      // For Ollama (local) models, add a generation timeout so slow models
      // fail fast and trigger cloud fallback instead of hanging indefinitely.
      const abortSignal =
        activeAgent.provider === 'ollama'
          ? AbortSignal.any([
              telemetry.abortSignal,
              AbortSignal.timeout(OLLAMA_GENERATION_TIMEOUT_MS),
            ])
          : telemetry.abortSignal;

      const response = await activeAgent.agent.generate(params.prompt, {
        maxSteps: params.maxSteps,
        modelSettings: {
          maxOutputTokens: params.maxOutputTokens,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
        onStepFinish: telemetry.onStepFinish,
        onIterationComplete: telemetry.onIterationComplete,
        abortSignal,
      });
      const stepUsage = telemetry.getUsageTotals();
      usageTotals = {
        totalTokens: usageTotals.totalTokens + stepUsage.totalTokens,
        totalCostUsd: (
          parseFloat(usageTotals.totalCostUsd) + parseFloat(stepUsage.totalCostUsd)
        ).toFixed(6),
      };

      // Detect empty responses (no text AND no tool calls) — common with
      // Ollama models that don't handle tool-calling properly.  Treat as a
      // retryable provider error so the fallback logic below picks a cloud model.
      const hasText = (response.text ?? '').trim().length > 0;
      const hasToolCalls =
        (response.steps ?? []).some(
          (s: { toolCalls?: unknown[] }) => (s.toolCalls?.length ?? 0) > 0,
        );

      if (!hasText && !hasToolCalls && activeAgent.provider === 'ollama' && activeModelConfigId !== null) {
        const emptyReason = 'Ollama model returned empty response with no tool calls';
        console.warn(`[implement] ${emptyReason} — triggering cloud fallback`);

        await logTaskEvent({
          taskId: params.task.id,
          agentId: params.implementer.id,
          eventType: 'model_fallback',
          payload: {
            configured_model: activeAgent.resolvedModelId,
            reason: emptyReason,
            selection_kind: 'empty_response_fallback',
          },
        });

        // Fall through to the fallback path below
        throw Object.assign(new Error(emptyReason), { isRetryable: true });
      }

      return {
        responseText: response.text,
        provider: activeAgent.provider,
        resolvedModelId: activeAgent.resolvedModelId,
        usageTotals,
      };
    } catch (error) {
      const stepUsage = telemetry.getUsageTotals();
      usageTotals = {
        totalTokens: usageTotals.totalTokens + stepUsage.totalTokens,
        totalCostUsd: (
          parseFloat(usageTotals.totalCostUsd) + parseFloat(stepUsage.totalCostUsd)
        ).toFixed(6),
      };

      const budgetStopReason = telemetry.getBudgetStopReason();
      if (budgetStopReason) {
        return {
          responseText: `Implementation stopped early: ${budgetStopReason}`,
          provider: activeAgent.provider,
          resolvedModelId: activeAgent.resolvedModelId,
          usageTotals,
        };
      }

      if (
        activeAgent.provider !== 'ollama' ||
        activeModelConfigId === null ||
        !isRetryableProviderError(error)
      ) {
        throw error;
      }

      let fallbackTier = await getFallbackTierForTask(params.task, params.implementer);
      if (params.stepTierFloor && tierRank(params.stepTierFloor) > tierRank(normalizeTier(fallbackTier))) {
        fallbackTier = params.stepTierFloor;
      }
      const fallbackModel = getFallbackModelForTier(fallbackTier, params.task.priority);
      const reason = error instanceof Error ? error.message : String(error);

      if (!(await isRouterModelAvailable(fallbackModel))) {
        await logTaskEvent({
          taskId: params.task.id,
          agentId: params.implementer.id,
          eventType: 'error',
          payload: {
            message: `Local model failed (${reason}) and cloud fallback ${fallbackModel} is disabled in model configs — not falling back.`,
            configured_model: activeAgent.resolvedModelId,
            fallback_model: fallbackModel,
          },
        });
        throw error;
      }

      await logTaskEvent({
        taskId: params.task.id,
        agentId: params.implementer.id,
        eventType: 'model_fallback',
        payload: {
          configured_model: activeAgent.resolvedModelId,
          fallback_model: fallbackModel,
          reason,
          selection_kind: 'cloud_fallback',
          fallback_tier: fallbackTier,
        },
      });

      activeAgent = await createMastraAgent(params.implementer, params.task, fallbackModel);
      activeModelConfigId = null;
    }
  }
}

export const implementTaskStep = createStep({
  id: 'implement-task',
  inputSchema: approvedTaskSchema,
  outputSchema: implementedTaskSchema,
  execute: async ({ inputData }) => {
    if (inputData.approval.status === 'requested') {
      return {
        ...inputData,
        implementationSummary: '',
        implementerModel: null,
        implementationAudit: emptyImplementationAudit(),
      };
    }

    const [task, implementer] = await Promise.all([
      db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) }),
      getRuntimeAgentRow('Implementer'),
    ]);

    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    if (!implementer) {
      throw new Error('Runtime Implementer agent not found');
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, task.projectId),
    });
    if (!project?.workspacePath) {
      throw new Error(`Project ${task.projectId} does not have a connected workspace`);
    }

    const executionPolicy = getTaskExecutionPolicy(task);
    const beforeSnapshot = await captureWorkspaceSnapshot(project.workspacePath);
    const priorFeedback =
      task.failureCount > 0 ? await buildPriorAttemptFeedback(task.id) : '';
    const prompt = `Execute this implementation plan for the current task.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}
Workflow: ${inputData.workflowSelection.workflowId}

Plan:
${inputData.planText}

${inputData.repoMap?.summary ? `Repo map:\n${inputData.repoMap.summary}\n` : ''}
${priorFeedback ? `This is a rework attempt (${task.failureCount} prior failure(s)). A previous attempt was rejected — address this feedback directly. If the previous change is still present in the workspace, fix or extend it rather than re-applying it:\n\n${priorFeedback}\n` : ''}
Requirements:
- make the necessary repository changes
- you have a limited step budget: locate the target with at most 2-3 reads, then immediately make your first edit (apply_diff for small changes, write_workspace_file for new or fully rewritten files)
- use startLine/maxLines to read only the relevant section of large files
- run focused commands as needed while implementing
- do not finalize the task status; verification happens after you finish
- end with a concise summary of what changed and any residual risks`;

    // CLI-lane prompt: same task and plan, but phrased for a coding CLI that
    // has its own native tools (no Vela tool vocabulary).
    const cliPrompt = `${task.title}

${task.description ?? ''}

Implementation plan:
${inputData.planText}
${priorFeedback ? `\nThis is a rework attempt. A previous attempt was rejected — address this feedback directly:\n${priorFeedback}\n` : ''}
Constraints:
- Make the code changes needed to complete this task; keep edits minimal and scoped to the plan.
- Do NOT commit or push; leave all changes uncommitted in the working tree.
- Do not fix unrelated lint or build issues.
- End with a concise summary of what you changed and any residual risks.`;

    const maxSteps = Math.min(
      implementer.maxIterations ?? executionPolicy.maxSteps.implement,
      executionPolicy.maxSteps.implement,
    );
    let generation = await generateImplementationWithFallback({
      implementer,
      task,
      prompt,
      cliPrompt,
      workspacePath: project.workspacePath,
      maxSteps,
      maxOutputTokens: executionPolicy.maxOutputTokens.implement,
      executionPolicy,
      stepTierFloor: executionPolicy.stepTierFloors.implement,
    });
    let responseText = generation.responseText;

    let afterSnapshot = await captureWorkspaceSnapshot(project.workspacePath);
    let changedFiles = diffSnapshotChangedFiles(beforeSnapshot, afterSnapshot);

    // Local models sometimes burn the whole step budget on exploration and
    // stop without editing. One focused retry with an edit-only directive
    // recovers most of these runs deterministically.
    if (changedFiles.length === 0) {
      await logTaskEvent({
        taskId: task.id,
        agentId: implementer.id,
        eventType: 'message',
        payload: {
          role: 'system',
          content:
            'First implementation attempt made no file edits; retrying once with an edit-only directive.',
        },
      });

      const retrySnippets = await buildRetryContextSnippets({
        workspacePath: project.workspacePath,
        likelyFiles: inputData.repoMap?.likelyFiles ?? [],
        task,
      });

      const retryPrompt = `Your previous attempt explored the repository but made NO file edits. This is your final attempt.

Task title: ${task.title}
Task description: ${task.description ?? '(none)'}

Plan:
${inputData.planText}

${retrySnippets ? `The exact target regions have already been located for you. The content between <<< and >>> is verbatim file content — copy searchText for apply_diff from it EXACTLY:\n\n${retrySnippets}\n` : inputData.repoMap?.likelyFiles?.length ? `Most likely target files (in priority order):\n${inputData.repoMap.likelyFiles.map((f) => `- ${f}`).join('\n')}\n` : ''}
Rules for this attempt:
- Do NOT use search_workspace or run_workspace_command.
${retrySnippets ? '- Do NOT read any files — the snippets above contain everything you need. Your FIRST tool call must be apply_diff.' : '- Read at most ONE file (use startLine/maxLines for large files) to confirm the exact target text, then immediately edit.'}
- Make the smallest correct edit with apply_diff. Use write_workspace_file ONLY to create a brand-new file — never to rewrite an existing one from memory.
- EXCEPTION: if the requested change is ALREADY fully present in the file content you see (e.g. a previous attempt applied it and it was left uncommitted), do NOT invent a different edit and do NOT rewrite the file. Respond with the exact phrase TASK_ALREADY_SATISFIED followed by one sentence naming the file(s) that already contain the change.
- Otherwise, ending your turn without calling apply_diff or write_workspace_file is a hard failure.`;

      const retryCliPrompt = `A previous attempt at this task made no file edits — you MUST produce the required edit this time.

${task.title}

${task.description ?? ''}

Implementation plan:
${inputData.planText}

Constraints:
- Make the smallest correct edit that completes the task.
- Do NOT commit or push; leave all changes uncommitted.
- Finishing without editing any file is a hard failure.`;

      const retryGeneration = await generateImplementationWithFallback({
        implementer,
        task,
        prompt: retryPrompt,
        cliPrompt: retryCliPrompt,
        workspacePath: project.workspacePath,
        maxSteps: Math.min(maxSteps, 6),
        maxOutputTokens: executionPolicy.maxOutputTokens.implement,
        executionPolicy,
        stepTierFloor: executionPolicy.stepTierFloors.implement,
        // The retry is a directive, not an exploration — keep it deterministic.
        temperature: 0.1,
      });

      generation = {
        ...retryGeneration,
        usageTotals: {
          totalTokens:
            generation.usageTotals.totalTokens + retryGeneration.usageTotals.totalTokens,
          totalCostUsd: (
            parseFloat(generation.usageTotals.totalCostUsd) +
            parseFloat(retryGeneration.usageTotals.totalCostUsd)
          ).toFixed(6),
        },
      };
      responseText = retryGeneration.responseText;
      afterSnapshot = await captureWorkspaceSnapshot(project.workspacePath);
      changedFiles = diffSnapshotChangedFiles(beforeSnapshot, afterSnapshot);
    }

    // A rework attempt may find the workspace already satisfies the task —
    // a previous attempt's uncommitted edits are still in place. Accept the
    // pre-existing changes in task-relevant files as the implementation so
    // the audit judges actual workspace state instead of failing on "no diff".
    if (changedFiles.length === 0 && responseText.includes('TASK_ALREADY_SATISFIED')) {
      const targets = extractLikelyFilesFromText(
        `${task.title}\n${task.description ?? ''}\n${inputData.planText}\n${(inputData.repoMap?.likelyFiles ?? []).join('\n')}`,
      );
      changedFiles = [...beforeSnapshot.keys()]
        .filter((filePath) =>
          targets.some(
            (target) =>
              filePath === target ||
              filePath.endsWith(`/${target}`) ||
              target.endsWith(`/${filePath}`),
          ),
        )
        .sort();
    }

    const implementationAudit = buildImplementationAudit({
      changedFiles,
      planText: inputData.planText,
      repoMapLikelyFiles: inputData.repoMap?.likelyFiles,
      taskText: `${task.title}\n${task.description ?? ''}`,
    });
    await logTaskEvent({
      taskId: task.id,
      agentId: implementer.id,
      eventType: 'implementation_audit',
      payload: implementationAudit,
    });

    await logTaskEvent({
      taskId: task.id,
      agentId: implementer.id,
      eventType: 'message',
      payload: {
        role: 'agent',
        content: responseText,
      },
    });

    return {
      ...inputData,
      implementationSummary: responseText,
      implementerModel: generation.resolvedModelId ?? generation.provider,
      implementationAudit,
      usage: {
        totalTokens: inputData.usage.totalTokens + generation.usageTotals.totalTokens,
        totalCostUsd: (
          parseFloat(inputData.usage.totalCostUsd) + parseFloat(generation.usageTotals.totalCostUsd)
        ).toFixed(6),
      },
    };
  },
});
