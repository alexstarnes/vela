/**
 * Task Tools — Mastra tools that agents can call during heartbeat execution.
 *
 * - create_subtask: create a child task (delegation)
 * - update_task_status: transition task status via state machine
 * - add_message: append a message event to the task thread
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';
import { assertValidTransition, type TaskStatus } from '@/lib/tasks/state-machine';

/**
 * Create a subtask (delegation) — the agent creates a child task
 * assigned to another agent (or the same agent).
 */
export const createSubtaskTool = createTool({
  id: 'create_subtask',
  description:
    'Create a new subtask under the current task. Use this to delegate work to another agent or break work into smaller pieces.',
  inputSchema: z.object({
    title: z.string().describe('Title of the subtask'),
    description: z.string().optional().describe('Detailed description of what needs to be done'),
    assignedAgentId: z.string().uuid().optional().describe('UUID of the agent to assign this subtask to'),
    priority: z
      .enum(['low', 'medium', 'high', 'urgent'])
      .optional()
      .default('medium')
      .describe('Priority level'),
  }),
  outputSchema: z.object({
    subtaskId: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    // These context values are injected by the heartbeat executor via tool wrapper
    const ctx = (input as Record<string, unknown>).__context as
      | { taskId: string; agentId: string; projectId: string }
      | undefined;

    if (!ctx) {
      return { subtaskId: '', success: false, message: 'Missing execution context' };
    }

    try {
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
          status: 'backlog',
        })
        .returning({ id: tasks.id });

      // Log delegation event on the parent task
      await logTaskEvent({
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        eventType: 'delegation',
        payload: {
          subtask_id: subtask.id,
          title: input.title,
          assigned_to: input.assignedAgentId ?? null,
        },
      });

      // Log creation event on the subtask
      await logTaskEvent({
        taskId: subtask.id,
        agentId: ctx.agentId,
        eventType: 'status_change',
        payload: { from: null, to: 'backlog', reason: 'Created by agent delegation' },
      });

      return {
        subtaskId: subtask.id,
        success: true,
        message: `Subtask "${input.title}" created successfully`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { subtaskId: '', success: false, message: `Failed to create subtask: ${msg}` };
    }
  },
});

/**
 * Update the status of the current task via the state machine.
 */
export const updateTaskStatusTool = createTool({
  id: 'update_task_status',
  description:
    'Transition the current task to a new status. The transition must be valid per the task state machine.',
  inputSchema: z.object({
    status: z
      .enum(['backlog', 'open', 'in_progress', 'review', 'done', 'waiting_for_human', 'blocked', 'cancelled'])
      .describe('The target status to transition to'),
    reason: z.string().optional().describe('Reason for the status change'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as
      | { taskId: string; agentId: string }
      | undefined;

    if (!ctx) {
      return { success: false, message: 'Missing execution context' };
    }

    try {
      const task = await db.query.tasks.findFirst({
        where: eq(tasks.id, ctx.taskId),
      });

      if (!task) {
        return { success: false, message: 'Task not found' };
      }

      const fromStatus = task.status as TaskStatus;
      const toStatus = input.status as TaskStatus;

      assertValidTransition(fromStatus, toStatus);

      await db
        .update(tasks)
        .set({ status: toStatus, updatedAt: new Date() })
        .where(eq(tasks.id, ctx.taskId));

      await logTaskEvent({
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        eventType: 'status_change',
        payload: {
          from: fromStatus,
          to: toStatus,
          reason: input.reason ?? null,
        },
      });

      return {
        success: true,
        message: `Task transitioned from ${fromStatus} to ${toStatus}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Failed to update status: ${msg}` };
    }
  },
});

/**
 * Append a message to the task thread.
 */
export const addMessageTool = createTool({
  id: 'add_message',
  description: 'Add a message to the current task thread. Use this to communicate progress, findings, or questions.',
  inputSchema: z.object({
    content: z.string().describe('The message content'),
    role: z
      .enum(['agent', 'system'])
      .optional()
      .default('agent')
      .describe('Role of the message sender'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as
      | { taskId: string; agentId: string }
      | undefined;

    if (!ctx) {
      return { success: false, message: 'Missing execution context' };
    }

    try {
      await logTaskEvent({
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        eventType: 'message',
        payload: {
          role: input.role ?? 'agent',
          content: input.content,
        },
      });

      return { success: true, message: 'Message added' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Failed to add message: ${msg}` };
    }
  },
});
