import { createWorkflow, createStep } from '@mastra/core/workflows';
import { classifyTaskStep } from './steps/classify';
import { approvedTaskSchema, finalizedTaskSchema, plannedTaskSchema, workflowRunInputSchema } from './steps/shared';
import { finalizeTaskStep } from './steps/finalize';
import { repoMapTaskStep } from './steps/repo-map';
import { planTaskStep } from './steps/plan';
import { implementTaskStep } from './steps/implement';
import { verifyTaskStep } from './steps/verify';
import { reviewTaskStep } from './steps/review';
import { routeReviewedOutcomeStep } from './steps/route-outcome';
import { synthesizeTaskStep } from './steps/synthesize';

const featureApprovalBypassStep = createStep({
  id: 'feature-approval-bypass',
  inputSchema: plannedTaskSchema,
  outputSchema: approvedTaskSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    approval: {
      status: 'not_required' as const,
      reason: 'Feature workflow does not require a human approval gate.',
    },
  }),
});

export const featureWorkflow = createWorkflow({
  id: 'featureWorkflow',
  inputSchema: workflowRunInputSchema,
  outputSchema: finalizedTaskSchema,
})
  .then(classifyTaskStep)
  .then(repoMapTaskStep)
  .then(planTaskStep)
  .then(featureApprovalBypassStep)
  .then(implementTaskStep)
  .then(verifyTaskStep)
  .then(reviewTaskStep)
  .then(routeReviewedOutcomeStep)
  .then(synthesizeTaskStep)
  .then(finalizeTaskStep)
  .commit();
