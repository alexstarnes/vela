import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  checkoutWorkspaceGitRef,
  getWorkspaceGitDiff,
  getWorkspaceGitStatus,
  readWorkspaceFile,
  runWorkspaceCommand,
  writeWorkspaceFile,
} from '@/lib/helper/client';

async function getWorkspacePath(projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project?.workspacePath) {
    throw new Error('This project does not have a connected workspace');
  }

  return project.workspacePath;
}

export const listWorkspaceFilesTool = createTool({
  id: 'list_workspace_files',
  description:
    'List files and directories in the workspace. Use this FIRST to discover the project structure before reading or writing files.',
  inputSchema: z.object({
    directory: z
      .string()
      .optional()
      .default('.')
      .describe('Directory relative to the workspace root (default: root)'),
    recursive: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, list files recursively (may be large)'),
  }),
  outputSchema: z.object({
    files: z.string(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as { projectId: string } | undefined;
    if (!ctx) return { files: 'ERROR: Missing execution context' };
    try {
      const workspacePath = await getWorkspacePath(ctx.projectId);
      const args = input.recursive
        ? ['-R', input.directory ?? '.']
        : [input.directory ?? '.'];
      const result = await runWorkspaceCommand({ workspacePath, command: 'ls', args });
      return { files: result.stdout || '(empty directory)' };
    } catch (err) {
      return { files: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

export const readWorkspaceFileTool = createTool({
  id: 'read_workspace_file',
  description: 'Read a file from the connected project workspace. Use list_workspace_files first to find the correct path.',
  inputSchema: z.object({
    relativePath: z.string().min(1).describe('Path relative to the workspace root'),
  }),
  outputSchema: z.object({
    content: z.string(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as { projectId: string } | undefined;
    if (!ctx) return { content: 'ERROR: Missing execution context' };
    try {
      const workspacePath = await getWorkspacePath(ctx.projectId);
      return await readWorkspaceFile({ workspacePath, relativePath: input.relativePath });
    } catch (err) {
      return { content: `ERROR: File not found or unreadable: "${input.relativePath}" — ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

export const writeWorkspaceFileTool = createTool({
  id: 'write_workspace_file',
  description: 'Write text content to a file in the connected project workspace.',
  inputSchema: z.object({
    relativePath: z.string().min(1).describe('Path relative to the workspace root'),
    content: z.string().describe('Full file contents to write'),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as { projectId: string } | undefined;
    if (!ctx) return { saved: false };
    const workspacePath = await getWorkspacePath(ctx.projectId);
    return writeWorkspaceFile({
      workspacePath,
      relativePath: input.relativePath,
      content: input.content,
    });
  },
});

export const runWorkspaceCommandTool = createTool({
  id: 'run_workspace_command',
  description: 'Run a command inside the connected project workspace.',
  inputSchema: z.object({
    command: z.string().min(1).describe('Executable name'),
    args: z.array(z.string()).optional().describe('Arguments passed to the command'),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as { projectId: string } | undefined;
    if (!ctx) return { stdout: '', stderr: 'Missing execution context', exitCode: 1 };
    const workspacePath = await getWorkspacePath(ctx.projectId);
    return runWorkspaceCommand({
      workspacePath,
      command: input.command,
      args: input.args,
    });
  },
});

export const gitStatusTool = createTool({
  id: 'git_status',
  description: 'Get git status for the connected project workspace.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    stdout: z.string(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as { projectId: string } | undefined;
    if (!ctx) return { stdout: '' };
    const workspacePath = await getWorkspacePath(ctx.projectId);
    return getWorkspaceGitStatus({ workspacePath });
  },
});

export const gitDiffTool = createTool({
  id: 'git_diff',
  description: 'Get git diff for the connected project workspace, optionally scoped to one relative path.',
  inputSchema: z.object({
    relativePath: z.string().optional(),
  }),
  outputSchema: z.object({
    stdout: z.string(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as { projectId: string } | undefined;
    if (!ctx) return { stdout: '' };
    const workspacePath = await getWorkspacePath(ctx.projectId);
    return getWorkspaceGitDiff({
      workspacePath,
      relativePath: input.relativePath,
    });
  },
});

export const gitCheckoutTool = createTool({
  id: 'git_checkout',
  description: 'Check out an existing branch/ref, or create a new branch inside the connected project workspace.',
  inputSchema: z.object({
    ref: z.string().min(1).describe('Branch or ref name'),
    createNew: z.boolean().optional().default(false),
    startPoint: z.string().optional().describe('Optional start point when creating a new branch'),
  }),
  outputSchema: z.object({
    stdout: z.string(),
  }),
  execute: async (input) => {
    const ctx = (input as Record<string, unknown>).__context as { projectId: string } | undefined;
    if (!ctx) return { stdout: '' };
    const workspacePath = await getWorkspacePath(ctx.projectId);
    return checkoutWorkspaceGitRef({
      workspacePath,
      ref: input.ref,
      createNew: input.createNew,
      startPoint: input.startPoint,
    });
  },
});
