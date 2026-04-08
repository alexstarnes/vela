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
import { playbookMarkdownWithoutCorePrompt } from '@/lib/agent-orchestration/reference-docs';

import { createSubtaskTool, updateTaskStatusTool, addMessageTool } from './tools/task-tools';
import { getProjectContextTool, listTasksTool } from './tools/project-tools';
import {
  gitCheckoutTool,
  gitDiffTool,
  gitStatusTool,
  listWorkspaceFilesTool,
  readWorkspaceFileTool,
  runWorkspaceCommandTool,
  writeWorkspaceFileTool,
} from './tools/workspace-tools';

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

  // Full orchestration reference (capabilities, phases, anti-patterns, collaboration) from repo
  const playbook = playbookMarkdownWithoutCorePrompt(dbAgent.name);
  if (playbook) {
    parts.push(
      '\n## Role playbook (from agent-orchestration skill reference)\n\nThe following expands your role beyond the core instructions above: capabilities, model tier, phases, examples, anti-patterns, and handoff rules.\n',
    );
    parts.push(playbook);
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
      if (project.sourceType === 'github') {
        const repoLabel =
          project.sourceLabel ||
          (project.repositoryOwner && project.repositoryName
            ? `${project.repositoryOwner}/${project.repositoryName}`
            : project.repositoryUrl) ||
          'GitHub repository';
        parts.push(`Workspace source: GitHub (${repoLabel})`);
      } else if (project.sourceType === 'local') {
        parts.push('Workspace source: Local folder');
      } else {
        parts.push('Workspace source: Legacy/manual project');
      }
      if (project.connectionStatus) parts.push(`Connection status: ${project.connectionStatus}`);
      if (project.workspacePath) parts.push(`Workspace path: ${project.workspacePath}`);
      if (project.helperWorkspaceId) parts.push(`Helper workspace ID: ${project.helperWorkspaceId}`);
      if (project.repositoryUrl) parts.push(`Repository URL: ${project.repositoryUrl}`);
      if (project.defaultBranch) parts.push(`Default branch: ${project.defaultBranch}`);
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
        // Truncate skill content to ~2000 chars to conserve tokens
        if (skill.contentMd) {
          const content = skill.contentMd.length > 2000
            ? skill.contentMd.slice(0, 2000) + '\n... (truncated)'
            : skill.contentMd;
          parts.push(content);
        }
      }
    }
  }

  // Task context
  parts.push(`\n## Current Task`);
  parts.push(`Title: ${task.title}`);
  if (task.description) parts.push(`Description: ${task.description}`);
  parts.push(`Status: ${task.status}`);
  parts.push(`Priority: ${task.priority}`);

  // Recent events for continuity (limit to 5 to conserve tokens)
  const recentEvents = await db.query.taskEvents.findMany({
    where: eq(taskEvents.taskId, task.id),
    orderBy: [desc(taskEvents.createdAt)],
    limit: 5,
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
    'You MUST take direct action to complete the task. Do NOT just describe what you would do — actually do it using your tools.',
  );
  parts.push(
    'Follow this workflow:\n' +
    '1) Use list_workspace_files to discover the project file structure.\n' +
    '2) Use read_workspace_file to read the files you need to modify. You MUST read a file before writing to it.\n' +
    '3) Use write_workspace_file to write the COMPLETE updated file contents (not placeholders or comments).\n' +
    '4) Use update_task_status with status "review" when done.',
  );
  parts.push(
    'CRITICAL RULES:\n' +
    '- NEVER write placeholder code like "// Existing code..." — always write the full, real file contents.\n' +
    '- NEVER guess file paths — always use list_workspace_files first.\n' +
    '- NEVER repeat the same tool call twice.\n' +
    '- Do NOT create subtasks or ask questions — do the work yourself.',
  );

  const prompt = parts.join('\n');
  // Rough token estimate: ~4 chars per token
  console.log(`[agent-factory] System prompt for "${dbAgent.name}": ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);
  return prompt;
}

/**
 * Create a Mastra Agent instance from a DB agent row and a task.
 *
 * The agent is fully configured with:
 * - Resolved model (cloud or local, with fallback)
 * - Task and project tools with injected context
 * - System prompt built from agent config, project, skills, and task
 */
export interface MastraAgentResult {
  agent: Agent;
  provider: string;
  isFallback: boolean;
}

export async function createMastraAgent(
  dbAgent: DbAgent,
  task: Task,
): Promise<MastraAgentResult> {
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
    list_workspace_files: wrapToolWithContext(listWorkspaceFilesTool, toolCtx),
    read_workspace_file: wrapToolWithContext(readWorkspaceFileTool, toolCtx),
    write_workspace_file: wrapToolWithContext(writeWorkspaceFileTool, toolCtx),
    run_workspace_command: wrapToolWithContext(runWorkspaceCommandTool, toolCtx),
    git_status: wrapToolWithContext(gitStatusTool, toolCtx),
    git_diff: wrapToolWithContext(gitDiffTool, toolCtx),
    git_checkout: wrapToolWithContext(gitCheckoutTool, toolCtx),
  };

  // Create the Mastra Agent
  const agent = new Agent({
    id: `vela-agent-${dbAgent.id}`,
    name: dbAgent.name,
    instructions,
    model: resolved.modelId,
    tools: wrappedTools,
  });

  return { agent, provider: resolved.provider, isFallback: resolved.isFallback };
}
