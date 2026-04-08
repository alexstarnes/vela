/**
 * Project Tools — factory functions that create Mastra tools bound to a specific execution context.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects, tasks, skills } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ToolContext } from '../agent-factory';

export function createGetProjectContextTool(ctx: ToolContext) {
  return createTool({
    id: 'get_project_context',
    description: 'Get the project goal, context description, and skills for the current project.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      projectId: z.string(),
      projectName: z.string(),
      goal: z.string().nullable(),
      context: z.string().nullable(),
      sourceType: z.string().nullable(),
      connectionStatus: z.string().nullable(),
      workspacePath: z.string().nullable(),
      helperWorkspaceId: z.string().nullable(),
      repositoryUrl: z.string().nullable(),
      defaultBranch: z.string().nullable(),
      skills: z.array(z.object({ name: z.string(), scope: z.string(), content: z.string().nullable() })),
    }),
    execute: async () => {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, ctx.projectId),
      });

      if (!project) {
        return {
          projectId: ctx.projectId, projectName: 'Unknown', goal: null, context: null,
          sourceType: null, connectionStatus: null, workspacePath: null, helperWorkspaceId: null,
          repositoryUrl: null, defaultBranch: null, skills: [],
        };
      }

      const projectSkills = await db.query.skills.findMany({ where: eq(skills.projectId, ctx.projectId) });
      const globalSkills = await db.query.skills.findMany({ where: eq(skills.scope, 'global') });
      const allSkills = [...globalSkills, ...projectSkills].map((s) => ({
        name: s.name, scope: s.scope, content: s.contentMd,
      }));

      return {
        projectId: project.id,
        projectName: project.name,
        goal: project.goal,
        context: project.context,
        sourceType: project.sourceType,
        connectionStatus: project.connectionStatus,
        workspacePath: project.workspacePath,
        helperWorkspaceId: project.helperWorkspaceId,
        repositoryUrl: project.repositoryUrl,
        defaultBranch: project.defaultBranch,
        skills: allSkills,
      };
    },
  });
}

export function createListTasksTool(ctx: ToolContext) {
  return createTool({
    id: 'list_tasks',
    description: 'List other tasks in the same project. Use this to understand what other work is happening and avoid duplication.',
    inputSchema: z.object({
      statusFilter: z.enum(['backlog', 'open', 'in_progress', 'review', 'done', 'waiting_for_human', 'blocked', 'cancelled']).optional().describe('Optionally filter by task status'),
      limit: z.number().optional().default(20).describe('Maximum number of tasks to return'),
    }),
    outputSchema: z.object({
      tasks: z.array(z.object({
        id: z.string(), title: z.string(), status: z.string(), priority: z.string(), assignedAgentId: z.string().nullable(),
      })),
    }),
    execute: async (input) => {
      const allTasks = await db.query.tasks.findMany({
        where: eq(tasks.projectId, ctx.projectId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
        limit: input.limit ?? 20,
      });

      const filtered = allTasks
        .filter((t) => t.id !== ctx.taskId)
        .filter((t) => (input.statusFilter ? t.status === input.statusFilter : true));

      return {
        tasks: filtered.map((t) => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority, assignedAgentId: t.assignedAgentId,
        })),
      };
    },
  });
}
