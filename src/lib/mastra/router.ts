/**
 * Model Router — resolves the correct language model for a given agent/model config.
 *
 * Tier 1 (cloud): Anthropic Claude via ANTHROPIC_API_KEY
 * Tier 2 (local): Ollama via OLLAMA_TUNNEL_URL — tested with HEAD request, 3s timeout
 * Fallback: if Ollama ping fails, log model_fallback event, use Claude Sonnet
 */

import { db } from '@/lib/db';
import { agents, modelConfigs, tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider-v6';
import { getRuntimeAgentDefinition } from './agents';
import { checkCliLaneHealth, type CliName } from '@/lib/helper/client';
import {
  cliNameForModelId,
  isCliLaneCoolingDown,
} from '@/lib/orchestration/cli-lane';
import {
  chooseModelCandidate,
  desiredTierFromFailureHistory,
  isCapabilityIncrease,
  normalizeTier,
  tierRank,
  type ExecutionTier,
  type ModelHealthState,
  type ModelSelectionCandidate,
} from '@/lib/orchestration/model-selection';
import { applyRoutingTierFloor } from '@/lib/orchestration/routing-tuning';
import { getTaskExecutionPolicy } from '@/lib/orchestration/task-shape';

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

/**
 * Whether a hardcoded router model string ("openai/gpt-5.4-mini") is allowed
 * per the operator's model_configs availability flags. Models without a config
 * row are allowed (legacy hardcoded defaults).
 */
export async function isRouterModelAvailable(routerModelId: string): Promise<boolean> {
  const [provider, ...rest] = routerModelId.split('/');
  const modelId = rest.join('/');
  if (!provider || !modelId) {
    return true;
  }

  const config = await db.query.modelConfigs.findFirst({
    where: eq(modelConfigs.modelId, modelId),
  });

  return config ? config.isAvailable : true;
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
  /** Stable label like ollama/qwen3:8b or openai/gpt-4o-mini. */
  resolvedModelId: string;
}

/**
 * Check whether the Ollama tunnel is reachable.
 */
export async function checkOllamaHealth(tunnelUrl: string): Promise<boolean> {
  return (await getOllamaInstalledModels(tunnelUrl)) !== null;
}

const ollamaTagsCache = new Map<string, { fetchedAt: number; models: Set<string> | null }>();
const OLLAMA_TAGS_TTL_MS = 10_000;

/**
 * Fetch the set of model names installed on an Ollama instance.
 * Returns null when the endpoint is unreachable. Cached briefly so a single
 * model resolution doesn't hammer /api/tags.
 */
export async function getOllamaInstalledModels(tunnelUrl: string): Promise<Set<string> | null> {
  const cached = ollamaTagsCache.get(tunnelUrl);
  if (cached && Date.now() - cached.fetchedAt < OLLAMA_TAGS_TTL_MS) {
    return cached.models;
  }

  let models: Set<string> | null = null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    const res = await fetch(`${tunnelUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = (await res.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      models = new Set<string>();
      for (const model of data.models ?? []) {
        if (model.name) models.add(model.name);
        if (model.model) models.add(model.model);
      }
    }
  } catch {
    models = null;
  }

  ollamaTagsCache.set(tunnelUrl, { fetchedAt: Date.now(), models });
  return models;
}

/** A bare model id like "qwen3" matches the installed tag "qwen3:latest". */
function isOllamaModelInstalled(installed: Set<string>, modelId: string): boolean {
  if (installed.has(modelId)) return true;
  return !modelId.includes(':') && installed.has(`${modelId}:latest`);
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
  stepTierFloor?: ExecutionTier,
): Promise<ResolvedModel> {
  // If no model config set, use the fallback directly
  if (!modelConfigId) {
    return {
      modelId: FALLBACK_MODEL,
      isFallback: false,
      provider: 'anthropic',
      resolvedModelId: FALLBACK_MODEL,
    };
  }

  const config = await db.query.modelConfigs.findFirst({
    where: eq(modelConfigs.id, modelConfigId),
  });

  if (!config) {
    console.warn(`[router] model_config ${modelConfigId} not found, using fallback`);
    return {
      modelId: FALLBACK_MODEL,
      isFallback: true,
      provider: 'anthropic',
      resolvedModelId: FALLBACK_MODEL,
    };
  }

  const [task, agentRow] = await Promise.all([
    taskId
      ? db.query.tasks.findFirst({
          where: eq(tasks.id, taskId),
        })
      : Promise.resolve(null),
    agentId
      ? db.query.agents.findFirst({
          where: eq(agents.id, agentId),
          with: {
            allowedModels: {
              with: {
                modelConfig: true,
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  let desiredTier = normalizeTier(config.tier);

  if (task) {
    const policy = getTaskExecutionPolicy(task);
    const routingAdjustment = await applyRoutingTierFloor({
      classification: policy.classification,
      workflowId: policy.workflowId,
      task,
    });
    desiredTier = desiredTierFromFailureHistory({
      effectiveTier: routingAdjustment.effectiveTier,
      failureCount: task.failureCount,
      preserveRoutedTier: policy.isLowRiskFeature,
    });

    if (routingAdjustment.floorApplied) {
      await logTaskEvent({
        taskId: task.id,
        agentId,
        eventType: 'routing_tuning',
        payload: {
          workflow_id: policy.workflowId,
          base_tier: config.tier,
          tuned_tier: routingAdjustment.effectiveTier,
          reason: routingAdjustment.reason,
        },
      });
    }

    if (stepTierFloor && tierRank(stepTierFloor) > tierRank(desiredTier)) {
      desiredTier = stepTierFloor;
    }

    if (!policy.isLowRiskFeature && isCapabilityIncrease(config.tier, desiredTier)) {
      const upwardModel = getFallbackModelForTier(desiredTier, task.priority);
      await logEscalationEvent(
        task.id,
        agentId,
        config.tier,
        desiredTier,
        task.failureCount,
        upwardModel,
      );
    }
  }

  const healthCache = new Map<string, ModelHealthState>();
  const candidates = await buildCandidatePool({
    configuredModelId: config.id,
    agentRow: agentRow ?? null,
    healthCache,
  });
  const configuredCandidate =
    candidates.find((candidate) => candidate.id === config.id) ??
    (await createCandidate(config, healthCache));
  const selection = chooseModelCandidate({
    configured: configuredCandidate,
    candidates,
    desiredTier,
  });
  const resolved = await materializeSelectedModel(selection.selected);

  if (task) {
    await logTaskEvent({
      taskId: task.id,
      agentId,
      eventType: 'model_call',
      payload: {
        configured_model: `${config.provider}/${config.modelId}`,
        selected_model: resolved.resolvedModelId,
        selected_provider: resolved.provider,
        selection_reason: selection.selectionReason,
        selection_kind: selection.selectionKind,
        health_state: selection.selected.healthState,
        desired_tier: desiredTier,
      },
    });
  }

  if (
    (selection.selectionKind === 'cloud_fallback' || selection.selectionKind === 'cli_fallback') &&
    task
  ) {
    const laneDescription =
      selection.selectionKind === 'cli_fallback'
        ? `Selected ${resolved.resolvedModelId} (subscription CLI) because no healthy local candidate satisfied the ${desiredTier} tier policy`
        : `Selected ${resolved.resolvedModelId} because no healthy local candidate satisfied the ${desiredTier} tier policy`;
    await logFallbackEvent(
      task.id,
      agentId,
      config.modelId,
      laneDescription,
      {
        selected_model: resolved.resolvedModelId,
        selection_kind: selection.selectionKind,
        health_state: selection.selected.healthState,
      },
    );
  }

  const expectedResolvedModelId =
    selection.selected.provider === 'ollama'
      ? `ollama/${selection.selected.modelId}`
      : `${selection.selected.provider}/${selection.selected.modelId}`;

  return {
    ...resolved,
    isFallback:
      selection.selected.id !== config.id || resolved.resolvedModelId !== expectedResolvedModelId,
  };
}

async function logFallbackEvent(
  taskId: string | undefined,
  agentId: string | undefined,
  configuredModel: string,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!taskId) return;
  try {
    await logTaskEvent({
      taskId,
      agentId,
      eventType: 'model_fallback',
      payload: {
        configured_model: configuredModel,
        // Callers pass the actually selected model in `extra.selected_model`;
        // default to the legacy constant only when none is provided.
        fallback_model: extra.selected_model ?? FALLBACK_MODEL,
        reason,
        ...extra,
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
        selection_kind: 'tier_up',
      },
    });
  } catch (err) {
    console.error('[router] Failed to log model_escalation event:', err);
  }
}

async function createCandidate(
  config: typeof modelConfigs.$inferSelect,
  healthCache: Map<string, ModelHealthState>,
): Promise<ModelSelectionCandidate> {
  return {
    id: config.id,
    modelId: config.modelId,
    provider: config.provider,
    tier: config.tier,
    isLocal: config.isLocal,
    isAvailable: config.isAvailable,
    healthState: await getCandidateHealth(config, healthCache),
  };
}

async function buildCandidatePool(params: {
  configuredModelId: string;
  agentRow:
    | ({
        name: string;
        allowedModels?: Array<{
          modelConfig:
            | (typeof modelConfigs.$inferSelect)
            | null;
        }>;
      })
    | null;
  healthCache: Map<string, ModelHealthState>;
}): Promise<ModelSelectionCandidate[]> {
  const modelPool = new Map<string, typeof modelConfigs.$inferSelect>();

  if (params.agentRow?.allowedModels) {
    for (const access of params.agentRow.allowedModels) {
      if (access.modelConfig) {
        modelPool.set(access.modelConfig.id, access.modelConfig);
      }
    }
  }

  const runtimeDefinition = params.agentRow?.name
    ? getRuntimeAgentDefinition(params.agentRow.name)
    : null;
  if (runtimeDefinition) {
    const extraConfigs = await db.query.modelConfigs.findMany();
    const allowedModelIds = runtimeDefinition.allowedModelIds as readonly string[];
    for (const extraConfig of extraConfigs) {
      if (allowedModelIds.includes(extraConfig.modelId)) {
        modelPool.set(extraConfig.id, extraConfig);
      }
    }
  }

  const configuredModel = await db.query.modelConfigs.findFirst({
    where: eq(modelConfigs.id, params.configuredModelId),
  });

  if (configuredModel) {
    modelPool.set(configuredModel.id, configuredModel);
  }

  const candidates: ModelSelectionCandidate[] = [];
  for (const modelConfig of modelPool.values()) {
    candidates.push(await createCandidate(modelConfig, params.healthCache));
  }

  return candidates;
}

const cliHealthCache = new Map<CliName, { fetchedAt: number; available: boolean }>();
const CLI_HEALTH_TTL_MS = 10_000;

/**
 * Live health for a CLI lane candidate: the lane is online when the helper is
 * reachable, the CLI binary responds, and the lane is not in a cap cooldown.
 */
async function getCliLaneHealth(modelId: string): Promise<ModelHealthState> {
  const cli = cliNameForModelId(modelId);
  if (isCliLaneCoolingDown(cli)) {
    return 'offline';
  }

  const cached = cliHealthCache.get(cli);
  if (cached && Date.now() - cached.fetchedAt < CLI_HEALTH_TTL_MS) {
    return cached.available ? 'online' : 'offline';
  }

  const health = await checkCliLaneHealth(cli);
  cliHealthCache.set(cli, { fetchedAt: Date.now(), available: health.available });
  return health.available ? 'online' : 'offline';
}

async function getCandidateHealth(
  config: typeof modelConfigs.$inferSelect,
  healthCache: Map<string, ModelHealthState>,
): Promise<ModelHealthState> {
  if (config.provider === 'cli') {
    if (!config.isAvailable) {
      return 'unknown';
    }
    const cacheKey = `cli|${config.modelId}`;
    const cached = healthCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const state = await getCliLaneHealth(config.modelId);
    healthCache.set(cacheKey, state);
    return state;
  }

  if (config.provider !== 'ollama') {
    return config.isAvailable ? 'online' : 'unknown';
  }

  const tunnelUrl = config.endpointUrl || process.env.OLLAMA_TUNNEL_URL;
  if (!tunnelUrl) {
    return 'offline';
  }

  const cacheKey = `${tunnelUrl}|${config.modelId}`;
  const cached = healthCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // A model is only "online" when the endpoint is reachable AND the exact
  // model is installed there — otherwise generate calls fail mid-task.
  const installed = await getOllamaInstalledModels(tunnelUrl);
  const nextState =
    installed && isOllamaModelInstalled(installed, config.modelId) ? 'online' : 'offline';
  healthCache.set(cacheKey, nextState);
  return nextState;
}

async function materializeSelectedModel(selected: ModelSelectionCandidate): Promise<ResolvedModel> {
  if (selected.provider === 'anthropic' || selected.provider === 'openai') {
    const resolvedModelId = `${selected.provider}/${selected.modelId}`;
    return {
      modelId: resolvedModelId,
      provider: selected.provider,
      resolvedModelId,
      isFallback: false,
    };
  }

  if (selected.provider === 'cli') {
    // CLI lanes are execution backends, not token-level models: the implement
    // step routes these to the helper's /cli/execute instead of agent.generate.
    const resolvedModelId = `cli/${selected.modelId}`;
    return {
      modelId: resolvedModelId,
      provider: 'cli',
      resolvedModelId,
      isFallback: false,
    };
  }

  if (selected.provider === 'ollama') {
    const config = await db.query.modelConfigs.findFirst({
      where: eq(modelConfigs.id, selected.id),
    });
    const tunnelUrl = config?.endpointUrl || process.env.OLLAMA_TUNNEL_URL;

    if (!tunnelUrl) {
      return {
        modelId: FALLBACK_MODEL,
        provider: 'anthropic',
        resolvedModelId: FALLBACK_MODEL,
        isFallback: true,
      };
    }

    const ollama = createOpenAICompatible({
      name: 'ollama',
      baseURL: `${tunnelUrl}/v1`,
      apiKey: 'ollama',
    });
    return {
      modelId: ollama.chatModel(selected.modelId),
      provider: 'ollama',
      resolvedModelId: `ollama/${selected.modelId}`,
      isFallback: false,
    };
  }

  return {
    modelId: FALLBACK_MODEL,
    provider: 'anthropic',
    resolvedModelId: FALLBACK_MODEL,
    isFallback: true,
  };
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
        const installed = tunnelUrl ? await getOllamaInstalledModels(tunnelUrl) : null;
        isOnline = installed ? isOllamaModelInstalled(installed, c.modelId) : false;
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
