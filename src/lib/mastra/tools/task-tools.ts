/**
 * Task Tools — factory functions that create Mastra tools bound to a specific execution context.
 *
 * Context is captured in closures at tool creation time.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { tasks, agents } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';
import { assertValidTransition, type TaskStatus } from '@/lib/tasks/state-machine';
import type { ToolContext } from '../agent-factory';

/**
 * Check if all subtasks of a parent are done/review, and if so, auto-transition the parent to review.
 */
async function maybeCompleteParentTask(parentTaskId: string, agentId: string): Promise<void> {
  try {
    const parentTask = await db.query.tasks.findFirst({
      where: eq(tasks.id, parentTaskId),
    });
    if (!parentTask) return;

    const parentStatus = parentTask.status as TaskStatus;
    if (parentStatus !== 'in_progress' && parentStatus !== 'waiting_for_human') return;

    const subtasks = await db.query.tasks.findMany({
      where: eq(tasks.parentTaskId, parentTaskId),
    });

    if (subtasks.length === 0) return;

    const allComplete = subtasks.every(
      (t) => t.status === 'done' || t.status === 'review',
    );

    if (allComplete) {
      await db
        .update(tasks)
        .set({ status: 'review', updatedAt: new Date() })
        .where(eq(tasks.id, parentTaskId));

      await logTaskEvent({
        taskId: parentTaskId,
        agentId,
        eventType: 'status_change',
        payload: {
          from: parentStatus,
          to: 'review',
          reason: `All ${subtasks.length} subtask(s) completed — auto-transitioned to review`,
        },
      });

      console.log(`[completion-aggregation] Parent task ${parentTaskId} auto-transitioned to review (${subtasks.length} subtasks complete)`);
    }
  } catch (err) {
    console.error(`[completion-aggregation] Failed to check parent task ${parentTaskId}:`, err);
  }
}

export function createCreateSubtaskTool(ctx: ToolContext) {
  return createTool({
    id: 'create_subtask',
    description:
      'Create a new subtask under the current task. Use this to delegate work to another agent or break work into smaller pieces.',
    inputSchema: z.object({
      title: z.string().describe('Title of the subtask'),
      description: z.string().optional().describe('Detailed description of what needs to be done'),
      assignedAgentId: z.string().uuid().optional().describe('UUID of the agent to assign this subtask to'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium').describe('Priority level'),
    }),
    outputSchema: z.object({ subtaskId: z.string(), success: z.boolean(), message: z.string() }),
    execute: async (input) => {
      try {
        const initialStatus = input.assignedAgentId ? 'open' : 'backlog';

        const [subtask] = await db
          .insert(tasks)
          .values({
            title: input.title,
            description: input.description ?? null,
            projectId: ctx.projectId,
            parentTaskId: ctx.taskId,
            assignedAgentId: input.assignedAgentId ?? null,
            createdByAgentId: ctx.agentId,
            priority: input.priority ?? 'medium',
            status: initialStatus,
          })
          .returning({ id: tasks.id });

        await logTaskEvent({
          taskId: ctx.taskId,
          agentId: ctx.agentId,
          eventType: 'delegation',
          payload: { subtask_id: subtask.id, title: input.title, assigned_to: input.assignedAgentId ?? null },
        });

        await logTaskEvent({
          taskId: subtask.id,
          agentId: ctx.agentId,
          eventType: 'status_change',
          payload: { from: null, to: initialStatus, reason: input.assignedAgentId ? 'Created by agent delegation (auto-opened)' : 'Created by agent delegation' },
        });

        return { subtaskId: subtask.id, success: true, message: `Subtask "${input.title}" created successfully` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { subtaskId: '', success: false, message: `Failed to create subtask: ${msg}` };
      }
    },
  });
}

export function createUpdateTaskStatusTool(ctx: ToolContext) {
  return createTool({
    id: 'update_task_status',
    description: 'Transition the current task to a new status. The transition must be valid per the task state machine.',
    inputSchema: z.object({
      status: z.enum(['backlog', 'open', 'in_progress', 'review', 'done', 'waiting_for_human', 'blocked', 'cancelled']).describe('The target status to transition to'),
      reason: z.string().optional().describe('Reason for the status change'),
    }),
    outputSchema: z.object({ success: z.boolean(), message: z.string() }),
    execute: async (input) => {
      try {
        const task = await db.query.tasks.findFirst({ where: eq(tasks.id, ctx.taskId) });
        if (!task) return { success: false, message: 'Task not found' };

        const fromStatus = task.status as TaskStatus;
        const toStatus = input.status as TaskStatus;

        assertValidTransition(fromStatus, toStatus);

        await db.update(tasks).set({ status: toStatus, updatedAt: new Date() }).where(eq(tasks.id, ctx.taskId));

        await logTaskEvent({
          taskId: ctx.taskId,
          agentId: ctx.agentId,
          eventType: 'status_change',
          payload: { from: fromStatus, to: toStatus, reason: input.reason ?? null },
        });

        if ((toStatus === 'done' || toStatus === 'review') && task.parentTaskId) {
          await maybeCompleteParentTask(task.parentTaskId, ctx.agentId);
        }

        return { success: true, message: `Task transitioned from ${fromStatus} to ${toStatus}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Failed to update status: ${msg}` };
      }
    },
  });
}

export function createAddMessageTool(ctx: ToolContext) {
  return createTool({
    id: 'add_message',
    description: 'Add a message to the current task thread. Use this to communicate progress, findings, or questions.',
    inputSchema: z.object({
      content: z.string().describe('The message content'),
      role: z.enum(['agent', 'system']).optional().default('agent').describe('Role of the message sender'),
    }),
    outputSchema: z.object({ success: z.boolean(), message: z.string() }),
    execute: async (input) => {
      try {
        await logTaskEvent({
          taskId: ctx.taskId,
          agentId: ctx.agentId,
          eventType: 'message',
          payload: { role: input.role ?? 'agent', content: input.content },
        });
        return { success: true, message: 'Message added' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Failed to add message: ${msg}` };
      }
    },
  });
}

export function createListAgentsTool(ctx: ToolContext) {
  return createTool({
    id: 'list_agents',
    description: 'List available agents in the current project with their roles, domains, and status. Use this to decide which agent to assign a subtask to.',
    inputSchema: z.object({
      domainFilter: z.enum(['meta', 'product', 'architecture', 'implementation', 'quality', 'operations']).optional().describe('Optionally filter by agent domain'),
    }),
    outputSchema: z.object({
      agents: z.array(z.object({ id: z.string(), name: z.string(), role: z.string(), domain: z.string(), status: z.string() })),
    }),
    execute: async (input) => {
      try {
        const projectAgents = await db.query.agents.findMany({
          where: and(
            eq(agents.projectId, ctx.projectId),
            eq(agents.agentKind, 'runtime'),
            eq(agents.status, 'active'),
          ),
        });
        const globalAgents = await db.query.agents.findMany({
          where: and(
            eq(agents.status, 'active'),
            eq(agents.agentKind, 'runtime'),
          ),
        });

        const allAgents = [...projectAgents, ...globalAgents];
        const seen = new Set<string>();
        const uniqueAgents = allAgents.filter((a) => {
          if (seen.has(a.id) || a.id === ctx.agentId) return false;
          seen.add(a.id);
          return true;
        });

        const filtered = input.domainFilter
          ? uniqueAgents.filter((a) => a.domain === input.domainFilter)
          : uniqueAgents;

        return {
          agents: filtered.map((a) => ({ id: a.id, name: a.name, role: a.role, domain: a.domain, status: a.status })),
        };
      } catch (err) {
        return { agents: [] };
      }
    },
  });
}
