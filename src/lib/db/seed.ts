import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, isNull } from 'drizzle-orm';
import postgres from 'postgres';
import { requireFencedSystemPromptForSeed } from '@/lib/agent-orchestration/reference-docs';
import * as schema from './schema';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

// ─── Models ──────────────────────────────────────────────────────

const defaultModels = [
  // Premium (Tier-1) — deep reasoning, architecture, security
  {
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    modelId: 'claude-opus-4-6',
    tier: 'premium',
    isLocal: false,
    endpointUrl: null,
    inputCostPer1m: '5.0000',
    outputCostPer1m: '25.0000',
    maxContextTokens: 200000,
    isAvailable: true,
  },
  // Standard (Tier-2) — solid implementation, pattern recognition
  {
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    tier: 'standard',
    isLocal: false,
    endpointUrl: null,
    inputCostPer1m: '3.0000',
    outputCostPer1m: '15.0000',
    maxContextTokens: 200000,
    isAvailable: true,
  },
  {
    name: 'Composer 2',
    provider: 'openai',
    modelId: 'composer-2',
    tier: 'standard',
    isLocal: false,
    endpointUrl: null,
    inputCostPer1m: '0.5000',
    outputCostPer1m: '2.5000',
    maxContextTokens: 200000,
    isAvailable: true,
  },
  {
    name: 'Qwen3-Coder-Next (Local)',
    provider: 'ollama',
    modelId: 'qwen3-coder-next:Q4_K_M',
    tier: 'standard',
    isLocal: true,
    endpointUrl: null,
    inputCostPer1m: '0.0000',
    outputCostPer1m: '0.0000',
    maxContextTokens: 32768,
    isAvailable: true,
  },
  // Fast (Tier-3) — quick transforms, mechanical tasks
  {
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    tier: 'fast',
    isLocal: false,
    endpointUrl: null,
    inputCostPer1m: '1.0000',
    outputCostPer1m: '5.0000',
    maxContextTokens: 200000,
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
];

// ─── Agents ──────────────────────────────────────────────────────

const defaultAgents: {
  name: string;
  role: string;
  domain: string;
  defaultModelId: string;
  allowedModelIds: string[];
}[] = [
  {
    name: 'Orchestrator',
    role: 'Central coordinator that classifies tasks, routes them to specialists, decomposes work, enforces quality gates, and manages handoffs.',
    domain: 'meta',
    defaultModelId: 'claude-opus-4-6',
    allowedModelIds: ['claude-opus-4-6'],
  },
  {
    name: 'Product Strategist',
    role: 'Turns business goals and user needs into prioritized requirements, user stories, acceptance criteria, and success metrics.',
    domain: 'product',
    defaultModelId: 'claude-opus-4-6',
    allowedModelIds: ['claude-opus-4-6', 'claude-sonnet-4-5'],
  },
  {
    name: 'UX Designer',
    role: 'Produces layouts, component hierarchies, interaction specs, accessibility requirements, and design system documentation.',
    domain: 'product',
    defaultModelId: 'claude-opus-4-6',
    allowedModelIds: ['claude-opus-4-6', 'claude-sonnet-4-5'],
  },
  {
    name: 'Architect',
    role: 'Owns system design, API contracts, dependency boundaries, technology choices, and structural integrity of the codebase.',
    domain: 'architecture',
    defaultModelId: 'claude-opus-4-6',
    allowedModelIds: ['claude-opus-4-6'],
  },
  {
    name: 'Database Engineer',
    role: 'Owns schema design, migrations, query optimization, integrity constraints, and database-level security.',
    domain: 'architecture',
    defaultModelId: 'claude-sonnet-4-5',
    allowedModelIds: ['claude-sonnet-4-5', 'claude-opus-4-6'],
  },
  {
    name: 'Frontend Engineer',
    role: 'Implements UI components, client state, accessibility, and client-side performance from UX specs and API contracts.',
    domain: 'implementation',
    defaultModelId: 'claude-sonnet-4-5',
    allowedModelIds: ['claude-sonnet-4-5', 'composer-2', 'qwen3-coder-next:Q4_K_M'],
  },
  {
    name: 'Backend Engineer',
    role: 'Implements APIs, business logic, data access, auth integration, and external integrations with validation and structured errors.',
    domain: 'implementation',
    defaultModelId: 'claude-sonnet-4-5',
    allowedModelIds: ['claude-sonnet-4-5', 'composer-2', 'qwen3-coder-next:Q4_K_M'],
  },
  {
    name: 'Fullstack Implementer',
    role: 'Delivers end-to-end vertical slices spanning schema, API, UI, and tests when splitting FE/BE would add needless coordination.',
    domain: 'implementation',
    defaultModelId: 'claude-sonnet-4-5',
    allowedModelIds: ['claude-sonnet-4-5', 'composer-2', 'qwen3-coder-next:Q4_K_M'],
  },
  {
    name: 'AI/Agent Engineer',
    role: 'Builds agents, prompts, tools, RAG pipelines, MCP servers, evaluations, and observability with strict schemas.',
    domain: 'implementation',
    defaultModelId: 'claude-opus-4-6',
    allowedModelIds: ['claude-opus-4-6', 'claude-sonnet-4-5'],
  },
  {
    name: 'Code Reviewer',
    role: 'Reviews changes for correctness, security, performance, maintainability, and conventions with actionable, prioritized feedback.',
    domain: 'quality',
    defaultModelId: 'claude-opus-4-6',
    allowedModelIds: ['claude-opus-4-6', 'claude-sonnet-4-5'],
  },
  {
    name: 'QA Engineer',
    role: 'Owns test strategy, automated tests, coverage analysis, test infrastructure, and validation against acceptance criteria.',
    domain: 'quality',
    defaultModelId: 'claude-sonnet-4-5',
    allowedModelIds: ['claude-sonnet-4-5', 'composer-2'],
  },
  {
    name: 'Security Auditor',
    role: 'Audits auth, injection risks, input validation, data handling, dependencies, and security configuration with severity-rated remediation.',
    domain: 'quality',
    defaultModelId: 'claude-opus-4-6',
    allowedModelIds: ['claude-opus-4-6'],
  },
  {
    name: 'Performance Engineer',
    role: 'Defines performance budgets, profiles bottlenecks, runs load tests, and drives measured optimizations across the stack.',
    domain: 'quality',
    defaultModelId: 'claude-sonnet-4-5',
    allowedModelIds: ['claude-sonnet-4-5'],
  },
  {
    name: 'DevOps Engineer',
    role: 'Owns CI/CD pipelines, containers, environments, secrets management, deployment automation, and monitoring infrastructure.',
    domain: 'operations',
    defaultModelId: 'claude-sonnet-4-5',
    allowedModelIds: ['claude-sonnet-4-5'],
  },
  {
    name: 'Technical Writer',
    role: 'Produces and maintains API docs, developer guides, changelogs, READMEs, and architecture decision records.',
    domain: 'operations',
    defaultModelId: 'claude-haiku-4-5',
    allowedModelIds: ['claude-haiku-4-5', 'qwen3:8b'],
  },
  {
    name: 'Data Analyst',
    role: 'Defines metrics, implements event tracking and pipelines, builds dashboards, and turns data into actionable insights.',
    domain: 'operations',
    defaultModelId: 'claude-sonnet-4-5',
    allowedModelIds: ['claude-sonnet-4-5'],
  },
];

// ─── Seed ────────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding models, agents, and access matrix...\n');

  // 1. Upsert model configs
  console.log('  Models:');
  const modelMap = new Map<string, string>();

  for (const model of defaultModels) {
    const [row] = await db
      .insert(schema.modelConfigs)
      .values(model)
      .onConflictDoUpdate({
        target: schema.modelConfigs.modelId,
        set: {
          name: model.name,
          provider: model.provider,
          tier: model.tier,
          isLocal: model.isLocal,
          inputCostPer1m: model.inputCostPer1m,
          outputCostPer1m: model.outputCostPer1m,
          maxContextTokens: model.maxContextTokens,
          isAvailable: model.isAvailable,
        },
      })
      .returning();
    modelMap.set(model.modelId, row.id);
    console.log(`    ✓ ${model.name} [${model.tier}]`);
  }

  // 2. Upsert agents (template agents have no project)
  console.log('\n  Agents:');
  const agentMap = new Map<string, string>();

  for (const agent of defaultAgents) {
    const modelConfigId = modelMap.get(agent.defaultModelId)!;
    const systemPrompt = requireFencedSystemPromptForSeed(agent.name);

    const [existing] = await db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.name, agent.name), isNull(schema.agents.projectId)))
      .limit(1);

    let agentId: string;
    if (existing) {
      await db
        .update(schema.agents)
        .set({
          role: agent.role,
          domain: agent.domain,
          modelConfigId,
          systemPrompt,
        })
        .where(eq(schema.agents.id, existing.id));
      agentId = existing.id;
    } else {
      const [row] = await db
        .insert(schema.agents)
        .values({
          name: agent.name,
          role: agent.role,
          domain: agent.domain,
          modelConfigId,
          systemPrompt,
        })
        .returning();
      agentId = row.id;
    }

    agentMap.set(agent.name, agentId);
    console.log(`    ✓ ${agent.name} [${agent.domain}] → ${agent.defaultModelId}`);
  }

  // 3. Seed agent ↔ model access matrix
  console.log('\n  Model access:');
  let accessCount = 0;

  for (const agent of defaultAgents) {
    const agentId = agentMap.get(agent.name)!;
    for (const modelId of agent.allowedModelIds) {
      const modelConfigId = modelMap.get(modelId)!;
      await db
        .insert(schema.agentModelAccess)
        .values({ agentId, modelConfigId })
        .onConflictDoNothing({
          target: [schema.agentModelAccess.agentId, schema.agentModelAccess.modelConfigId],
        });
      accessCount++;
    }
  }
  console.log(`    ✓ ${accessCount} access entries`);

  console.log(`\nDone. Seeded ${defaultModels.length} models, ${defaultAgents.length} agents.\n`);
  await client.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
