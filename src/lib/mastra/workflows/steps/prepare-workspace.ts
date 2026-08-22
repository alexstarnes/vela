import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { projects, tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { prepareTaskWorkspace } from '@/lib/workspace/branch-lifecycle';
import { workflowRunInputSchema } from './shared';

/**
 * The safety gate at the head of every code workflow.
 *
 * Runs before anything reads or writes the tree: quarantines whatever a
 * previous run left uncommitted (to a recoverable branch, never discarded),
 * resets to the project's base branch, and checks out this task's branch.
 * Without it, one failed task's leftovers land in the next task's diff and
 * its reviewer sends it back for changes it never made.
 *
 * Passthrough by design — the branch name is derived from the task id
 * wherever it is needed, so nothing downstream has to thread it through.
 */
export const prepareWorkspaceStep = createStep({
  id: 'prepare-workspace',
  inputSchema: workflowRunInputSchema,
  outputSchema: workflowRunInputSchema,
  execute: async ({ inputData }) => {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) });
    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, task.projectId),
    });
    if (!project) {
      throw new Error(`Project ${task.projectId} not found`);
    }

    const result = await prepareTaskWorkspace({ task, project, agentId: inputData.agentId });

    // A workspace we could not prepare is a workspace we must not implement
    // on — the whole point is that the tree state is known before work starts.
    if (result.status === 'failed') {
      throw new Error(`Workspace preparation failed: ${result.reason}`);
    }

    return inputData;
  },
});
