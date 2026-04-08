import { z } from 'zod';
import { modeClassificationSchema } from '@/lib/orchestration/mode-classifier';
import { verificationGateResultSchema } from '@/lib/mastra/tools/verification-tools';

export const workflowIdSchema = z.enum(['featureWorkflow', 'highRiskWorkflow', 'debugWorkflow']);
export const workflowKindSchema = z.enum(['feature', 'high_risk', 'debug']);
export const executionTierSchema = z.enum(['fast', 'standard', 'premium']);

export const workflowUsageSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  totalCostUsd: z.string(),
});

export const workflowSelectionSchema = z.object({
  workflowId: workflowIdSchema,
  reason: z.string(),
});

export const routingAdjustmentSchema = z.object({
  effectiveTier: executionTierSchema,
  floorApplied: z.boolean(),
  reason: z.string().nullable(),
});

export const repoMapSchema = z.object({
  status: z.enum(['complete', 'skipped']),
  summary: z.string(),
  likelyFiles: z.array(z.string()),
  dependencyNotes: z.array(z.string()),
});

export const approvalGateSchema = z.object({
  status: z.enum(['not_required', 'approved', 'requested', 'rejected']),
  approvalId: z.string().uuid().optional(),
  reason: z.string(),
});

export const reviewResultSchema = z.object({
  status: z.enum(['pass', 'fail', 'needs_rework', 'skipped']),
  summary: z.string(),
  findings: z.array(z.string()),
  reviewerModel: z.string().nullable().optional(),
});

export const workflowOutcomeSchema = z.object({
  kind: z.enum(['review_ready', 'requeue', 'waiting_for_human']),
  statusTarget: z.enum(['review', 'open', 'waiting_for_human']),
  reason: z.string(),
});

export const debugStateSchema = z.object({
  hypotheses: z.array(z.string()),
  diagnosticsSummary: z.string(),
  rootCause: z.string(),
});

export const workflowRunInputSchema = z.object({
  taskId: z.string().uuid(),
  agentId: z.string().uuid(),
  heartbeatId: z.string().uuid().optional(),
});

export const classifiedWorkflowSchema = workflowRunInputSchema.extend({
  classification: modeClassificationSchema,
  workflowKind: workflowKindSchema,
  workflowSelection: workflowSelectionSchema,
  routingAdjustment: routingAdjustmentSchema,
});

export const repoMappedWorkflowSchema = classifiedWorkflowSchema.extend({
  repoMap: repoMapSchema.optional(),
});

export const plannedWorkflowSchema = repoMappedWorkflowSchema.extend({
  planText: z.string(),
  supervisorModel: z.string(),
  usage: workflowUsageSchema,
});

export const approvalCheckedWorkflowSchema = plannedWorkflowSchema.extend({
  approval: approvalGateSchema,
});

export const implementedWorkflowSchema = approvalCheckedWorkflowSchema.extend({
  implementationSummary: z.string().default(''),
  implementerModel: z.string().nullable().optional(),
});

export const verifiedWorkflowSchema = implementedWorkflowSchema.extend({
  verification: z.object({
    status: z.enum(['pass', 'fail', 'skipped']),
    gateResults: z.array(verificationGateResultSchema),
    escalation: z
      .object({
        reason: z.string(),
        newTier: executionTierSchema,
      })
      .optional(),
  }),
});

export const reviewedWorkflowSchema = verifiedWorkflowSchema.extend({
  review: reviewResultSchema,
});

export const reviewedOutcomeWorkflowSchema = reviewedWorkflowSchema.extend({
  outcome: workflowOutcomeSchema,
});

export const approvalOutcomeWorkflowSchema = approvalCheckedWorkflowSchema.extend({
  outcome: workflowOutcomeSchema,
});

export const workflowOutputSchema = reviewedOutcomeWorkflowSchema.extend({
  summary: z.string(),
});

export const synthesizedTaskSchema = workflowOutputSchema;

export const finalizedTaskSchema = workflowOutputSchema.extend({
  finalStatus: workflowOutcomeSchema.shape.statusTarget,
});

export const debugClassifiedTaskSchema = classifiedWorkflowSchema.extend({
  debug: debugStateSchema,
});

export const debugHypothesesTaskSchema = debugClassifiedTaskSchema.extend({
  supervisorModel: z.string(),
  usage: workflowUsageSchema,
});

export const debugDiagnosedTaskSchema = repoMappedWorkflowSchema.extend({
  debug: debugStateSchema,
  planText: z.string(),
  supervisorModel: z.string(),
  usage: workflowUsageSchema,
});

export const debugApprovedTaskSchema = approvalCheckedWorkflowSchema.extend({
  debug: debugStateSchema,
});

export const classifiedTaskSchema = classifiedWorkflowSchema;
export const repoMappedTaskSchema = repoMappedWorkflowSchema;
export const plannedTaskSchema = plannedWorkflowSchema;
export const approvedTaskSchema = approvalCheckedWorkflowSchema;
export const implementedTaskSchema = implementedWorkflowSchema;
export const verifiedTaskSchema = verifiedWorkflowSchema;
export const reviewedTaskSchema = reviewedWorkflowSchema;
