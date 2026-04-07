'use server';

import { db } from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from './projects';

const CreateSkillSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  scope: z.enum(['global', 'project']),
  projectId: z.string().uuid().optional(),
  contentMd: z.string().max(50000).optional(),
});

const UpdateSkillSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  contentMd: z.string().max(50000).optional(),
  scope: z.enum(['global', 'project']).optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export async function createSkill(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateSkillSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const data = parsed.data;

  if (data.scope === 'project' && !data.projectId) {
    return { success: false, error: 'Project is required for project-scoped skills' };
  }

  const [skill] = await db
    .insert(skills)
    .values({
      name: data.name,
      scope: data.scope,
      projectId: data.projectId ?? null,
      contentMd: data.contentMd ?? '',
    })
    .returning({ id: skills.id });

  revalidatePath('/skills');
  return { success: true, data: { id: skill.id } };
}

export async function updateSkill(
  input: unknown
): Promise<ActionResult> {
  const parsed = UpdateSkillSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { id, ...fields } = parsed.data;

  await db
    .update(skills)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(skills.id, id));

  revalidatePath('/skills');
  return { success: true, data: undefined };
}

export async function deleteSkill(id: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { success: false, error: 'Invalid skill ID' };

  await db.delete(skills).where(eq(skills.id, id));

  revalidatePath('/skills');
  return { success: true, data: undefined };
}

export async function listSkills(projectId?: string) {
  if (projectId) {
    return db.query.skills.findMany({
      where: (s, { or }) => or(eq(s.scope, 'global'), eq(s.projectId, projectId)),
      orderBy: (s, { asc }) => [asc(s.scope), asc(s.name)],
    });
  }

  return db.query.skills.findMany({
    orderBy: (s, { asc }) => [asc(s.scope), asc(s.name)],
  });
}

export async function getSkill(id: string) {
  return db.query.skills.findFirst({
    where: eq(skills.id, id),
  });
}
