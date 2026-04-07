/**
 * Project Tools — Mastra tools that give agents awareness of project context.
 *
 * - get_project_context: returns project goal, context, and skills
 * - list_tasks: returns tasks in the same project for situational awareness
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects, tasks, skills } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Get project context — goal, description, and relevant skills.
 */
export const getProjectContextTool = createTool({
  id: 'get_project_context',
  description:
    'Get the project goal, context description, and skills for the current project. Use this to understand the broader context of your work.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    projectId: z.string(),
    projectName: z.string(),
    goal: z.string().nullable(),
    context: z.string().nullable(),
    skills: z.array(
      z.object({
        name: z.string(),
        scope: z.string(),
        content: z.string().nullable(),
      }),
    ),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as
      | { projectId: string }
      | undefined;

    if (!ctx) {
      return {
        projectId: '',
        projectName: '',
        goal: null,
        context: null,
        skills: [],
      };
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, ctx.projectId),
    });

    if (!project) {
      return {
        projectId: ctx.projectId,
        projectName: 'Unknown',
        goal: null,
        context: null,
        skills: [],
      };
    }

    // Load both project-scoped and global skills
    const projectSkills = await db.query.skills.findMany({
      where: eq(skills.projectId, ctx.projectId),
    });

    const globalSkills = await db.query.skills.findMany({
      where: eq(skills.scope, 'global'),
    });

    const allSkills = [...globalSkills, ...projectSkills].map((s) => ({
      name: s.name,
      scope: s.scope,
      content: s.contentMd,
    }));

    return {
      projectId: project.id,
      projectName: project.name,
      goal: project.goal,
      context: project.context,
      skills: allSkills,
    };
  },
});

/**
 * List tasks in the same project — gives the agent awareness of sibling tasks.
 */
export const listTasksTool = createTool({
  id: 'list_tasks',
  description:
    'List other tasks in the same project. Use this to understand what other work is happening and avoid duplication.',
  inputSchema: z.object({
    statusFilter: z
      .enum(['backlog', 'open', 'in_progress', 'review', 'done', 'waiting_for_human', 'blocked', 'cancelled'])
      .optional()
      .describe('Optionally filter by task status'),
    limit: z.number().optional().default(20).describe('Maximum number of tasks to return'),
  }),
  outputSchema: z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
        assignedAgentId: z.string().nullable(),
      }),
    ),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as
      | { projectId: string; taskId: string }
      | undefined;

    if (!ctx) {
      return { tasks: [] };
    }

    const allTasks = await db.query.tasks.findMany({
      where: eq(tasks.projectId, ctx.projectId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: input.limit ?? 20,
    });

    // Filter by status if requested, and exclude the current task
    const filtered = allTasks
      .filter((t) => t.id !== ctx.taskId)
      .filter((t) => (input.statusFilter ? t.status === input.statusFilter : true));

    return {
      tasks: filtered.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignedAgentId: t.assignedAgentId,
      })),
    };
  },
});
