'use server';

import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import {
  cloneRepository,
} from '@/lib/helper/client';
import {
  ensureFreshGitHubAccessToken,
  getActiveGitHubConnection,
} from '@/lib/github/oauth';

const OptionalGoal = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value ? value : undefined));

const OptionalContext = z
  .string()
  .trim()
  .max(5000)
  .optional()
  .transform((value) => (value ? value : undefined));

const OptionalName = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

const CreateProjectSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('local-existing'),
    name: OptionalName,
    goal: OptionalGoal,
    context: OptionalContext,
    workspacePath: z.string().trim().min(1, 'Workspace path is required'),
    helperWorkspaceId: z.string().trim().min(1, 'Workspace selection is required'),
  }),
  z.object({
    mode: z.literal('local-new'),
    name: OptionalName,
    goal: OptionalGoal,
    context: OptionalContext,
    parentPath: z.string().trim().min(1, 'Parent folder is required'),
    folderName: z.string().trim().min(1, 'Folder name is required').max(200),
  }),
  z.object({
    mode: z.literal('github'),
    name: OptionalName,
    goal: OptionalGoal,
    context: OptionalContext,
    repositoryUrl: z.string().trim().min(1, 'Repository is required'),
    repositoryOwner: z.string().trim().min(1, 'Repository owner is required'),
    repositoryName: z.string().trim().min(1, 'Repository name is required'),
    branch: z.string().trim().max(200).optional().transform((value) => (value ? value : undefined)),
    defaultBranch: z.string().trim().max(200).optional().transform((value) => (value ? value : undefined)),
    parentPath: z.string().trim().min(1, 'Clone destination is required'),
  }),
]);

const UpdateProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  goal: z.string().trim().max(1000).optional(),
  context: z.string().trim().max(5000).optional(),
});

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

export async function createProject(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('; '),
    };
  }

  try {
    const data = parsed.data;

    if (data.mode === 'local-existing' || data.mode === 'local-new') {
      return {
        success: false,
        error: 'Local workspace connections are coming soon. Use GitHub for now.',
      };
    }

    const githubConnection = await getActiveGitHubConnection();
    if (!githubConnection) {
      return { success: false, error: 'Connect GitHub before importing a repository' };
    }

    const fresh = await ensureFreshGitHubAccessToken();
    if (!fresh) {
      return { success: false, error: 'GitHub connection is not available' };
    }

    const cloned = await cloneRepository({
      repositoryUrl: data.repositoryUrl,
      parentPath: data.parentPath,
      directoryName: data.repositoryName,
      branch: data.branch,
      authToken: fresh.accessToken,
    });

    const [project] = await db
      .insert(projects)
      .values({
        name: data.name ?? data.repositoryName,
        goal: data.goal,
        context: data.context,
        sourceType: 'github',
        connectionStatus: 'connected',
        workspacePath: cloned.workspacePath,
        helperWorkspaceId: cloned.workspaceId,
        repositoryUrl: data.repositoryUrl,
        repositoryOwner: data.repositoryOwner,
        repositoryName: data.repositoryName,
        defaultBranch: cloned.defaultBranch ?? data.defaultBranch ?? null,
        sourceLabel: `${data.repositoryOwner}/${data.repositoryName}`,
        githubConnectionId: fresh.connection.id,
        lastValidatedAt: new Date(),
      })
      .returning({ id: projects.id });

    revalidatePath('/projects');
    return { success: true, data: { id: project.id } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function updateProject(input: unknown): Promise<ActionResult> {
  const parsed = UpdateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('; '),
    };
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
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    with: {
      githubConnection: true,
    },
  });
}

export async function getProject(id: string) {
  return db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: {
      githubConnection: true,
    },
  });
}
