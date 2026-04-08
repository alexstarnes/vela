import { db } from '@/lib/db';
import { modelConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const DEFAULT_INPUT_COST_PER_TOKEN = 0.000003;
const DEFAULT_OUTPUT_COST_PER_TOKEN = 0.000015;

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputCostPerToken = DEFAULT_INPUT_COST_PER_TOKEN,
  outputCostPerToken = DEFAULT_OUTPUT_COST_PER_TOKEN,
): string {
  const cost = inputTokens * inputCostPerToken + outputTokens * outputCostPerToken;
  return cost.toFixed(6);
}

export async function getModelCostRates(params: {
  modelConfigId?: string | null;
  resolvedModelId?: string | null;
}): Promise<{ inputCostPerToken: number; outputCostPerToken: number }> {
  const resolvedModelId = params.resolvedModelId ?? null;

  if (resolvedModelId?.startsWith('ollama/')) {
    return { inputCostPerToken: 0, outputCostPerToken: 0 };
  }

  if (params.modelConfigId) {
    const config = await db.query.modelConfigs.findFirst({
      where: eq(modelConfigs.id, params.modelConfigId),
    });

    if (config) {
      const inputPer1m = parseFloat(config.inputCostPer1m ?? '0');
      const outputPer1m = parseFloat(config.outputCostPer1m ?? '0');
      return {
        inputCostPerToken: inputPer1m > 0 ? inputPer1m / 1_000_000 : DEFAULT_INPUT_COST_PER_TOKEN,
        outputCostPerToken: outputPer1m > 0 ? outputPer1m / 1_000_000 : DEFAULT_OUTPUT_COST_PER_TOKEN,
      };
    }
  }

  if (resolvedModelId) {
    const parsedModelId = resolvedModelId.includes('/')
      ? resolvedModelId.split('/').slice(1).join('/')
      : resolvedModelId;

    const config = await db.query.modelConfigs.findFirst({
      where: eq(modelConfigs.modelId, parsedModelId),
    });

    if (config) {
      const inputPer1m = parseFloat(config.inputCostPer1m ?? '0');
      const outputPer1m = parseFloat(config.outputCostPer1m ?? '0');
      return {
        inputCostPerToken: inputPer1m > 0 ? inputPer1m / 1_000_000 : DEFAULT_INPUT_COST_PER_TOKEN,
        outputCostPerToken: outputPer1m > 0 ? outputPer1m / 1_000_000 : DEFAULT_OUTPUT_COST_PER_TOKEN,
      };
    }
  }

  return {
    inputCostPerToken: DEFAULT_INPUT_COST_PER_TOKEN,
    outputCostPerToken: DEFAULT_OUTPUT_COST_PER_TOKEN,
  };
}
