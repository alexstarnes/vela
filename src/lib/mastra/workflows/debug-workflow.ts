import { createWorkflow } from '@mastra/core/workflows';
import { classifyTaskStep } from './steps/classify';
import { diagnoseDebugTaskStep } from './steps/debug-diagnostics';
import { generateDebugHypothesesStep } from './steps/debug-hypotheses';
import { selectDebugRootCauseStep } from './steps/debug-root-cause';
import { finalizeTaskStep } from './steps/finalize';
import { implementTaskStep } from './steps/implement';
import { reviewTaskStep } from './steps/review';
import { routeReviewedOutcomeStep } from './steps/route-outcome';
import { finalizedTaskSchema, workflowRunInputSchema } from './steps/shared';
import { synthesizeTaskStep } from './steps/synthesize';
import { verifyTaskStep } from './steps/verify';

export const debugWorkflow = createWorkflow({
  id: 'debugWorkflow',
  inputSchema: workflowRunInputSchema,
  outputSchema: finalizedTaskSchema,
})
  .then(classifyTaskStep)
  .then(generateDebugHypothesesStep)
  .then(diagnoseDebugTaskStep)
  .then(selectDebugRootCauseStep)
  .then(implementTaskStep)
  .then(verifyTaskStep)
  .then(reviewTaskStep)
  .then(routeReviewedOutcomeStep)
  .then(synthesizeTaskStep)
  .then(finalizeTaskStep)
  .commit();
