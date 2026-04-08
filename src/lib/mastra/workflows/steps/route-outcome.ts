import { createStep } from '@mastra/core/workflows';
import {
  approvalCheckedWorkflowSchema,
  approvalOutcomeWorkflowSchema,
  reviewedOutcomeWorkflowSchema,
  reviewedWorkflowSchema,
} from './shared';

export const routeApprovalOutcomeStep = createStep({
  id: 'route-approval-outcome',
  inputSchema: approvalCheckedWorkflowSchema,
  outputSchema: approvalOutcomeWorkflowSchema,
  execute: async ({ inputData }) => {
    const outcome =
      inputData.approval.status === 'requested'
        ? {
            kind: 'waiting_for_human' as const,
            statusTarget: 'waiting_for_human' as const,
            reason: inputData.approval.reason,
          }
        : {
            kind: 'requeue' as const,
            statusTarget: 'open' as const,
            reason: inputData.approval.reason,
          };

    return {
      ...inputData,
      outcome,
    };
  },
});

export const routeReviewedOutcomeStep = createStep({
  id: 'route-reviewed-outcome',
  inputSchema: reviewedWorkflowSchema,
  outputSchema: reviewedOutcomeWorkflowSchema,
  execute: async ({ inputData }) => {
    const outcome =
      inputData.approval.status === 'requested'
        ? {
            kind: 'waiting_for_human' as const,
            statusTarget: 'waiting_for_human' as const,
            reason: inputData.approval.reason,
          }
        : inputData.approval.status === 'rejected'
          ? {
              kind: 'requeue' as const,
              statusTarget: 'open' as const,
              reason: inputData.approval.reason,
            }
          : inputData.verification.status === 'pass' && inputData.review.status === 'pass'
        ? {
            kind: 'review_ready' as const,
            statusTarget: 'review' as const,
            reason: 'Verification passed and reviewer reported no blocking findings.',
          }
        : {
            kind: 'requeue' as const,
            statusTarget: 'open' as const,
            reason:
              inputData.verification.status !== 'pass'
                ? 'Mechanical verification failed.'
                : 'Reviewer requested rework.',
          };

    return {
      ...inputData,
      outcome,
    };
  },
});
