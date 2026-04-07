'use server';

import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  goal: z.string().max(1000).optional(),
  context: z.string().max(5000).optional(),
});

const UpdateProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  goal: z.string().max(1000).optional(),
  context: z.string().max(5000).optional(),
});

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function createProject(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { name, goal, context } = parsed.data;

  const [project] = await db
    .insert(projects)
    .values({ name, goal, context })
    .returning({ id: projects.id });

  revalidatePath('/projects');
  return { success: true, data: { id: project.id } };
}

export async function updateProject(
  input: unknown
): Promise<ActionResult> {
  const parsed = UpdateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e: { message: string }) => e.message).join('; ') };
  }

  const { id, ...fields } = parsed.data;

  await db
    .update(projects)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(projects.id, id));

  revalidatePath('/projects');
  revalidatePath(`/projects/${id}`);
  return { success: true, data: undefined };
}

export async function archiveProject(id: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Invalid project ID' };
  }

  await db
    .update(projects)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(projects.id, id));

  revalidatePath('/projects');
  return { success: true, data: undefined };
}

export async function listProjects() {
  return db.query.projects.findMany({
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });
}

export async function getProject(id: string) {
  return db.query.projects.findFirst({
    where: eq(projects.id, id),
  });
}
