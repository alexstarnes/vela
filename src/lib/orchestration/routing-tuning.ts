import type { ModeClassification } from './mode-classifier';
import type { WorkflowId } from './workflow-selector';
import type { WorkflowScorecard } from '@/lib/mastra/analytics/routing-scorecards';
import type { Task } from '@/lib/db/schema';

const TIER_ORDER = ['fast', 'standard', 'premium'] as const;
type ExecutionTier = (typeof TIER_ORDER)[number];

export interface RoutingTierAdjustment {
  effectiveTier: ExecutionTier;
  floorApplied: boolean;
  reason: string | null;
}

function maxTier(a: ExecutionTier, b: ExecutionTier): ExecutionTier {
  return TIER_ORDER[Math.max(TIER_ORDER.indexOf(a), TIER_ORDER.indexOf(b))];
}

function normalizeTier(tier: string): ExecutionTier {
  return (TIER_ORDER.includes(tier as ExecutionTier) ? tier : 'standard') as ExecutionTier;
}

export function deriveRoutingTierAdjustment(params: {
  classification: ModeClassification;
  workflowId: WorkflowId;
  summary?: WorkflowScorecard | null;
}): RoutingTierAdjustment {
  const baseTier = normalizeTier(params.classification.recommendedTier);
  const summary = params.summary;

  if (!summary || summary.taskCount < 5) {
    return { effectiveTier: baseTier, floorApplied: false, reason: null };
  }

  let floor: ExecutionTier = baseTier;
  const reasons: string[] = [];

  if (summary.verificationFailureRate >= 0.4 || summary.escalationFrequency >= 0.5) {
    floor = maxTier(floor, 'standard');
    reasons.push('historical verification or escalation rate exceeded the standard-tier threshold');
  }

  if (
    params.workflowId === 'highRiskWorkflow' ||
    summary.approvalFrequency >= 0.5 ||
    params.classification.riskFlags.some((flag) =>
      ['auth', 'payments', 'rls', 'secrets', 'security', 'schema', 'infrastructure'].includes(flag),
    )
  ) {
    floor = maxTier(floor, 'premium');
    reasons.push('security-sensitive or historically risky bucket requires a premium floor');
  }

  return {
    effectiveTier: floor,
    floorApplied: floor !== baseTier,
    reason: floor !== baseTier ? reasons.join('; ') : null,
  };
}

export async function applyRoutingTierFloor(params: {
  classification: ModeClassification;
  workflowId: WorkflowId;
  task: Pick<Task, 'projectId'>;
}): Promise<RoutingTierAdjustment> {
  if (!params.task.projectId) {
    return {
      effectiveTier: normalizeTier(params.classification.recommendedTier),
      floorApplied: false,
      reason: null,
    };
  }

  const { listWorkflowScorecards } = await import('@/lib/mastra/analytics/routing-scorecards');
  const summaries = await listWorkflowScorecards(params.task.projectId);
  const summary = summaries.find((entry) => entry.workflowId === params.workflowId);

  return deriveRoutingTierAdjustment({
    classification: params.classification,
    workflowId: params.workflowId,
    summary,
  });
}
