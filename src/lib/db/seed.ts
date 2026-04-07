import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

const defaultModels = [
  {
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    tier: 'standard',
    isLocal: false,
    endpointUrl: null,
    inputCostPer1m: '3.0000',
    outputCostPer1m: '15.0000',
    maxContextTokens: 200000,
    isAvailable: true,
  },
  {
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    tier: 'fast',
    isLocal: false,
    endpointUrl: null,
    inputCostPer1m: '0.8000',
    outputCostPer1m: '4.0000',
    maxContextTokens: 200000,
    isAvailable: true,
  },
  {
    name: 'Qwen3-Coder-Next (Local)',
    provider: 'ollama',
    modelId: 'qwen3-coder-next',
    tier: 'standard',
    isLocal: true,
    endpointUrl: null,
    inputCostPer1m: '0.0000',
    outputCostPer1m: '0.0000',
    maxContextTokens: 32768,
    isAvailable: true,
  },
  {
    name: 'Qwen3 8B (Local)',
    provider: 'ollama',
    modelId: 'qwen3:8b',
    tier: 'fast',
    isLocal: true,
    endpointUrl: null,
    inputCostPer1m: '0.0000',
    outputCostPer1m: '0.0000',
    maxContextTokens: 32768,
    isAvailable: true,
  },
] as const;

async function seed() {
  console.log('Seeding model_configs...');

  for (const model of defaultModels) {
    await db
      .insert(schema.modelConfigs)
      .values(model)
      .onConflictDoNothing();
  }

  console.log(`Seeded ${defaultModels.length} model configs.`);
  await client.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
