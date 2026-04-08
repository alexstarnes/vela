import { createWorkflow } from '@mastra/core/workflows';
import { classifyTaskStep } from './steps/classify';
import { finalizeTaskStep } from './steps/finalize';
import { humanApprovalStep } from './steps/human-approval';
import { implementTaskStep } from './steps/implement';
import { planTaskStep } from './steps/plan';
import { repoMapTaskStep } from './steps/repo-map';
import { reviewTaskStep } from './steps/review';
import { routeReviewedOutcomeStep } from './steps/route-outcome';
import { finalizedTaskSchema, workflowRunInputSchema } from './steps/shared';
import { synthesizeTaskStep } from './steps/synthesize';
import { verifyHighRiskTaskStep } from './steps/verify';

export const highRiskWorkflow = createWorkflow({
  id: 'highRiskWorkflow',
  inputSchema: workflowRunInputSchema,
  outputSchema: finalizedTaskSchema,
})
  .then(classifyTaskStep)
  .then(repoMapTaskStep)
  .then(planTaskStep)
  .then(humanApprovalStep)
  .then(implementTaskStep)
  .then(verifyHighRiskTaskStep)
  .then(reviewTaskStep)
  .then(routeReviewedOutcomeStep)
  .then(synthesizeTaskStep)
  .then(finalizeTaskStep)
  .commit();
