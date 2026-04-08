import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { classifyTaskMode, modeClassificationSchema } from '@/lib/orchestration/mode-classifier';
import { deriveRoutingTierAdjustment } from '@/lib/orchestration/routing-tuning';
import type { WorkflowScorecard } from '@/lib/mastra/analytics/routing-scorecards';
import { selectWorkflowForClassification, type WorkflowId } from '@/lib/orchestration/workflow-selector';

const workflowIdSchema = z.enum(['featureWorkflow', 'highRiskWorkflow', 'debugWorkflow']);
const executionTierSchema = z.enum(['fast', 'standard', 'premium']);

export const routingEvalInputSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  historicalScorecard: z
    .object({
      workflowId: workflowIdSchema,
      taskCount: z.number().int().nonnegative(),
      escalationFrequency: z.number().min(0),
      verificationFailureRate: z.number().min(0),
      approvalFrequency: z.number().min(0),
    })
    .optional(),
});

export const routingEvalOutputSchema = z.object({
  fixtureName: z.string(),
  mode: modeClassificationSchema.shape.mode,
  workflowId: workflowIdSchema,
  score: z.number().int(),
  riskFlags: z.array(z.string()),
  recommendedTier: executionTierSchema,
  effectiveTier: executionTierSchema,
  floorApplied: z.boolean(),
  adjustmentReason: z.string().nullable(),
});

export type RoutingEvalInput = z.infer<typeof routingEvalInputSchema>;
export type RoutingEvalOutput = z.infer<typeof routingEvalOutputSchema>;

export function predictRoutingOutcome(input: RoutingEvalInput): RoutingEvalOutput {
  const classification = classifyTaskMode({
    title: input.title,
    description: input.description,
  });
  const workflowSelection = selectWorkflowForClassification(classification);
  const adjustment = deriveRoutingTierAdjustment({
    classification,
    workflowId: workflowSelection.workflowId,
    summary: input.historicalScorecard as WorkflowScorecard | undefined,
  });

  return {
    fixtureName: input.name,
    mode: classification.mode,
    workflowId: workflowSelection.workflowId as WorkflowId,
    score: classification.score,
    riskFlags: classification.riskFlags,
    recommendedTier: classification.recommendedTier,
    effectiveTier: adjustment.effectiveTier,
    floorApplied: adjustment.floorApplied,
    adjustmentReason: adjustment.reason,
  };
}

const evaluateRoutingStep = createStep({
  id: 'evaluate-routing',
  inputSchema: routingEvalInputSchema,
  outputSchema: routingEvalOutputSchema,
  execute: async ({ inputData }) => predictRoutingOutcome(inputData),
});

export const routingEvalWorkflow = createWorkflow({
  id: 'routingEvalWorkflow',
  inputSchema: routingEvalInputSchema,
  outputSchema: routingEvalOutputSchema,
})
  .then(evaluateRoutingStep)
  .commit();
