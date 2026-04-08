/**
 * Agent Factory — creates a Mastra Agent instance dynamically from a DB agent row.
 *
 * Given a DB agent record and a task, this builds a fully-configured Mastra Agent
 * with tools, system prompt, and model resolution.
 *
 * Tools are created per-invocation using factory functions that capture the execution
 * context (taskId, agentId, projectId) in closures. This avoids injecting context
 * through tool input, which Mastra's Zod validation strips.
 */

import { Agent } from '@mastra/core/agent';
import { db } from '@/lib/db';
import { skills, projects, taskEvents } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { Agent as DbAgent, Task } from '@/lib/db/schema';
import { resolveModel } from './router';
import { playbookMarkdownWithoutCorePrompt } from '@/lib/agent-orchestration/reference-docs';
import { getRuntimeAgentDefinition } from './agents';
import {
  injectImplementationTemplates,
  injectReviewerTemplates,
} from '@/lib/orchestration/template-injector';
import { loadRepoGuidanceMarkdown } from '@/lib/orchestration/playbook-loader';

import { createCreateSubtaskTool, createUpdateTaskStatusTool, createAddMessageTool, createListAgentsTool } from './tools/task-tools';
import { createGetProjectContextTool, createListTasksTool } from './tools/project-tools';
import {
  createGitCheckoutTool,
  createGitCommitTool,
  createGitDiffTool,
  createGitPushTool,
  createGitStatusTool,
  createListWorkspaceFilesTool,
  createReadWorkspaceFileTool,
  createRunWorkspaceCommandTool,
  createWriteWorkspaceFileTool,
} from './tools/workspace-tools';
import { createCreatePullRequestTool } from './tools/github-tools';
import {
  createRunBuildTool,
  createRunLintTool,
  createRunSecurityAuditTool,
  createRunTestsTool,
  createRunTypecheckTool,
} from './tools/verification-tools';

/**
 * Execution context passed to tool factory functions.
 */
export interface ToolContext {
  taskId: string;
  agentId: string;
  projectId: string;
}

/**
 * Build the system prompt for an agent given its config, task, and project.
 */
async function buildSystemPrompt(
  dbAgent: DbAgent,
  task: Task,
): Promise<string> {
  const parts: string[] = [];
  const runtimeDefinition = dbAgent.agentKind === 'runtime'
    ? getRuntimeAgentDefinition(dbAgent.name)
    : null;

  // Base agent prompt
  if (runtimeDefinition) {
    parts.push(runtimeDefinition.systemPrompt);
  } else if (dbAgent.systemPrompt) {
    parts.push(dbAgent.systemPrompt);
  } else {
    parts.push(
      `You are ${dbAgent.name}, a ${dbAgent.role} agent. Complete the assigned task thoroughly and accurately.`,
    );
  }

  // Full orchestration reference (capabilities, phases, anti-patterns, collaboration) from repo
  const playbookName = dbAgent.name === 'Supervisor' ? 'Orchestrator' : dbAgent.name;
  const playbook = playbookMarkdownWithoutCorePrompt(playbookName);
  if (playbook) {
    parts.push(
      '\n## Role playbook (from agent-orchestration skill reference)\n\nThe following expands your role beyond the core instructions above: capabilities, model tier, phases, examples, anti-patterns, and handoff rules.\n',
    );
    parts.push(playbook);
  }

  if (dbAgent.name === 'Implementer') {
    const templates = injectImplementationTemplates(task);
    if (templates.length > 0) {
      parts.push('\n## Specialist Templates\n');
      parts.push(...templates);
    }
  } else if (dbAgent.name === 'Reviewer') {
    const templates = injectReviewerTemplates(task);
    if (templates.length > 0) {
      parts.push('\n## Review Templates\n');
      parts.push(...templates);
    }
  }

  const repoGuidance = loadRepoGuidanceMarkdown(task);
  if (repoGuidance.length > 0) {
    parts.push('\n## Repo Guidance\n');
    parts.push(...repoGuidance);
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
  parts.push(`Failure count: ${task.failureCount}`);

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
  if (dbAgent.name === 'Supervisor') {
    parts.push(
      'Use the available read-only tools to inspect repository context when needed. Produce plans and summaries only; do not attempt code changes or task-final status transitions.',
    );
  } else if (dbAgent.name === 'Implementer') {
    parts.push(
      'You MUST take direct action using your tools. Read files before changing them, make the smallest coherent code edits, and leave a concise implementation summary for verification.',
    );
    parts.push(
      'Workflow requirements:\n' +
      '1) Use list_workspace_files to discover the project structure before reading or writing.\n' +
      '2) Read files before writing them.\n' +
      '3) Write complete file contents when using write_workspace_file.\n' +
      '4) Use focused workspace commands to validate your changes while implementing.\n' +
      '5) Do not transition the task status; verification and final status changes happen after your step.',
    );
    parts.push(
      'CRITICAL RULES:\n' +
      '- NEVER write placeholder code like "// Existing code..." — always write the full, real file contents.\n' +
      '- NEVER guess file paths — always use list_workspace_files first.\n' +
      '- NEVER repeat the same failing tool call without changing approach.',
    );
  } else if (dbAgent.name === 'Verifier') {
    parts.push(
      'Verification is mechanical. Run the ordered gates and return factual results only. Do not infer success without command output.',
    );
  } else if (dbAgent.name === 'Repo Mapper') {
    parts.push(
      'Inspect the repository and return concise, factual implementation guidance. Prefer concrete file paths, boundary notes, and dependency observations over prose.',
    );
  } else if (dbAgent.name === 'Reviewer') {
    parts.push(
      'Review the current implementation state and diff only. Do not edit files, do not commit, and focus on correctness, risk, missing validation, and plan adherence.',
    );
  } else {
    parts.push(
      'You MUST take direct action to complete the task. Do NOT just describe what you would do — actually do it using your tools.',
    );
    parts.push(
      'Follow this workflow:\n' +
      '1) Use list_workspace_files to discover the project file structure.\n' +
      '2) Use read_workspace_file to read the files you need to modify. You MUST read a file before writing to it.\n' +
      '3) Use write_workspace_file to write the COMPLETE updated file contents (not placeholders or comments).\n' +
      '4) Use git_commit to commit your changes with a descriptive commit message.\n' +
      '5) Use update_task_status with status "review" when done.',
    );
    parts.push(
      'CRITICAL RULES:\n' +
      '- NEVER write placeholder code like "// Existing code..." — always write the full, real file contents.\n' +
      '- NEVER guess file paths — always use list_workspace_files first.\n' +
      '- NEVER repeat the same tool call twice.\n' +
      '- Do NOT create subtasks or ask questions — do the work yourself.',
    );
  }

  const prompt = parts.join('\n');
  console.log(`[agent-factory] System prompt for "${dbAgent.name}": ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);
  return prompt;
}

/**
 * Create a Mastra Agent instance from a DB agent row and a task.
 */
export interface MastraAgentResult {
  agent: Agent;
  provider: string;
  isFallback: boolean;
  resolvedModelId: string | null;
}

export async function createMastraAgent(
  dbAgent: DbAgent,
  task: Task,
  modelOverride?: string,
): Promise<MastraAgentResult> {
  // Resolve the model (or use the override if provided, e.g. during fallback)
  const resolved = modelOverride
    ? {
        modelId: modelOverride,
        isFallback: true,
        provider: (modelOverride.split('/')[0] || 'anthropic') as 'anthropic' | 'openai' | 'ollama',
      }
    : await resolveModel(
        dbAgent.modelConfigId,
        task.id,
        dbAgent.id,
      );

  // Build the system prompt
  const instructions = await buildSystemPrompt(dbAgent, task);

  // Create the tool context — captured by tool factory closures
  const ctx: ToolContext = {
    taskId: task.id,
    agentId: dbAgent.id,
    projectId: task.projectId,
  };

  const isRuntimeAgent = dbAgent.agentKind === 'runtime';
  const runtimeAgentName = isRuntimeAgent ? dbAgent.name : null;
  const isLegacyOrchestrator = dbAgent.domain === 'meta' && /orchestrat/i.test(dbAgent.role);

  // Common tools available to all agents
  const commonTools = {
    add_message: createAddMessageTool(ctx),
    get_project_context: createGetProjectContextTool(ctx),
    list_tasks: createListTasksTool(ctx),
  };

  const legacyCommonTools = {
    ...commonTools,
    update_task_status: createUpdateTaskStatusTool(ctx),
  };

  // Orchestrator gets delegation + agent discovery tools
  const legacyOrchestratorTools = {
    ...legacyCommonTools,
    create_subtask: createCreateSubtaskTool(ctx),
    list_agents: createListAgentsTool(ctx),
  };

  const supervisorTools = {
    ...commonTools,
    list_workspace_files: createListWorkspaceFilesTool(ctx),
    read_workspace_file: createReadWorkspaceFileTool(ctx),
    run_workspace_command: createRunWorkspaceCommandTool(ctx),
    git_status: createGitStatusTool(ctx),
    git_diff: createGitDiffTool(ctx),
  };

  const runtimeImplementerTools = {
    ...commonTools,
    list_workspace_files: createListWorkspaceFilesTool(ctx),
    read_workspace_file: createReadWorkspaceFileTool(ctx),
    write_workspace_file: createWriteWorkspaceFileTool(ctx),
    run_workspace_command: createRunWorkspaceCommandTool(ctx),
    git_status: createGitStatusTool(ctx),
    git_diff: createGitDiffTool(ctx),
    git_checkout: createGitCheckoutTool(ctx),
    git_commit: createGitCommitTool(ctx),
    git_push: createGitPushTool(ctx),
    create_pull_request: createCreatePullRequestTool(ctx),
    run_lint: createRunLintTool(ctx),
    run_typecheck: createRunTypecheckTool(ctx),
    run_tests: createRunTestsTool(ctx),
    run_build: createRunBuildTool(ctx),
  };

  const repoMapperTools = {
    ...commonTools,
    list_workspace_files: createListWorkspaceFilesTool(ctx),
    read_workspace_file: createReadWorkspaceFileTool(ctx),
    run_workspace_command: createRunWorkspaceCommandTool(ctx),
    git_status: createGitStatusTool(ctx),
    git_diff: createGitDiffTool(ctx),
  };

  const reviewerTools = {
    ...commonTools,
    list_workspace_files: createListWorkspaceFilesTool(ctx),
    read_workspace_file: createReadWorkspaceFileTool(ctx),
    run_workspace_command: createRunWorkspaceCommandTool(ctx),
    git_status: createGitStatusTool(ctx),
    git_diff: createGitDiffTool(ctx),
    run_lint: createRunLintTool(ctx),
    run_typecheck: createRunTypecheckTool(ctx),
    run_tests: createRunTestsTool(ctx),
    run_build: createRunBuildTool(ctx),
    run_security_audit: createRunSecurityAuditTool(ctx),
  };

  const verifierTools = {
    ...commonTools,
    run_lint: createRunLintTool(ctx),
    run_typecheck: createRunTypecheckTool(ctx),
    run_tests: createRunTestsTool(ctx),
    run_build: createRunBuildTool(ctx),
    run_security_audit: createRunSecurityAuditTool(ctx),
  };

  const legacyImplementationTools = {
    ...legacyCommonTools,
    create_subtask: createCreateSubtaskTool(ctx),
    list_workspace_files: createListWorkspaceFilesTool(ctx),
    read_workspace_file: createReadWorkspaceFileTool(ctx),
    write_workspace_file: createWriteWorkspaceFileTool(ctx),
    run_workspace_command: createRunWorkspaceCommandTool(ctx),
    git_status: createGitStatusTool(ctx),
    git_diff: createGitDiffTool(ctx),
    git_checkout: createGitCheckoutTool(ctx),
    git_commit: createGitCommitTool(ctx),
    git_push: createGitPushTool(ctx),
    create_pull_request: createCreatePullRequestTool(ctx),
  };

  const tools =
    runtimeAgentName === 'Supervisor'
      ? supervisorTools
      : runtimeAgentName === 'Implementer'
        ? runtimeImplementerTools
        : runtimeAgentName === 'Repo Mapper'
          ? repoMapperTools
          : runtimeAgentName === 'Reviewer'
            ? reviewerTools
            : runtimeAgentName === 'Verifier'
              ? verifierTools
              : isLegacyOrchestrator
                ? legacyOrchestratorTools
                : legacyImplementationTools;

  // Create the Mastra Agent
  const agent = new Agent({
    id: `vela-agent-${dbAgent.id}`,
    name: dbAgent.name,
    instructions,
    model: resolved.modelId,
    tools,
  });

  return {
    agent,
    provider: resolved.provider,
    isFallback: resolved.isFallback,
    resolvedModelId: typeof resolved.modelId === 'string' ? resolved.modelId : 'ollama/local',
  };
}
