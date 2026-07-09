/**
 * Workspace Tools — factory functions that create Mastra tools bound to a specific execution context.
 *
 * Context (taskId, agentId, projectId) is captured in closures at tool creation time,
 * avoiding the need to inject it through tool input (which Zod validation strips).
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects, tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  applyWorkspaceDiff,
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
import { isToolingTask } from '@/lib/orchestration/task-shape';

const MAX_LIST_RESULTS = 200;
const MAX_SEARCH_RESULTS = 40;
const MAX_TOOL_OUTPUT_CHARS = 12_000;

async function getWorkspacePath(projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project?.workspacePath) {
    throw new Error('This project does not have a connected workspace');
  }

  return project.workspacePath;
}

async function getTaskSummary(taskId: string) {
  return db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: {
      title: true,
      description: true,
    },
  });
}

function normalizeWorkspaceRelativePath(inputPath?: string): string {
  const normalized = (inputPath ?? '.').trim().replace(/\\/g, '/');

  if (!normalized || normalized === '.') {
    return '.';
  }

  if (normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error('Path must stay inside the workspace and be relative.');
  }

  return normalized.replace(/^\.?\//, '').replace(/\/+$/, '') || '.';
}

function truncateToolOutput(text: string): string {
  return text.length > MAX_TOOL_OUTPUT_CHARS
    ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... (truncated)`
    : text;
}

function summarizeRecursiveFiles(stdout: string, maxResults: number): string {
  const files = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const limited = files.slice(0, maxResults);
  const suffix =
    files.length > maxResults
      ? `\n... (${files.length - maxResults} more entries truncated)`
      : '';

  return limited.length > 0 ? `${limited.join('\n')}${suffix}` : '(no matching files)';
}

function summarizeTopLevelEntries(stdout: string, directory: string, maxResults: number): string {
  const dirPrefix = directory === '.' ? '' : `${directory}/`;
  const entries = new Set<string>();

  for (const line of stdout.split('\n').map((value) => value.trim()).filter(Boolean)) {
    if (dirPrefix && !line.startsWith(dirPrefix)) {
      continue;
    }

    const remainder = dirPrefix ? line.slice(dirPrefix.length) : line;
    if (!remainder) {
      continue;
    }

    const nextSegment = remainder.split('/')[0];
    if (!nextSegment) {
      continue;
    }

    entries.add(dirPrefix ? `${dirPrefix}${nextSegment}` : nextSegment);
  }

  const sorted = [...entries].sort();
  const limited = sorted.slice(0, maxResults);
  const suffix =
    sorted.length > maxResults
      ? `\n... (${sorted.length - maxResults} more entries truncated)`
      : '';

  return limited.length > 0 ? `${limited.join('\n')}${suffix}` : '(no matching files)';
}

function isPackageMutation(command: string, args: string[]): boolean {
  const pkgManager = ['npm', 'pnpm', 'yarn', 'bun'].includes(command);
  if (!pkgManager) {
    return false;
  }

  const argText = args.join(' ').toLowerCase();
  return (
    /\b(install|add|remove|unlink|update|upgrade|dedupe|rebuild)\b/.test(argText) ||
    argText.includes('audit fix') ||
    argText.includes('package-lock') ||
    argText.includes('lockfile')
  );
}

function isBroadGitMutation(command: string, args: string[]): boolean {
  if (command !== 'git') {
    return false;
  }

  const argText = args.join(' ').toLowerCase();
  return (
    /\b(reset|clean|restore|stash|rebase|merge|revert)\b/.test(argText) ||
    argText.includes('checkout --')
  );
}

async function commandPolicyReason(
  ctx: ToolContext,
  command: string,
  args: string[],
): Promise<string | null> {
  if (isBroadGitMutation(command, args)) {
    return 'Broad git cleanup and reset commands are blocked in workflow execution. Use the dedicated git tools instead.';
  }

  if (!isPackageMutation(command, args)) {
    return null;
  }

  const task = await getTaskSummary(ctx.taskId);
  if (!task || !isToolingTask(task)) {
    return 'Dependency and lockfile mutations are blocked for non-tooling tasks.';
  }

  return null;
}

export function createListWorkspaceFilesTool(ctx: ToolContext) {
  return createTool({
    id: 'list_workspace_files',
    description:
      'List files in the workspace with bounded output. Prefer narrow directories over broad recursive scans.',
    inputSchema: z.object({
      directory: z.string().optional().default('.').describe('Directory relative to the workspace root (default: root)'),
      recursive: z.boolean().optional().default(false).describe('If true, list files recursively (may be large)'),
    }),
    outputSchema: z.object({ files: z.string() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        const directory = normalizeWorkspaceRelativePath(input.directory);
        const args = [
          '--files',
          '--glob',
          '!node_modules/**',
          '--glob',
          '!.git/**',
          '--glob',
          '!dist/**',
        ];
        if (directory !== '.') {
          args.push(directory);
        }
        const result = await runWorkspaceCommand({ workspacePath, command: 'rg', args });
        if (result.exitCode !== 0 && !result.stdout.trim()) {
          return { files: '(no matching files)' };
        }

        const files = input.recursive
          ? summarizeRecursiveFiles(result.stdout, MAX_LIST_RESULTS)
          : summarizeTopLevelEntries(result.stdout, directory, MAX_LIST_RESULTS);
        return { files: truncateToolOutput(files) };
      } catch (err) {
        return { files: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}

export function createSearchWorkspaceTool(ctx: ToolContext) {
  return createTool({
    id: 'search_workspace',
    description:
      'Search workspace file contents for exact task terms with bounded output. Prefer this before broad file listing.',
    inputSchema: z.object({
      query: z.string().min(2).describe('Search text or regex-compatible literal to find in files'),
      directory: z.string().optional().default('src').describe('Directory relative to the workspace root'),
      maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional().default(20),
    }),
    outputSchema: z.object({ results: z.string() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        const directory = normalizeWorkspaceRelativePath(input.directory);
        const result = await runWorkspaceCommand({
          workspacePath,
          command: 'rg',
          args: [
            '-n',
            '-i',
            '--no-heading',
            '--glob',
            '!node_modules/**',
            '--glob',
            '!.git/**',
            '--glob',
            '!dist/**',
            input.query,
            directory,
          ],
        });

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          return { results: '(no matches)' };
        }

        const lines = result.stdout
          .split('\n')
          .map((line) => line.trimEnd())
          .filter(Boolean)
          .slice(0, input.maxResults);
        const suffix =
          result.stdout.split('\n').filter(Boolean).length > lines.length
            ? `\n... (additional matches truncated)`
            : '';

        return {
          results: truncateToolOutput(
            lines.length > 0 ? `${lines.join('\n')}${suffix}` : '(no matches)',
          ),
        };
      } catch (err) {
        return { results: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}

export function createReadWorkspaceFileTool(ctx: ToolContext) {
  return createTool({
    id: 'read_workspace_file',
    description: 'Read a file from the connected project workspace. Use list_workspace_files first to find the correct path. For large files, use startLine/maxLines to read specific sections.',
    inputSchema: z.object({
      relativePath: z.string().min(1).describe('Path relative to the workspace root'),
      startLine: z.number().int().min(1).optional().describe('First line to read (1-based). Defaults to 1.'),
      maxLines: z.number().int().min(1).max(500).optional().describe('Maximum lines to return. Only needed for targeted reads of large files.'),
    }),
    outputSchema: z.object({ content: z.string() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        const result = await readWorkspaceFile({ workspacePath, relativePath: input.relativePath });
        let content = result.content;

        const lines = content.split('\n');
        const totalLines = lines.length;
        const startIdx = (input.startLine ?? 1) - 1;
        const maxLines = input.maxLines ?? totalLines;
        const endIdx = Math.min(startIdx + maxLines, totalLines);

        if (startIdx > 0 || maxLines < totalLines) {
          const selectedLines = lines.slice(startIdx, endIdx);
          content = selectedLines
            .map((line, i) => `${startIdx + i + 1}: ${line}`)
            .join('\n');
          if (endIdx < totalLines) {
            content += `\n... (showing lines ${startIdx + 1}-${endIdx} of ${totalLines} total. Use startLine/maxLines to read other sections.)`;
          }
        }

        return { content: truncateToolOutput(content) };
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
    outputSchema: z.object({ saved: z.boolean(), message: z.string().optional() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        if (/goes here|existing code|placeholder/i.test(input.content)) {
          return {
            saved: false,
            message: 'Placeholder content is blocked. Read the real target file and write a concrete implementation only.',
          };
        }

        // Guard against destructive whole-file rewrites: replacing an existing
        // file with drastically smaller content almost always means fabricated
        // content that silently drops real sections (models under an
        // edit-or-fail directive do exactly this).
        try {
          const existing = await readWorkspaceFile({
            workspacePath,
            relativePath: input.relativePath,
          });
          const existingLength = existing.content.length;
          if (existingLength > 400 && input.content.length < existingLength * 0.5) {
            return {
              saved: false,
              message: `Refusing to replace ${input.relativePath} (${existingLength} chars) with much smaller content (${input.content.length} chars). Use apply_diff for targeted edits — full rewrites that shrink a file this much usually destroy unrelated sections.`,
            };
          }
        } catch {
          // File does not exist yet — creating it is fine.
        }

        await writeWorkspaceFile({ workspacePath, relativePath: input.relativePath, content: input.content });
        return { saved: true };
      } catch (err) {
        return {
          saved: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

export function createApplyDiffTool(ctx: ToolContext) {
  return createTool({
    id: 'apply_diff',
    description:
      'Apply a targeted search-and-replace edit to an existing file. The searchText must appear exactly once in the file (minor indentation differences are tolerated). Prefer this over write_workspace_file for small, focused edits. If it fails twice for the same file, stop retrying: read the file with read_workspace_file and rewrite it fully with write_workspace_file instead.',
    inputSchema: z.object({
      relativePath: z.string().min(1).describe('Path relative to the workspace root'),
      searchText: z.string().min(1).describe('Exact text to find in the file (must match uniquely)'),
      replaceText: z.string().describe('Replacement text to substitute'),
    }),
    outputSchema: z.object({ applied: z.boolean(), message: z.string().optional() }),
    execute: async (input) => {
      try {
        const workspacePath = await getWorkspacePath(ctx.projectId);
        return await applyWorkspaceDiff({
          workspacePath,
          relativePath: input.relativePath,
          searchText: input.searchText,
          replaceText: input.replaceText,
        });
      } catch (err) {
        return {
          applied: false,
          message: err instanceof Error ? err.message : String(err),
        };
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
        const policyReason = await commandPolicyReason(
          ctx,
          input.command,
          input.args ?? [],
        );
        if (policyReason) {
          return {
            stdout: '',
            stderr: policyReason,
            exitCode: 1,
          };
        }

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
