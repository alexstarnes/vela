/**
 * Branch-per-task workspace lifecycle.
 *
 * All tasks of a project share one working tree. Without a lifecycle, one
 * task's rejected work sits uncommitted and becomes part of the *next* task's
 * diff — the reviewer then sends that task back for changes it never made.
 *
 * The fix is to make the branch the unit of work and the tree disposable:
 *
 *   1. quarantine  — leftovers are committed to `vela/quarantine/<stamp>`
 *                    (never discarded) and the tree is reset to base
 *   2. branch      — the task runs on `vela/task-<id8>`; rework attempts
 *                    re-enter the same branch so history accumulates there
 *   3. commit      — on review-pass the branch is committed and base is
 *                    checked back out, leaving a clean tree for whatever runs next
 *   4. merge       — operator approve squash-merges the branch into base
 *
 * Every step is best-effort against helper availability: a workspace that
 * cannot be prepared is reported honestly (task event) rather than silently
 * running on whatever tree state happens to be there.
 */

import {
  ensureWorkspaceGitBranch,
  getWorkspaceGitStatus,
  listWorkspaceGitBranches,
  resetWorkspaceGitHard,
  saveWorkspaceGitBranch,
  squashMergeWorkspaceGitBranch,
} from '@/lib/helper/client';
import { logTaskEvent } from '@/lib/events/logger';
import type { Project, Task } from '@/lib/db/schema';

export const TASK_BRANCH_PREFIX = 'vela/task-';
export const QUARANTINE_BRANCH_PREFIX = 'vela/quarantine/';

/** The branch a task's work lives on. Deterministic — never stored. */
export function taskBranchName(taskId: string): string {
  return `${TASK_BRANCH_PREFIX}${taskId.slice(0, 8)}`;
}

/** `vela/quarantine/<yyyymmdd>-<hhmm>` — timestamped so leftovers stay recoverable. */
export function quarantineBranchName(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${QUARANTINE_BRANCH_PREFIX}${stamp}`;
}

export interface WorkspaceStatus {
  /** Branch currently checked out, from `git status --short --branch`. */
  branch: string | null;
  dirty: boolean;
  /** Porcelain lines for the dirty entries (empty when clean). */
  changes: string[];
}

/** Parse `git status --short --branch` into branch + dirty state. */
export function parseGitStatus(stdout: string): WorkspaceStatus {
  const lines = stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const header = lines.find((line) => line.startsWith('##'));
  const branch = header
    ? (header.replace(/^##\s*/, '').split('...')[0].split(' ')[0] || null)
    : null;
  const changes = lines.filter((line) => !line.startsWith('##'));
  return {
    branch: branch === 'HEAD' ? null : branch,
    dirty: changes.length > 0,
    changes,
  };
}

export async function getWorkspaceStatus(workspacePath: string): Promise<WorkspaceStatus> {
  const { stdout } = await getWorkspaceGitStatus({ workspacePath });
  return parseGitStatus(stdout);
}

/**
 * The branch task work forks from and merges back into: the project's
 * configured default branch when it exists, otherwise whatever is checked
 * out right now (never a `vela/` branch — that would nest task work).
 */
export async function resolveBaseBranch(
  project: Pick<Project, 'defaultBranch' | 'workspacePath'>,
  status?: WorkspaceStatus,
): Promise<string> {
  if (project.defaultBranch) return project.defaultBranch;

  const current =
    status?.branch ??
    (project.workspacePath ? (await getWorkspaceStatus(project.workspacePath)).branch : null);

  if (current && !current.startsWith('vela/')) return current;
  return 'main';
}

export interface PrepareWorkspaceResult {
  status: 'prepared' | 'skipped' | 'failed';
  branch: string | null;
  baseBranch: string | null;
  /** Set when leftovers were parked on a quarantine branch. */
  quarantineBranch: string | null;
  reason: string;
}

/**
 * A.1 + A.2 — the safety gate at the head of every code workflow.
 *
 * Commits any leftover tree to a quarantine branch (leftover work has
 * repeatedly turned out to be real, so it is never discarded), resets to
 * base, then checks out this task's branch.
 */
export async function prepareTaskWorkspace(params: {
  task: Pick<Task, 'id' | 'title'>;
  project: Pick<Project, 'id' | 'name' | 'workspacePath' | 'defaultBranch'>;
  agentId?: string;
}): Promise<PrepareWorkspaceResult> {
  const { task, project, agentId } = params;
  const workspacePath = project.workspacePath;

  if (!workspacePath) {
    return {
      status: 'skipped',
      branch: null,
      baseBranch: null,
      quarantineBranch: null,
      reason: 'Project has no connected workspace — nothing to prepare.',
    };
  }

  const branch = taskBranchName(task.id);

  try {
    const status = await getWorkspaceStatus(workspacePath);
    const baseBranch = await resolveBaseBranch(project, status);
    let quarantineBranch: string | null = null;

    // Quarantine gate: a dirty tree at the head of a run is someone else's
    // work. Park it on its own branch and tell the operator where it went.
    if (status.dirty) {
      const target = quarantineBranchName();
      const saved = await saveWorkspaceGitBranch({
        workspacePath,
        branch: target,
        message:
          `vela: quarantined uncommitted work before task ${task.id.slice(0, 8)}\n\n` +
          `Left in the tree of project "${project.name}" when "${task.title}" started.\n` +
          `Recover with: git checkout ${target}`,
      });

      if (saved.committed) {
        quarantineBranch = saved.branch;
        await logTaskEvent({
          taskId: task.id,
          agentId,
          eventType: 'workspace_quarantine',
          payload: {
            branch: saved.branch,
            commit_sha: saved.commitSha,
            base_branch: baseBranch,
            changed_entries: status.changes.slice(0, 50),
            recover_with: `git checkout ${saved.branch}`,
          },
        });
      }

      // The leftovers are safely on a branch — the tree can now be reset.
      await ensureWorkspaceGitBranch({ workspacePath, branch: baseBranch });
      await resetWorkspaceGitHard({ workspacePath, ref: baseBranch });
    }

    const ensured = await ensureWorkspaceGitBranch({
      workspacePath,
      branch,
      startPoint: baseBranch,
    });

    await logTaskEvent({
      taskId: task.id,
      agentId,
      eventType: 'workspace_prepared',
      payload: {
        branch,
        base_branch: baseBranch,
        branch_created: ensured.created,
        quarantine_branch: quarantineBranch,
        previous_branch: ensured.previousBranch,
      },
    });

    return {
      status: 'prepared',
      branch,
      baseBranch,
      quarantineBranch,
      reason: quarantineBranch
        ? `Quarantined leftovers to ${quarantineBranch}; running on ${branch} from ${baseBranch}.`
        : `Running on ${branch} from ${baseBranch}.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logTaskEvent({
      taskId: task.id,
      agentId,
      eventType: 'error',
      payload: { message: `Workspace preparation failed: ${reason}`, branch },
    });
    return { status: 'failed', branch, baseBranch: null, quarantineBranch: null, reason };
  }
}

export interface CommitTaskBranchResult {
  status: 'committed' | 'nothing_to_commit' | 'skipped' | 'failed';
  branch: string | null;
  baseBranch: string | null;
  commitSha: string | null;
  reason: string;
}

/**
 * A.3 — the hygiene moment. On review-pass the deliverable is committed to
 * the task branch and base is checked back out, so the tree the next task
 * inherits is clean and its diff contains only its own work.
 */
export async function commitTaskBranch(params: {
  task: Pick<Task, 'id' | 'title'>;
  project: Pick<Project, 'workspacePath' | 'defaultBranch'>;
  agentId?: string;
}): Promise<CommitTaskBranchResult> {
  const { task, project, agentId } = params;
  const workspacePath = project.workspacePath;

  if (!workspacePath) {
    return {
      status: 'skipped',
      branch: null,
      baseBranch: null,
      commitSha: null,
      reason: 'Project has no connected workspace.',
    };
  }

  const branch = taskBranchName(task.id);

  try {
    const baseBranch = await resolveBaseBranch(project);
    const saved = await saveWorkspaceGitBranch({
      workspacePath,
      branch,
      message: `${task.title}\n\nVela task ${task.id}`,
    });

    // Return the tree to base regardless — that is the hygiene guarantee.
    await ensureWorkspaceGitBranch({ workspacePath, branch: baseBranch });

    await logTaskEvent({
      taskId: task.id,
      agentId,
      eventType: 'workspace_commit',
      payload: {
        branch,
        base_branch: baseBranch,
        committed: saved.committed,
        commit_sha: saved.commitSha,
        review_diff: `git diff ${baseBranch}...${branch}`,
      },
    });

    return {
      status: saved.committed ? 'committed' : 'nothing_to_commit',
      branch,
      baseBranch,
      commitSha: saved.commitSha,
      reason: saved.committed
        ? `Committed to ${branch}; tree returned to ${baseBranch}.`
        : `No changes to commit on ${branch}; tree returned to ${baseBranch}.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logTaskEvent({
      taskId: task.id,
      agentId,
      eventType: 'error',
      payload: { message: `Committing task branch failed: ${reason}`, branch },
    });
    return { status: 'failed', branch, baseBranch: null, commitSha: null, reason };
  }
}

export interface MergeTaskBranchResult {
  status: 'merged' | 'nothing_to_merge' | 'conflict' | 'skipped' | 'failed';
  branch: string | null;
  baseBranch: string | null;
  commitSha: string | null;
  /** True once the branch has landed and been cleaned up. */
  branchDeleted: boolean;
  reason: string;
  /** Raw git output for a conflict, so the operator sees what actually collided. */
  output: string | null;
}

/**
 * A.4 — operator approve. One squash commit per task on the base branch,
 * titled by the task; the branch is deleted once it has landed. A conflict
 * is an honest failure: the caller parks the task at waiting_for_human with
 * this output attached rather than reporting a merge that did not happen.
 */
export async function mergeTaskBranch(params: {
  task: Pick<Task, 'id' | 'title'>;
  project: Pick<Project, 'workspacePath' | 'defaultBranch'>;
  agentId?: string;
}): Promise<MergeTaskBranchResult> {
  const { task, project, agentId } = params;
  const workspacePath = project.workspacePath;

  if (!workspacePath) {
    return {
      status: 'skipped',
      branch: null,
      baseBranch: null,
      commitSha: null,
      branchDeleted: false,
      output: null,
      reason: 'Project has no connected workspace.',
    };
  }

  const branch = taskBranchName(task.id);

  try {
    const baseBranch = await resolveBaseBranch(project);
    const branches = await listWorkspaceGitBranches({ workspacePath, prefix: branch });
    if (!branches.branches.includes(branch)) {
      return {
        status: 'skipped',
        branch,
        baseBranch,
        commitSha: null,
        branchDeleted: false,
        output: null,
        reason: `No branch ${branch} in the workspace — nothing to merge (already merged, or the task produced no committed work).`,
      };
    }

    const merge = await squashMergeWorkspaceGitBranch({
      workspacePath,
      branch,
      baseBranch,
      message: `${task.title}\n\nSquash-merged from ${branch} (Vela task ${task.id})`,
    });

    if (merge.conflict) {
      await logTaskEvent({
        taskId: task.id,
        agentId,
        eventType: 'workspace_merge_conflict',
        payload: {
          branch,
          base_branch: baseBranch,
          output: merge.output,
          resolve_with: `git checkout ${baseBranch} && git merge --squash ${branch}`,
        },
      });
      return {
        status: 'conflict',
        branch,
        baseBranch,
        commitSha: null,
        branchDeleted: false,
        output: merge.output,
        reason: `Squash-merging ${branch} into ${baseBranch} hit a conflict — the branch is intact and needs a human.`,
      };
    }

    await logTaskEvent({
      taskId: task.id,
      agentId,
      eventType: 'workspace_merge',
      payload: {
        branch,
        base_branch: baseBranch,
        commit_sha: merge.commitSha,
        branch_deleted: merge.branchDeleted,
      },
    });

    return {
      status: merge.commitSha ? 'merged' : 'nothing_to_merge',
      branch,
      baseBranch,
      commitSha: merge.commitSha,
      branchDeleted: merge.branchDeleted,
      output: merge.output,
      reason: merge.commitSha
        ? `Squash-merged ${branch} into ${baseBranch} as ${merge.commitSha}.`
        : `${branch} carried nothing beyond ${baseBranch}.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logTaskEvent({
      taskId: task.id,
      agentId,
      eventType: 'error',
      payload: { message: `Merging task branch failed: ${reason}`, branch },
    });
    return {
      status: 'failed',
      branch,
      baseBranch: null,
      commitSha: null,
      branchDeleted: false,
      output: null,
      reason,
    };
  }
}

export interface WorkspaceOverview {
  available: boolean;
  branch: string | null;
  dirty: boolean;
  changes: string[];
  baseBranch: string | null;
  quarantineBranches: string[];
  taskBranches: string[];
  error: string | null;
}

/** C.3 — "is the tree healthy" answered in one call for the project page. */
export async function getWorkspaceOverview(
  project: Pick<Project, 'workspacePath' | 'defaultBranch'>,
): Promise<WorkspaceOverview> {
  const empty: WorkspaceOverview = {
    available: false,
    branch: null,
    dirty: false,
    changes: [],
    baseBranch: project.defaultBranch ?? null,
    quarantineBranches: [],
    taskBranches: [],
    error: null,
  };

  if (!project.workspacePath) return empty;
  const workspacePath = project.workspacePath;

  try {
    const [status, quarantine, taskBranches] = await Promise.all([
      getWorkspaceStatus(workspacePath),
      listWorkspaceGitBranches({ workspacePath, prefix: QUARANTINE_BRANCH_PREFIX }),
      listWorkspaceGitBranches({ workspacePath, prefix: TASK_BRANCH_PREFIX }),
    ]);

    return {
      available: true,
      branch: status.branch,
      dirty: status.dirty,
      changes: status.changes,
      baseBranch: await resolveBaseBranch(project, status),
      quarantineBranches: quarantine.branches,
      taskBranches: taskBranches.branches,
      error: null,
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}
