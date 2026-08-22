import { logTaskEvent } from '@/lib/events/logger';
import { estimateCostUsd, getModelCostRates } from '@/lib/mastra/costs';
import { extractToolCallMeta } from '@/lib/mastra/tool-call-meta';
import { LoopTracker, LoopDetectedError } from '@/lib/governance/loop-detector';

/** Wall-clock ceiling per LLM workflow step; the helper owns CLI child
 *  lifetimes separately. Overridable per deployment via env. */
const DEFAULT_STEP_WALL_CLOCK_MS = Number(
  process.env.VELA_STEP_WALL_CLOCK_MS ?? 10 * 60 * 1000,
);

interface StepLike {
  text?: string;
  finishReason?: string;
  toolCalls?: Array<Record<string, unknown>>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

const EDIT_TOOL_NAMES = new Set(['write_workspace_file', 'apply_diff']);

/**
 * Run an agent generation and surface loop aborts as LoopDetectedError
 * whether the aborted generate() returns partial output or throws.
 */
export async function generateWithLoopCheck<T>(
  telemetry: { throwIfLoopDetected: () => void; complete?: () => void },
  generate: () => Promise<T>,
): Promise<T> {
  try {
    const result = await generate();
    telemetry.throwIfLoopDetected();
    return result;
  } catch (error) {
    telemetry.throwIfLoopDetected();
    throw error;
  } finally {
    // Disarm containment timers — the generation is over either way.
    telemetry.complete?.();
  }
}

export function createWorkflowStepTelemetry(params: {
  taskId: string;
  agentId: string;
  stepId: string;
  modelConfigId?: string | null;
  resolvedModelId: string;
  budget?:
    | {
        maxTokens: number;
        maxCostUsd: number;
      }
    | null;
  /**
   * When set, inject corrective feedback if the agent has not called an edit
   * tool by this iteration. Keeps small local models from exhausting their
   * step budget on exploration.
   */
  requireEditByIteration?: number;
  maxSteps?: number;
  /** Identical tool+input calls tolerated before the run is stopped. */
  loopThreshold?: number;
  /** Wall-clock ceiling for this step's agent loop; 0 disables. */
  maxWallClockMs?: number;
}) {
  const controller = new AbortController();
  const ratesPromise = getModelCostRates({
    modelConfigId: params.modelConfigId,
    resolvedModelId: params.resolvedModelId,
  });
  let totalTokens = 0;
  let totalCostUsd = 0;
  let iteration = 0;
  let budgetStopReason: string | null = null;
  let lastFinishReason: string | null = null;
  let truncationCount = 0;
  let hasCalledEditTool = false;
  const seenToolCallIds = new Set<string>();

  // Loop governance for the workflow path: the legacy path tracks tool-call
  // signatures in the heartbeat runner, but workflow steps run their own
  // agent loops, so the tracker lives here and aborts the generation.
  const loopTracker = new LoopTracker(params.loopThreshold ?? 3);
  let loopError: LoopDetectedError | null = null;

  // Wall-clock containment: a non-terminating agent loop is aborted at the
  // boundary regardless of tokens or iterations. The timer MUST be disarmed
  // when the generation ends — a fire-after-completion is a ghost timeout
  // event for a run that finished fine (this spammed #errors in production).
  let wallClockStopReason: string | null = null;
  let finished = false;
  let wallClockTimer: NodeJS.Timeout | null = null;
  const wallClockMs = params.maxWallClockMs ?? DEFAULT_STEP_WALL_CLOCK_MS;
  if (wallClockMs > 0) {
    wallClockTimer = setTimeout(() => {
      if (finished || controller.signal.aborted) return;
      wallClockStopReason = `Wall-clock ceiling reached after ${wallClockMs}ms in step ${params.stepId}.`;
      void logTaskEvent({
        taskId: params.taskId,
        agentId: params.agentId,
        eventType: 'error',
        payload: {
          workflow_step_id: params.stepId,
          kind: 'wall_clock_timeout',
          limit_ms: wallClockMs,
          iteration,
          model: params.resolvedModelId,
        },
      });
      controller.abort();
    }, wallClockMs);
    wallClockTimer.unref?.();
  }

  return {
    abortSignal: controller.signal,
    /** Disarm containment timers — call when the generation has ended. */
    complete() {
      finished = true;
      if (wallClockTimer) {
        clearTimeout(wallClockTimer);
        wallClockTimer = null;
      }
    },
    async onStepFinish(stepEvent: unknown) {
      const step = (stepEvent ?? {}) as StepLike;
      iteration += 1;
      const inputTokens = step.usage?.inputTokens ?? 0;
      const outputTokens = step.usage?.outputTokens ?? 0;
      const stepTokens = step.usage?.totalTokens ?? inputTokens + outputTokens;
      totalTokens += stepTokens;

      const rates = await ratesPromise;
      const stepCostUsd = parseFloat(
        estimateCostUsd(
          inputTokens,
          outputTokens,
          rates.inputCostPerToken,
          rates.outputCostPerToken,
        ),
      );
      totalCostUsd += stepCostUsd;

      const normalizedToolCalls = (step.toolCalls ?? [])
        .map((toolCall) => {
          const meta = extractToolCallMeta(toolCall);
          return {
            id: meta.toolCallId,
            name: meta.toolName,
            args:
              meta.toolInput &&
              typeof meta.toolInput === 'object' &&
              !Array.isArray(meta.toolInput)
                ? (meta.toolInput as Record<string, unknown>)
                : meta.toolInput === undefined
                  ? {}
                  : { value: meta.toolInput },
          };
        })
        .filter((toolCall) => {
          if (toolCall.name === 'unknown' && toolCall.id === null) {
            return false;
          }

          if (toolCall.id && seenToolCallIds.has(toolCall.id)) {
            return false;
          }

          if (toolCall.id) {
            seenToolCallIds.add(toolCall.id);
          }

          return true;
        });

      await Promise.all([
        ...normalizedToolCalls.map((toolCall) =>
          logTaskEvent({
            taskId: params.taskId,
            agentId: params.agentId,
            eventType: 'tool_call',
            payload: {
              workflow_step_id: params.stepId,
              iteration,
              tool_name: toolCall.name,
              input: toolCall.args,
              tool_call_id: toolCall.id,
            },
          }),
        ),
        logTaskEvent({
          taskId: params.taskId,
          agentId: params.agentId,
          eventType: 'model_call',
          payload: {
            workflow_step_id: params.stepId,
            iteration,
            finish_reason: step.finishReason ?? 'unknown',
            model: params.resolvedModelId,
            total_tokens: totalTokens,
            total_cost_usd: totalCostUsd.toFixed(6),
            tool_calls: normalizedToolCalls.map((toolCall) => toolCall.name),
          },
          tokensUsed: stepTokens,
          costUsd: stepCostUsd.toFixed(6),
        }),
      ]);

      lastFinishReason = step.finishReason ?? null;
      if (lastFinishReason === 'length') {
        truncationCount += 1;
      }

      // Loop detection: identical tool+input signatures across iterations.
      // The detecting call has already executed by the time we observe it,
      // so abort stops the *next* iteration from happening.
      if (!loopError) {
        for (const toolCall of normalizedToolCalls) {
          try {
            loopTracker.checkAndRecord(toolCall.name, toolCall.args);
          } catch (err) {
            if (err instanceof LoopDetectedError) {
              loopError = err;
              await logTaskEvent({
                taskId: params.taskId,
                agentId: params.agentId,
                eventType: 'loop_detected',
                payload: {
                  workflow_step_id: params.stepId,
                  iteration,
                  tool_name: toolCall.name,
                  input: toolCall.args,
                  signature: err.signature,
                  count: err.count,
                  message: err.message,
                },
              });
              controller.abort();
              break;
            }
            throw err;
          }
        }
      }

      if (normalizedToolCalls.some((toolCall) => EDIT_TOOL_NAMES.has(toolCall.name))) {
        hasCalledEditTool = true;
      }

      if (
        params.budget &&
        !budgetStopReason &&
        (totalTokens >= params.budget.maxTokens || totalCostUsd >= params.budget.maxCostUsd)
      ) {
        budgetStopReason = `Low-risk implementer budget reached at ${totalTokens} tokens / $${totalCostUsd.toFixed(3)}.`;
        await logTaskEvent({
          taskId: params.taskId,
          agentId: params.agentId,
          eventType: 'budget_exceeded',
          payload: {
            workflow_step_id: params.stepId,
            iteration,
            reason: budgetStopReason,
            model: params.resolvedModelId,
          },
        });
        controller.abort();
      }
    },
    async onIterationComplete(context: unknown) {
      const iterationContext = (context ?? {}) as { isFinal?: boolean };
      if (loopError) {
        return {
          continue: false,
          feedback: loopError.message,
        };
      }

      if (wallClockStopReason) {
        return {
          continue: false,
          feedback: wallClockStopReason,
        };
      }

      if (budgetStopReason) {
        return {
          continue: false,
          feedback: budgetStopReason,
        };
      }

      if (lastFinishReason === 'length') {
        if (truncationCount > 2) {
          return {
            continue: false,
            feedback:
              'Output has been truncated multiple times. Stopping to prevent loops. ' +
              'Use apply_diff for smaller, targeted edits instead of write_workspace_file.',
          };
        }

        return {
          continue: true,
          feedback:
            'Your previous response was truncated due to output length limits. ' +
            'Continue from where you left off. Use apply_diff for targeted edits instead of write_workspace_file.',
        };
      }

      if (
        params.requireEditByIteration &&
        !hasCalledEditTool &&
        iteration >= params.requireEditByIteration &&
        // Feedback can only be injected while the model is still iterating;
        // after a final stop, forcing continuation just replays the same
        // context. The implement step handles the no-edit case with a retry.
        !iterationContext.isFinal
      ) {
        const remaining = params.maxSteps ? Math.max(params.maxSteps - iteration, 1) : null;
        return {
          continue: true,
          feedback:
            `You have used ${iteration} steps without editing any file. Stop exploring now. ` +
            'You already have enough context — make the smallest correct edit immediately: ' +
            'use apply_diff for a targeted change to an existing file, or write_workspace_file for a new file.' +
            (remaining !== null ? ` Only ${remaining} step(s) remain.` : ''),
        };
      }

      return undefined;
    },
    getBudgetStopReason() {
      return budgetStopReason;
    },
    getWallClockStopReason() {
      return wallClockStopReason;
    },
    /**
     * Steps call this right after generate() returns: a loop-aborted run
     * must fail the step (surfacing as LoopDetectedError to the heartbeat)
     * rather than letting partial output flow downstream.
     */
    throwIfLoopDetected() {
      if (loopError) {
        throw loopError;
      }
    },
    getUsageTotals() {
      return {
        totalTokens,
        totalCostUsd: totalCostUsd.toFixed(6),
      };
    },
  };
}
