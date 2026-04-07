/**
 * Agent Factory — creates a Mastra Agent instance dynamically from a DB agent row.
 *
 * Given a DB agent record and a task, this builds a fully-configured Mastra Agent
 * with tools, system prompt, and model resolution.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { db } from '@/lib/db';
import { skills, projects, taskEvents } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { Agent as DbAgent, Task } from '@/lib/db/schema';
import { resolveModel } from './router';

import { createSubtaskTool, updateTaskStatusTool, addMessageTool } from './tools/task-tools';
import { getProjectContextTool, listTasksTool } from './tools/project-tools';

/**
 * Execution context injected into all tool calls.
 */
export interface ToolContext {
  taskId: string;
  agentId: string;
  projectId: string;
}

/**
 * Wraps a Mastra tool to inject __context into its input before execution.
 * This is how we pass task/agent/project IDs to tool execute functions
 * without the LLM needing to know about them.
 */
function wrapToolWithContext<T extends ReturnType<typeof createTool>>(
  tool: T,
  context: ToolContext,
): T {
  const originalExecute = tool.execute;
  if (!originalExecute) return tool;

  // Create a new tool with the same config but wrapped execute
  const wrappedTool = createTool({
    id: tool.id,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    execute: async (input: Record<string, unknown>) => {
      // Inject context as a hidden property
      const enrichedInput = { ...input, __context: context };
      return (originalExecute as (input: Record<string, unknown>) => Promise<unknown>)(enrichedInput);
    },
  });

  return wrappedTool as T;
}

/**
 * Build the system prompt for an agent given its config, task, and project.
 */
async function buildSystemPrompt(
  dbAgent: DbAgent,
  task: Task,
): Promise<string> {
  const parts: string[] = [];

  // Base agent prompt
  if (dbAgent.systemPrompt) {
    parts.push(dbAgent.systemPrompt);
  } else {
    parts.push(
      `You are ${dbAgent.name}, a ${dbAgent.role} agent. Complete the assigned task thoroughly and accurately.`,
    );
  }

  // Project context
  if (task.projectId) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, task.projectId),
    });
    if (project) {
      parts.push(`\n## Project: ${project.name}`);
      if (project.goal) parts.push(`Goal: ${project.goal}`);
      if (project.context) parts.push(`Context: ${project.context}`);
    }

    // Skills (global + project-scoped)
    const projectSkills = await db.query.skills.findMany({
      where: eq(skills.projectId, task.projectId),
    });
    const globalSkills = await db.query.skills.findMany({
      where: eq(skills.scope, 'global'),
    });
    const allSkills = [...globalSkills, ...projectSkills];
    if (allSkills.length > 0) {
      parts.push('\n## Relevant Skills');
      for (const skill of allSkills) {
        parts.push(`### ${skill.name} (${skill.scope})`);
        if (skill.contentMd) parts.push(skill.contentMd);
      }
    }
  }

  // Task context
  parts.push(`\n## Current Task`);
  parts.push(`Title: ${task.title}`);
  if (task.description) parts.push(`Description: ${task.description}`);
  parts.push(`Status: ${task.status}`);
  parts.push(`Priority: ${task.priority}`);

  // Recent events for continuity
  const recentEvents = await db.query.taskEvents.findMany({
    where: eq(taskEvents.taskId, task.id),
    orderBy: [desc(taskEvents.createdAt)],
    limit: 10,
  });

  if (recentEvents.length > 0) {
    parts.push('\n## Recent Activity (newest first)');
    for (const evt of recentEvents) {
      const payload = evt.payload as Record<string, unknown> | null;
      const summary = payload
        ? JSON.stringify(payload).slice(0, 200)
        : '';
      parts.push(`- [${evt.eventType}] ${summary}`);
    }
  }

  parts.push('\n## Instructions');
  parts.push(
    'Complete the task. Use available tools to create subtasks, update status, add messages, and access project context as needed.',
  );
  parts.push(
    'When you are done, use update_task_status to move the task to "review" status.',
  );

  return parts.join('\n');
}

/**
 * Create a Mastra Agent instance from a DB agent row and a task.
 *
 * The agent is fully configured with:
 * - Resolved model (cloud or local, with fallback)
 * - Task and project tools with injected context
 * - System prompt built from agent config, project, skills, and task
 */
export async function createMastraAgent(
  dbAgent: DbAgent,
  task: Task,
): Promise<Agent> {
  // Resolve the model
  const resolved = await resolveModel(
    dbAgent.modelConfigId,
    task.id,
    dbAgent.id,
  );

  // Build the system prompt
  const instructions = await buildSystemPrompt(dbAgent, task);

  // Create the tool context
  const toolCtx: ToolContext = {
    taskId: task.id,
    agentId: dbAgent.id,
    projectId: task.projectId,
  };

  // Wrap all tools with context injection
  const wrappedTools = {
    create_subtask: wrapToolWithContext(createSubtaskTool, toolCtx),
    update_task_status: wrapToolWithContext(updateTaskStatusTool, toolCtx),
    add_message: wrapToolWithContext(addMessageTool, toolCtx),
    get_project_context: wrapToolWithContext(getProjectContextTool, toolCtx),
    list_tasks: wrapToolWithContext(listTasksTool, toolCtx),
  };

  // Create the Mastra Agent
  const agent = new Agent({
    id: `vela-agent-${dbAgent.id}`,
    name: dbAgent.name,
    instructions,
    model: resolved.modelId,
    tools: wrappedTools,
  });

  return agent;
}
