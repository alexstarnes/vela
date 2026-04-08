/**
 * Model Router — resolves the correct language model for a given agent/model config.
 *
 * Tier 1 (cloud): Anthropic Claude via ANTHROPIC_API_KEY
 * Tier 2 (local): Ollama via OLLAMA_TUNNEL_URL — tested with HEAD request, 3s timeout
 * Fallback: if Ollama ping fails, log model_fallback event, use Claude Sonnet
 */

import { db } from '@/lib/db';
import { modelConfigs, tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider-v6';
import { escalateTierFromFailureCount } from '@/lib/orchestration/escalation';
import { classifyTaskMode } from '@/lib/orchestration/mode-classifier';
import { applyRoutingTierFloor } from '@/lib/orchestration/routing-tuning';
import { selectWorkflowForClassification } from '@/lib/orchestration/workflow-selector';

const OLLAMA_TIMEOUT_MS = 3000;
export const FALLBACK_MODEL = 'anthropic/claude-sonnet-4-5';

/** Tier-aware cloud fallback: simple tasks don't need Sonnet. */
const TIER_FALLBACK: Record<string, string> = {
  fast: 'openai/gpt-4o-mini',
  standard: 'openai/gpt-5.4-mini',
  premium: 'anthropic/claude-sonnet-4-5',
};

/** High-priority tasks bump up one tier. */
const TIER_FALLBACK_HIGH: Record<string, string> = {
  fast: 'openai/gpt-5.4-mini',
  standard: 'anthropic/claude-sonnet-4-5',
  premium: 'anthropic/claude-sonnet-4-5',
};

/**
 * Pick the right cloud fallback based on the original model's tier and task priority.
 */
export function getFallbackModelForTier(
  tier: string | null,
  taskPriority?: string,
): string {
  const isHighPriority = taskPriority === 'high' || taskPriority === 'urgent';
  const map = isHighPriority ? TIER_FALLBACK_HIGH : TIER_FALLBACK;
  return map[tier ?? 'standard'] ?? FALLBACK_MODEL;
}

export interface ResolvedModel {
  /**
   * For cloud providers: a model router string like "anthropic/claude-sonnet-4-5".
   * For Ollama: a LanguageModelV1 instance from @ai-sdk/openai-compatible.
   * Both are valid inputs for Mastra's Agent `model` parameter.
   */
  modelId: string | LanguageModelV3;
  /** Whether a fallback was used instead of the configured model */
  isFallback: boolean;
  /** Provider: anthropic | ollama */
  provider: string;
}

/**
 * Check whether the Ollama tunnel is reachable.
 */
export async function checkOllamaHealth(tunnelUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    const res = await fetch(`${tunnelUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve the model for an agent, given its model_config_id.
 * If the configured model is Ollama and the tunnel is offline,
 * falls back to cloud and logs a model_fallback event (if taskId provided).
 */
export async function resolveModel(
  modelConfigId: string | null,
  taskId?: string,
  agentId?: string,
): Promise<ResolvedModel> {
  // If no model config set, use the fallback directly
  if (!modelConfigId) {
    return { modelId: FALLBACK_MODEL, isFallback: false, provider: 'anthropic' };
  }

  const config = await db.query.modelConfigs.findFirst({
    where: eq(modelConfigs.id, modelConfigId),
  });

  if (!config) {
    console.warn(`[router] model_config ${modelConfigId} not found, using fallback`);
    return { modelId: FALLBACK_MODEL, isFallback: true, provider: 'anthropic' };
  }

  if (taskId) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (task) {
      const classification = classifyTaskMode(task);
      const workflowSelection = selectWorkflowForClassification(classification);
      const routingAdjustment = await applyRoutingTierFloor({
        classification,
        workflowId: workflowSelection.workflowId,
        task,
      });
      const escalatedTier = escalateTierFromFailureCount(
        routingAdjustment.effectiveTier,
        task.failureCount,
      );

      if (routingAdjustment.floorApplied) {
        await logTaskEvent({
          taskId: task.id,
          agentId,
          eventType: 'routing_tuning',
          payload: {
            workflow_id: workflowSelection.workflowId,
            base_tier: config.tier,
            tuned_tier: routingAdjustment.effectiveTier,
            reason: routingAdjustment.reason,
          },
        });
      }

      if (escalatedTier !== config.tier) {
        const escalatedModel = getFallbackModelForTier(escalatedTier, task.priority);
        await logEscalationEvent(
          task.id,
          agentId,
          config.tier,
          escalatedTier,
          task.failureCount,
          escalatedModel,
        );
        return {
          modelId: escalatedModel,
          isFallback: true,
          provider: escalatedModel.split('/')[0] || 'anthropic',
        };
      }
    }
  }

  // Cloud providers — use directly
  if (config.provider === 'anthropic') {
    return {
      modelId: `anthropic/${config.modelId}`,
      isFallback: false,
      provider: 'anthropic',
    };
  }

  if (config.provider === 'openai') {
    return {
      modelId: `openai/${config.modelId}`,
      isFallback: false,
      provider: 'openai',
    };
  }

  // Ollama — check tunnel health first
  if (config.provider === 'ollama') {
    const tunnelUrl = config.endpointUrl || process.env.OLLAMA_TUNNEL_URL;

    if (!tunnelUrl) {
      console.warn('[router] No OLLAMA_TUNNEL_URL configured, falling back to cloud');
      await logFallbackEvent(taskId, agentId, config.modelId, 'No tunnel URL configured');
      return { modelId: FALLBACK_MODEL, isFallback: true, provider: 'anthropic' };
    }

    const isOnline = await checkOllamaHealth(tunnelUrl);

    if (isOnline) {
      // Create a real LanguageModel instance via @ai-sdk/openai-compatible.
      // Ollama exposes an OpenAI-compatible API, so we point at its /v1 path.
      // No API key needed for local Ollama; we pass a dummy value.
      const ollama = createOpenAICompatible({
        name: 'ollama',
        baseURL: `${tunnelUrl}/v1`,
        apiKey: 'ollama', // Ollama doesn't require auth
      });
      return {
        modelId: ollama.chatModel(config.modelId),
        isFallback: false,
        provider: 'ollama',
      };
    }

    // Ollama offline — fallback
    console.warn(`[router] Ollama offline at ${tunnelUrl}, falling back to ${FALLBACK_MODEL}`);
    await logFallbackEvent(taskId, agentId, config.modelId, `Ollama unreachable at ${tunnelUrl}`);
    return { modelId: FALLBACK_MODEL, isFallback: true, provider: 'anthropic' };
  }

  // Unknown provider
  console.warn(`[router] Unknown provider "${config.provider}", using fallback`);
  return { modelId: FALLBACK_MODEL, isFallback: true, provider: 'anthropic' };
}

async function logFallbackEvent(
  taskId: string | undefined,
  agentId: string | undefined,
  configuredModel: string,
  reason: string,
): Promise<void> {
  if (!taskId) return;
  try {
    await logTaskEvent({
      taskId,
      agentId,
      eventType: 'model_fallback',
      payload: {
        configured_model: configuredModel,
        fallback_model: FALLBACK_MODEL,
        reason,
      },
    });
  } catch (err) {
    console.error('[router] Failed to log model_fallback event:', err);
  }
}

async function logEscalationEvent(
  taskId: string,
  agentId: string | undefined,
  fromTier: string,
  toTier: string,
  failureCount: number,
  modelId: string,
): Promise<void> {
  try {
    await logTaskEvent({
      taskId,
      agentId,
      eventType: 'model_escalation',
      payload: {
        from_tier: fromTier,
        to_tier: toTier,
        failure_count: failureCount,
        resolved_model: modelId,
      },
    });
  } catch (err) {
    console.error('[router] Failed to log model_escalation event:', err);
  }
}

/**
 * List all available models from model_configs table,
 * with live Ollama health check for local models.
 */
export async function listAvailableModels(): Promise<
  Array<{
    id: string;
    name: string;
    provider: string;
    modelId: string;
    tier: string;
    isLocal: boolean;
    isOnline: boolean;
  }>
> {
  const configs = await db.query.modelConfigs.findMany();

  const results = await Promise.all(
    configs.map(async (c) => {
      let isOnline = true;
      if (c.provider === 'ollama') {
        const tunnelUrl = c.endpointUrl || process.env.OLLAMA_TUNNEL_URL;
        isOnline = tunnelUrl ? await checkOllamaHealth(tunnelUrl) : false;
      }
      return {
        id: c.id,
        name: c.name,
        provider: c.provider,
        modelId: c.modelId,
        tier: c.tier,
        isLocal: c.isLocal,
        isOnline,
      };
    }),
  );

  return results;
}
