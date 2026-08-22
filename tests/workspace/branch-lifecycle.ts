/**
 * VERIFY A — workspace hygiene: branch-per-task lifecycle.
 *
 * Reproduces the failure this workstream exists to fix, against a real git
 * repository driven through the real helper endpoints:
 *
 *   Task 1 implements and fails review, leaving work in the shared tree.
 *   Task 2 then runs on the same project.
 *
 * Asserts:
 *   1. task 2's review diff contains ONLY task 2's changes
 *   2. task 1's leftover work is intact and recoverable on a quarantine branch
 *   3. approving task 2 produces exactly ONE squash commit on the base branch
 *   4. the tree is left clean, on base, with task 2's branch deleted
 *
 * (The fourth VERIFY A assertion — a concurrent heartbeat cannot check out two
 * tasks of one project — lives in tests/load/checkout-contention.ts, phase 2.)
 *
 * Requires the helper: npm run dev:helper
 *
 *   npx tsx tests/workspace/branch-lifecycle.ts
 */
import '../governance/load-env';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { db } from '@/lib/db';
import { agents, projects, taskEvents, tasks } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { evidence } from '../governance/util';
import { getHelperHealth, getWorkspaceGitDiff } from '@/lib/helper/client';
import {
  commitTaskBranch,
  mergeTaskBranch,
  prepareTaskWorkspace,
  taskBranchName,
} from '@/lib/workspace/branch-lifecycle';

const BASE_BRANCH = 'main';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function seedRepository(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vela-branch-lifecycle-'));
  git(dir, 'init', '--initial-branch', BASE_BRANCH);
  git(dir, 'config', 'user.email', 'exercise@vela.local');
  git(dir, 'config', 'user.name', 'Vela Exercise');
  writeFileSync(path.join(dir, 'README.md'), '# Branch lifecycle fixture\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'initial commit');
  return dir;
}

function commitCount(dir: string, ref: string): number {
  return Number(git(dir, 'rev-list', '--count', ref));
}

function filesOnBranch(dir: string, ref: string): string[] {
  return git(dir, 'ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean);
}

async function main() {
  const runId = Date.now();
  const failures: string[] = [];
  let workspacePath: string | null = null;
  let project: typeof projects.$inferSelect | null = null;
  let agent: typeof agents.$inferSelect | null = null;

  const health = await getHelperHealth();
  if (!health.ok) {
    console.error(
      `The helper is not reachable (${health.platform ?? 'unknown reason'}). Start it with \`npm run dev:helper\` — this exercise drives real git through it.`,
    );
    process.exit(1);
  }

  try {
    workspacePath = seedRepository();

    [project] = await db
      .insert(projects)
      .values({
        name: `Branch Lifecycle Exercise ${runId}`,
        sourceType: 'local',
        workspacePath,
        defaultBranch: BASE_BRANCH,
        status: 'active',
      })
      .returning();

    [agent] = await db
      .insert(agents)
      .values({
        projectId: project.id,
        name: `Branch Lifecycle Scratch ${runId}`,
        role: 'exercise scratch agent',
        agentKind: 'legacy_reference',
        heartbeatEnabled: false,
        status: 'active',
      })
      .returning();

    const seeded = await db
      .insert(tasks)
      .values(
        ['Task 1: empty states', 'Task 2: duplicate detection'].map((title) => ({
          projectId: project!.id,
          assignedAgentId: agent!.id,
          title,
          description: 'Never executed by an agent — branch-lifecycle exercise fixture.',
          status: 'open',
          priority: 'medium',
        })),
      )
      .returning();
    const [taskOne, taskTwo] = seeded;

    const baseCommitsBefore = commitCount(workspacePath, BASE_BRANCH);

    // ── Task 1 runs, implements, and fails review — its work stays in the tree ──
    const prepOne = await prepareTaskWorkspace({ task: taskOne, project, agentId: agent.id });
    writeFileSync(path.join(workspacePath, 'empty-states.ts'), 'export const EMPTY = "task one";\n');

    evidence('task-1-prepared', {
      status: prepOne.status,
      branch: prepOne.branch,
      baseBranch: prepOne.baseBranch,
      treeAfterImplement: git(workspacePath, 'status', '--short'),
    });

    if (prepOne.branch !== taskBranchName(taskOne.id)) {
      failures.push(`task 1 should run on ${taskBranchName(taskOne.id)}, got ${prepOne.branch}`);
    }

    // ── Task 2 runs on the same project: the quarantine gate fires ──
    const prepTwo = await prepareTaskWorkspace({ task: taskTwo, project, agentId: agent.id });
    evidence('task-2-prepared', {
      status: prepTwo.status,
      branch: prepTwo.branch,
      quarantineBranch: prepTwo.quarantineBranch,
      treeAtStart: git(workspacePath, 'status', '--short') || '(clean)',
    });

    if (!prepTwo.quarantineBranch) {
      failures.push('task 2 should have quarantined task 1\'s leftovers, but no branch was created');
    }
    if (git(workspacePath, 'status', '--short') !== '') {
      failures.push('task 2 started on a dirty tree — the quarantine gate did not reset it');
    }

    // (2) task 1's work is intact on its branch
    if (prepTwo.quarantineBranch) {
      const quarantined = filesOnBranch(workspacePath, prepTwo.quarantineBranch);
      evidence('quarantined-work', { branch: prepTwo.quarantineBranch, files: quarantined });
      if (!quarantined.includes('empty-states.ts')) {
        failures.push('task 1\'s leftover file is not on the quarantine branch — work was lost');
      }
    }

    // Task 2 implements and passes review.
    writeFileSync(path.join(workspacePath, 'duplicates.ts'), 'export const DUPES = "task two";\n');
    const commit = await commitTaskBranch({ task: taskTwo, project, agentId: agent.id });
    evidence('task-2-committed', {
      status: commit.status,
      branch: commit.branch,
      commitSha: commit.commitSha,
      currentBranch: git(workspacePath, 'branch', '--show-current'),
      treeAfterCommit: git(workspacePath, 'status', '--short') || '(clean)',
    });

    if (commit.status !== 'committed') {
      failures.push(`task 2's work should have been committed, got "${commit.status}"`);
    }
    if (git(workspacePath, 'branch', '--show-current') !== BASE_BRANCH) {
      failures.push('the tree was not returned to the base branch after the review commit');
    }

    // (1) task 2's review diff contains only task 2's changes
    const { stdout: reviewDiff } = await getWorkspaceGitDiff({
      workspacePath,
      baseRef: BASE_BRANCH,
      headRef: taskBranchName(taskTwo.id),
    });
    const touched = reviewDiff
      .split('\n')
      .filter((line) => line.startsWith('+++ b/') || line.startsWith('--- a/'))
      .map((line) => line.slice(6))
      .filter((file) => file !== 'dev/null');
    evidence('task-2-review-diff', { filesInDiff: [...new Set(touched)] });

    if (!touched.includes('duplicates.ts')) {
      failures.push('task 2\'s review diff does not contain its own change');
    }
    if (touched.includes('empty-states.ts')) {
      failures.push('task 2\'s review diff contains task 1\'s leftovers — the exact bug this fixes');
    }

    // (3) approving task 2 produces exactly one squash commit on base
    const merge = await mergeTaskBranch({ task: taskTwo, project, agentId: agent.id });
    const baseCommitsAfter = commitCount(workspacePath, BASE_BRANCH);
    evidence('task-2-approved', {
      status: merge.status,
      commitSha: merge.commitSha,
      baseCommitsBefore,
      baseCommitsAfter,
      baseSubject: git(workspacePath, 'log', '-1', '--pretty=%s', BASE_BRANCH),
      branchesRemaining: git(workspacePath, 'branch', '--format=%(refname:short)').split('\n'),
      treeAfterMerge: git(workspacePath, 'status', '--short') || '(clean)',
    });

    if (baseCommitsAfter !== baseCommitsBefore + 1) {
      failures.push(
        `approving task 2 should add exactly 1 commit to ${BASE_BRANCH}, went ${baseCommitsBefore} → ${baseCommitsAfter}`,
      );
    }
    if (!filesOnBranch(workspacePath, BASE_BRANCH).includes('duplicates.ts')) {
      failures.push('task 2\'s file did not land on the base branch');
    }
    if (filesOnBranch(workspacePath, BASE_BRANCH).includes('empty-states.ts')) {
      failures.push('task 1\'s uncommitted work leaked onto the base branch');
    }
    if (!merge.branchDeleted && merge.status === 'merged') {
      // reported via the branch list above; a stale branch is a hygiene miss
      failures.push('task 2\'s branch was not deleted after it landed');
    }
    if (git(workspacePath, 'status', '--short') !== '') {
      failures.push('the tree is dirty after the merge — the next task would quarantine it');
    }

    // The lifecycle is auditable: every step left a task event behind.
    const loggedTypes = (
      await db.query.taskEvents.findMany({
        where: inArray(
          taskEvents.taskId,
          seeded.map((t) => t.id),
        ),
        columns: { eventType: true },
      })
    ).map((row) => row.eventType);
    evidence('task-events', { types: [...new Set(loggedTypes)] });
    for (const required of ['workspace_prepared', 'workspace_quarantine', 'workspace_commit', 'workspace_merge']) {
      if (!loggedTypes.includes(required)) failures.push(`no ${required} event was logged`);
    }

    console.log(
      failures.length === 0
        ? '\nPASS: task 2 reviewed only its own diff, task 1\'s work survived on a quarantine branch, approving task 2 added exactly one squash commit to the base branch, and the tree was left clean'
        : `\nFAIL:\n  - ${failures.join('\n  - ')}`,
    );
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    if (project) {
      const projectTasks = await db.query.tasks.findMany({
        where: eq(tasks.projectId, project.id),
        columns: { id: true },
      });
      if (projectTasks.length > 0) {
        await db.delete(taskEvents).where(
          inArray(
            taskEvents.taskId,
            projectTasks.map((t) => t.id),
          ),
        );
      }
      await db.delete(tasks).where(eq(tasks.projectId, project.id));
    }
    if (agent) await db.delete(agents).where(eq(agents.id, agent.id));
    if (project) await db.delete(projects).where(eq(projects.id, project.id));
    if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
  }

  process.exit(process.exitCode ?? 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
