'use server';

import { db } from '@/lib/db';
import { agents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from './projects';

const AgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  role: z.string().min(1, 'Role is required').max(2000),
  systemPrompt: z.string().max(10000).optional(),
  modelConfigId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  budgetMonthlyUsd: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid budget amount').optional(),
  heartbeatCron: z.string().max(100).optional(),
  heartbeatEnabled: z.boolean().optional().default(true),
  maxIterations: z.number().int().min(1).max(100).optional().default(10),
});

const UpdateAgentSchema = AgentSchema.partial().extend({
  id: z.string().uuid(),
});

export async function createAgent(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = AgentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const data = parsed.data;

  const [agent] = await db
    .insert(agents)
    .values({
      name: data.name,
      role: data.role,
      systemPrompt: data.systemPrompt,
      modelConfigId: data.modelConfigId,
      projectId: data.projectId,
      parentId: data.parentId,
      budgetMonthlyUsd: data.budgetMonthlyUsd,
      heartbeatCron: data.heartbeatCron,
      heartbeatEnabled: data.heartbeatEnabled ?? true,
      maxIterations: data.maxIterations ?? 10,
      status: 'active',
    })
    .returning({ id: agents.id });

  revalidatePath('/agents');
  return { success: true, data: { id: agent.id } };
}

export async function updateAgent(
  input: unknown
): Promise<ActionResult> {
  const parsed = UpdateAgentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { id, ...fields } = parsed.data;

  await db
    .update(agents)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(agents.id, id));

  revalidatePath('/agents');
  revalidatePath(`/agents/${id}`);
  return { success: true, data: undefined };
}

export async function pauseAgent(id: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { success: false, error: 'Invalid agent ID' };

  await db
    .update(agents)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(eq(agents.id, id));

  revalidatePath('/agents');
  revalidatePath(`/agents/${id}`);
  return { success: true, data: undefined };
}

export async function activateAgent(id: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { success: false, error: 'Invalid agent ID' };

  await db
    .update(agents)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(agents.id, id));

  revalidatePath('/agents');
  revalidatePath(`/agents/${id}`);
  return { success: true, data: undefined };
}

export async function deleteAgent(id: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { success: false, error: 'Invalid agent ID' };

  await db.delete(agents).where(eq(agents.id, id));

  revalidatePath('/agents');
  return { success: true, data: undefined };
}

export async function listAgents() {
  return db.query.agents.findMany({
    orderBy: (a, { desc }) => [desc(a.createdAt)],
    with: {
      modelConfig: true,
      project: true,
    },
  });
}

export async function getAgent(id: string) {
  return db.query.agents.findFirst({
    where: eq(agents.id, id),
    with: {
      modelConfig: true,
      project: true,
    },
  });
}
