/**
 * GitHub Tools — factory functions for GitHub API operations.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureFreshGitHubAccessToken } from '@/lib/github/oauth';
import type { ToolContext } from '../agent-factory';

export function createCreatePullRequestTool(ctx: ToolContext) {
  return createTool({
    id: 'create_pull_request',
    description: 'Create a GitHub pull request from the current branch to the default branch. Use this after pushing your changes.',
    inputSchema: z.object({
      title: z.string().min(1).describe('PR title'),
      body: z.string().optional().describe('PR description (markdown)'),
      head: z.string().optional().describe('Source branch name. If omitted, uses the current branch.'),
      base: z.string().optional().describe('Target branch name. If omitted, uses the project default branch.'),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      prUrl: z.string().nullable(),
      prNumber: z.number().nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      try {
        const project = await db.query.projects.findFirst({
          where: eq(projects.id, ctx.projectId),
        });

        if (!project?.repositoryOwner || !project?.repositoryName) {
          return { success: false, prUrl: null, prNumber: null, message: 'Project is not connected to a GitHub repository' };
        }

        const fresh = await ensureFreshGitHubAccessToken();
        if (!fresh) {
          return { success: false, prUrl: null, prNumber: null, message: 'GitHub is not connected' };
        }

        const owner = project.repositoryOwner;
        const repo = project.repositoryName;
        const base = input.base || project.defaultBranch || 'main';

        let head = input.head;
        if (!head && project.workspacePath) {
          const { runWorkspaceCommand } = await import('@/lib/helper/client');
          const result = await runWorkspaceCommand({
            workspacePath: project.workspacePath,
            command: 'git',
            args: ['branch', '--show-current'],
          });
          head = result.stdout.trim();
        }

        if (!head) {
          return { success: false, prUrl: null, prNumber: null, message: 'Could not determine source branch. Provide the "head" parameter.' };
        }

        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${fresh.accessToken}`,
              'User-Agent': 'vela-app',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: input.title, body: input.body ?? '', head, base }),
          },
        );

        if (!response.ok) {
          const errorBody = await response.text();
          return { success: false, prUrl: null, prNumber: null, message: `GitHub API error (${response.status}): ${errorBody}` };
        }

        const pr = (await response.json()) as { html_url: string; number: number };
        return { success: true, prUrl: pr.html_url, prNumber: pr.number, message: `Pull request #${pr.number} created successfully` };
      } catch (err) {
        return { success: false, prUrl: null, prNumber: null, message: `Failed to create PR: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}
