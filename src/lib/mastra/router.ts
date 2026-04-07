/**
 * Model Router — resolves the correct language model for a given agent/model config.
 *
 * Tier 1 (cloud): Anthropic Claude via ANTHROPIC_API_KEY
 * Tier 2 (local): Ollama via OLLAMA_TUNNEL_URL — tested with HEAD request, 3s timeout
 * Fallback: if Ollama ping fails, log model_fallback event, use Claude Sonnet
 */

import { db } from '@/lib/db';
import { modelConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';

const OLLAMA_TIMEOUT_MS = 3000;
const FALLBACK_MODEL = 'anthropic/claude-sonnet-4-5';

export interface ResolvedModel {
  /** The model string in "provider/model-name" format for Mastra Agent */
  modelId: string;
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
      // Return in openai-compatible format — Mastra's model router can handle
      // "provider/model" where provider maps to a registered gateway.
      // For Ollama, we'll configure it as an openai-compatible provider at runtime.
      return {
        modelId: `ollama/${config.modelId}`,
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
