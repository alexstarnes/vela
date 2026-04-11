/**
 * Model Router — resolves the correct language model for a given agent/model config.
 *
 * Priority order:
 *   1. Local (Ollama) — free, lowest latency
 *   2. Free cloud (NVIDIA Build) — free endpoints, preferred over paid
 *   3. Paid cloud (Anthropic, OpenAI) — last resort
 *
 * Fallback: if Ollama ping fails, try NVIDIA Build; if NVIDIA Build is also down, use paid cloud.
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
const NVIDIA_TIMEOUT_MS = 5000;
export const FALLBACK_MODEL = 'anthropic/claude-sonnet-4-5';

/** NVIDIA Build model to use when falling back from a given tier (free cloud). */
const NVIDIA_TIER_EQUIV: Record<string, string> = {
  fast: 'phi-3.5-mini-instruct',
  standard: 'gemma-2-27b-it',
};

/** Tier-aware *paid* cloud fallback — used only when both local and free cloud are offline. */
const TIER_FALLBACK: Record<string, string> = {
  fast: 'openai/gpt-4o-mini',
  standard: 'openai/gpt-5.4-mini',
  premium: 'anthropic/claude-sonnet-4-5',
};

/** High-priority tasks bump up one tier (paid). */
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
 * Check whether the NVIDIA Build free endpoint is reachable.
 */
export async function checkNvidiaHealth(apiUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NVIDIA_TIMEOUT_MS);
    const res = await fetch(`${apiUrl}/models`, {
      method: 'GET',
      signal: controller.signal,
      headers: nvidiaHeaders(),
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

/** Build auth headers for NVIDIA Build requests. */
function nvidiaHeaders(): Record<string, string> {
  const key = process.env.NVIDIA_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * Create a LanguageModel instance for a NVIDIA Build model via OpenAI-compatible API.
 */
function createNvidiaModel(modelId: string, apiUrl: string): LanguageModelV3 {
  const nvidia = createOpenAICompatible({
    name: 'nvidia',
    baseURL: apiUrl,
    apiKey: process.env.NVIDIA_API_KEY || 'nvidia-build',
  });
  return nvidia.chatModel(modelId);
}

/**
 * Try to resolve a NVIDIA Build free-tier model as a fallback.
 * Returns null if NVIDIA Build is offline or no equivalent model exists for the tier.
 */
async function tryNvidiaFallback(
  tier: string,
  taskId?: string,
  agentId?: string,
): Promise<ResolvedModel | null> {
  const nvidiaModelId = NVIDIA_TIER_EQUIV[tier];
  if (!nvidiaModelId) return null;

  const apiUrl = process.env.NVIDIA_API_URL;
  if (!apiUrl) return null;

  const isOnline = await checkNvidiaHealth(apiUrl);
  if (!isOnline) return null;

  if (taskId) {
    await logFallbackEvent(taskId, agentId, `ollama(offline)`, `NVIDIA Build free model ${nvidiaModelId}`);
  }

  return {
    modelId: createNvidiaModel(nvidiaModelId, apiUrl),
    isFallback: true,
    provider: 'nvidia',
  };
}

/**
 * Resolve the model for an agent, given its model_config_id.
 * If the configured model is Ollama and the tunnel is offline,
 * tries NVIDIA Build free cloud first, then falls back to paid cloud.
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

    // Ollama offline — try free NVIDIA Build cloud before paid fallback
    console.warn(`[router] Ollama offline at ${tunnelUrl}, trying NVIDIA Build free tier`);
    const nvidiaResult = await tryNvidiaFallback(config.tier, taskId, agentId);
    if (nvidiaResult) return nvidiaResult;

    // NVIDIA Build also unavailable — fall to paid cloud
    const paidFallback = getFallbackModelForTier(config.tier);
    console.warn(`[router] NVIDIA Build unavailable, falling back to paid: ${paidFallback}`);
    await logFallbackEvent(taskId, agentId, config.modelId, `Ollama unreachable at ${tunnelUrl}, NVIDIA Build also offline`);
    return { modelId: paidFallback, isFallback: true, provider: paidFallback.split('/')[0] || 'anthropic' };
  }

  // NVIDIA Build free cloud — check endpoint health first
  if (config.provider === 'nvidia') {
    const apiUrl = config.endpointUrl || process.env.NVIDIA_API_URL;

    if (!apiUrl) {
      console.warn('[router] No NVIDIA_API_URL configured, falling back to paid cloud');
      const paidFallback = getFallbackModelForTier(config.tier);
      await logFallbackEvent(taskId, agentId, config.modelId, 'No NVIDIA Build API URL configured');
      return { modelId: paidFallback, isFallback: true, provider: paidFallback.split('/')[0] || 'anthropic' };
    }

    const isOnline = await checkNvidiaHealth(apiUrl);

    if (isOnline) {
      return {
        modelId: createNvidiaModel(config.modelId, apiUrl),
        isFallback: false,
        provider: 'nvidia',
      };
    }

    // NVIDIA Build offline — fall to paid cloud
    const paidFallback = getFallbackModelForTier(config.tier);
    console.warn(`[router] NVIDIA Build offline at ${apiUrl}, falling back to paid: ${paidFallback}`);
    await logFallbackEvent(taskId, agentId, config.modelId, `NVIDIA Build unreachable at ${apiUrl}`);
    return { modelId: paidFallback, isFallback: true, provider: paidFallback.split('/')[0] || 'anthropic' };
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
      } else if (c.provider === 'nvidia') {
        const apiUrl = c.endpointUrl || process.env.NVIDIA_API_URL;
        isOnline = apiUrl ? await checkNvidiaHealth(apiUrl) : false;
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
