import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { approvals, tasks } from '@/lib/db/schema';
import { createApprovalRequest } from '@/lib/actions/approvals';
import { buildApprovalReason, taskNeedsHumanApproval } from '@/lib/orchestration/workflow-selector';
import { approvalCheckedWorkflowSchema, plannedWorkflowSchema } from './shared';
import { logTaskEvent } from '@/lib/events/logger';
import { and, desc, eq } from 'drizzle-orm';

const HIGH_RISK_APPROVAL_TYPE = 'high_risk_change';

export const humanApprovalStep = createStep({
  id: 'human-approval',
  inputSchema: plannedWorkflowSchema,
  outputSchema: approvalCheckedWorkflowSchema,
  execute: async ({ inputData }) => {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, inputData.taskId) });
    if (!task) throw new Error(`Task ${inputData.taskId} not found`);

    if (!taskNeedsHumanApproval(inputData.classification)) {
      return {
        ...inputData,
        approval: {
          status: 'not_required' as const,
          reason: 'No high-risk approval required for this task.',
        },
      };
    }

    const latestApproval = await db.query.approvals.findFirst({
      where: and(eq(approvals.taskId, task.id), eq(approvals.actionType, HIGH_RISK_APPROVAL_TYPE)),
      orderBy: [desc(approvals.createdAt)],
    });

    if (latestApproval?.status === 'approved') {
      return {
        ...inputData,
        approval: {
          status: 'approved' as const,
          approvalId: latestApproval.id,
          reason: 'High-risk execution was already approved for this task.',
        },
      };
    }

    if (latestApproval?.status === 'rejected') {
      return {
        ...inputData,
        approval: {
          status: 'rejected' as const,
          approvalId: latestApproval.id,
          reason: 'High-risk execution approval was rejected.',
        },
      };
    }

    let approvalId = latestApproval?.id;
    if (!approvalId) {
      const created = await createApprovalRequest({
        agentId: inputData.agentId,
        taskId: task.id,
        actionType: HIGH_RISK_APPROVAL_TYPE,
        description: buildApprovalReason(task, inputData.classification),
        payload: {
          workflow_kind: inputData.workflowKind,
          workflow_id: inputData.workflowSelection.workflowId,
          risk_flags: inputData.classification.riskFlags,
          score: inputData.classification.score,
        },
      });
      approvalId = created.approvalId;
    }

    if (task.status !== 'waiting_for_human') {
      await db.update(tasks).set({ status: 'waiting_for_human', updatedAt: new Date() }).where(eq(tasks.id, task.id));
      await logTaskEvent({
        taskId: task.id,
        agentId: inputData.agentId,
        eventType: 'status_change',
        payload: {
          from: task.status,
          to: 'waiting_for_human',
          reason: 'High-risk workflow approval requested',
        },
      });
    }

    return {
      ...inputData,
      approval: {
        status: 'requested' as const,
        approvalId,
        reason: 'Waiting for human approval before high-risk execution.',
      },
    };
  },
});
