/**
 * Workspace Tools — factory functions that create Mastra tools bound to a specific execution context.
 *
 * Context (taskId, agentId, projectId) is captured in closures at tool creation time,
 * avoiding the need to inject it through tool input (which Zod validation strips).
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  checkoutWorkspaceGitRef,
  gitAdd,
  gitCommit,
  gitPush,
  getWorkspaceGitDiff,
  getWorkspaceGitStatus,
  readWorkspaceFile,
  runWorkspaceCommand,
  writeWorkspaceFile,
} from '@/lib/helper/client';
import type { ToolContext } from '../agent-factory';

async function getWorkspacePath(projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project?.workspacePath) {
    throw new Error('This project does not have a connected workspace');
  }

  return project.workspacePath;
}

export function createListWorkspaceFilesTool(ctx: ToolContext) {
  return createTool({
    id: 'list_workspace_files',
    description:
      'List files and directories in the workspace. Use this FIRST to discover the project structure before reading or writing files.',
    inputSchema: z.object({
      directory: z.string().optional().default('.').describe('Directory relative to the workspace root (default: root)'),
      recursive: z.boolean().optional().default(false).describe('If true, list files recursively (may be large)'),
    }),
    outputSchema: z.object({ files: z.string() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        const args = input.recursive ? ['-R', input.directory ?? '.'] : [input.directory ?? '.'];
        const result = await runWorkspaceCommand({ workspacePath, command: 'ls', args });
        return { files: result.stdout || '(empty directory)' };
      } catch (err) {
        return { files: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}

export function createReadWorkspaceFileTool(ctx: ToolContext) {
  return createTool({
    id: 'read_workspace_file',
    description: 'Read a file from the connected project workspace. Use list_workspace_files first to find the correct path.',
    inputSchema: z.object({
      relativePath: z.string().min(1).describe('Path relative to the workspace root'),
    }),
    outputSchema: z.object({ content: z.string() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        return await readWorkspaceFile({ workspacePath, relativePath: input.relativePath });
      } catch (err) {
        return { content: `ERROR: File not found or unreadable: "${input.relativePath}" — ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}

export function createWriteWorkspaceFileTool(ctx: ToolContext) {
  return createTool({
    id: 'write_workspace_file',
    description: 'Write text content to a file in the connected project workspace.',
    inputSchema: z.object({
      relativePath: z.string().min(1).describe('Path relative to the workspace root'),
      content: z.string().describe('Full file contents to write'),
    }),
    outputSchema: z.object({ saved: z.boolean() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        return await writeWorkspaceFile({ workspacePath, relativePath: input.relativePath, content: input.content });
      } catch (err) {
        return { saved: false };
      }
    },
  });
}

export function createRunWorkspaceCommandTool(ctx: ToolContext) {
  return createTool({
    id: 'run_workspace_command',
    description: 'Run a command inside the connected project workspace.',
    inputSchema: z.object({
      command: z.string().min(1).describe('Executable name'),
      args: z.array(z.string()).optional().describe('Arguments passed to the command'),
    }),
    outputSchema: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        return await runWorkspaceCommand({ workspacePath, command: input.command, args: input.args });
      } catch (err) {
        return { stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: 1 };
      }
    },
  });
}

export function createGitStatusTool(ctx: ToolContext) {
  return createTool({
    id: 'git_status',
    description: 'Get git status for the connected project workspace.',
    inputSchema: z.object({}),
    outputSchema: z.object({ stdout: z.string() }),
    execute: async () => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        return await getWorkspaceGitStatus({ workspacePath });
      } catch (err) {
        return { stdout: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}

export function createGitDiffTool(ctx: ToolContext) {
  return createTool({
    id: 'git_diff',
    description: 'Get git diff for the connected project workspace, optionally scoped to one relative path.',
    inputSchema: z.object({ relativePath: z.string().optional() }),
    outputSchema: z.object({ stdout: z.string() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        return await getWorkspaceGitDiff({ workspacePath, relativePath: input.relativePath });
      } catch (err) {
        return { stdout: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}

export function createGitCheckoutTool(ctx: ToolContext) {
  return createTool({
    id: 'git_checkout',
    description: 'Check out an existing branch/ref, or create a new branch inside the connected project workspace.',
    inputSchema: z.object({
      ref: z.string().min(1).describe('Branch or ref name'),
      createNew: z.boolean().optional().default(false),
      startPoint: z.string().optional().describe('Optional start point when creating a new branch'),
    }),
    outputSchema: z.object({ stdout: z.string() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        return await checkoutWorkspaceGitRef({ workspacePath, ref: input.ref, createNew: input.createNew, startPoint: input.startPoint });
      } catch (err) {
        return { stdout: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}

export function createGitCommitTool(ctx: ToolContext) {
  return createTool({
    id: 'git_commit',
    description: 'Stage changed files and commit them with a message. Use this after writing files to save your changes.',
    inputSchema: z.object({
      message: z.string().min(1).describe('Commit message describing the changes'),
      files: z.array(z.string()).optional().describe('Specific files to stage (relative paths). If omitted, stages all changed files.'),
    }),
    outputSchema: z.object({ stdout: z.string(), commitSha: z.string().nullable() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        await gitAdd({ workspacePath, files: input.files });
        return await gitCommit({ workspacePath, message: input.message });
      } catch (err) {
        return { stdout: `ERROR: ${err instanceof Error ? err.message : String(err)}`, commitSha: null };
      }
    },
  });
}

export function createGitPushTool(ctx: ToolContext) {
  return createTool({
    id: 'git_push',
    description: 'Push committed changes to the remote repository. Use this after committing to share your work.',
    inputSchema: z.object({
      setUpstream: z.boolean().optional().default(true).describe('Set upstream tracking for the current branch (default: true)'),
    }),
    outputSchema: z.object({ stdout: z.string() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        return await gitPush({ workspacePath, setUpstream: input.setUpstream });
      } catch (err) {
        return { stdout: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}
