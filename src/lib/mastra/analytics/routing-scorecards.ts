import { db } from '@/lib/db';
import { taskEvents, tasks } from '@/lib/db/schema';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { classifyTaskMode } from '@/lib/orchestration/mode-classifier';
import {
  determineWorkflowKind,
  WORKFLOW_IDS,
  type WorkflowId,
  workflowIdForKind,
} from '@/lib/orchestration/workflow-selector';

const WINDOW_DAYS = 30;

export interface WorkflowScorecard {
  workflowId: WorkflowId;
  taskCount: number;
  tierUsage: Record<'fast' | 'standard' | 'premium', number>;
  escalationFrequency: number;
  verificationFailureRate: number;
  approvalFrequency: number;
  averageCostUsd: number;
}

export interface TaskRoutingScorecard {
  taskId: string;
  workflowId: WorkflowId;
  tier: 'fast' | 'standard' | 'premium';
  escalationCount: number;
  verificationFailures: number;
  approvalRequests: number;
  totalCostUsd: number;
}

function defaultTierUsage(): Record<'fast' | 'standard' | 'premium', number> {
  return { fast: 0, standard: 0, premium: 0 };
}

function emptyScorecard(workflowId: WorkflowId): WorkflowScorecard {
  return {
    workflowId,
    taskCount: 0,
    tierUsage: defaultTierUsage(),
    escalationFrequency: 0,
    verificationFailureRate: 0,
    approvalFrequency: 0,
    averageCostUsd: 0,
  };
}

function normalizeTier(tier: string | null | undefined): 'fast' | 'standard' | 'premium' {
  if (tier === 'fast' || tier === 'premium') {
    return tier;
  }

  return 'standard';
}

export async function listWorkflowScorecards(
  projectId: string,
  windowDays = WINDOW_DAYS,
): Promise<WorkflowScorecard[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const recentTasks = await db.query.tasks.findMany({
    where: and(eq(tasks.projectId, projectId), gte(tasks.createdAt, since)),
    orderBy: [desc(tasks.createdAt)],
    limit: 200,
  });

  const workflowBuckets = new Map<WorkflowId, typeof recentTasks>();
  for (const task of recentTasks) {
    const workflowId = workflowIdForKind(determineWorkflowKind(classifyTaskMode(task)));
    const bucket = workflowBuckets.get(workflowId) ?? [];
    bucket.push(task);
    workflowBuckets.set(workflowId, bucket);
  }

  const scorecards = WORKFLOW_IDS.map((workflowId) => emptyScorecard(workflowId));

  for (const scorecard of scorecards) {
    const bucket = workflowBuckets.get(scorecard.workflowId) ?? [];
    if (bucket.length === 0) {
      continue;
    }

    const bucketTaskIds = bucket.map((task) => task.id);
    const events = await db.query.taskEvents.findMany({
      where: inArray(taskEvents.taskId, bucketTaskIds),
      orderBy: [desc(taskEvents.createdAt)],
    });

    let totalCostUsd = 0;
    let totalVerificationEvents = 0;
    let failedVerificationEvents = 0;
    let escalations = 0;
    let approvals = 0;

    for (const task of bucket) {
      scorecard.taskCount += 1;
      scorecard.tierUsage[normalizeTier(classifyTaskMode(task).recommendedTier)] += 1;
    }

    for (const event of events) {
      totalCostUsd += parseFloat(event.costUsd ?? '0');

      if (event.eventType === 'verification') {
        totalVerificationEvents += 1;
        const payload = event.payload as { status?: string } | null;
        if (payload?.status === 'fail') {
          failedVerificationEvents += 1;
        }
      }

      if (event.eventType === 'model_escalation') {
        escalations += 1;
      }

      if (event.eventType === 'approval_request' || event.eventType === 'approval_gate') {
        approvals += 1;
      }
    }

    scorecard.averageCostUsd = Number((totalCostUsd / Math.max(bucket.length, 1)).toFixed(6));
    scorecard.escalationFrequency = Number((escalations / Math.max(bucket.length, 1)).toFixed(4));
    scorecard.approvalFrequency = Number((approvals / Math.max(bucket.length, 1)).toFixed(4));
    scorecard.verificationFailureRate = Number(
      (failedVerificationEvents / Math.max(totalVerificationEvents, 1)).toFixed(4),
    );
  }

  return scorecards;
}

export async function buildTaskRoutingScorecard(taskId: string): Promise<TaskRoutingScorecard> {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const classification = classifyTaskMode(task);
  const workflowId = workflowIdForKind(determineWorkflowKind(classification));
  const tier = normalizeTier(classification.recommendedTier);
  const events = await db.query.taskEvents.findMany({
    where: eq(taskEvents.taskId, taskId),
    orderBy: [desc(taskEvents.createdAt)],
  });

  let escalationCount = 0;
  let verificationFailures = 0;
  let approvalRequests = 0;
  let totalCostUsd = 0;

  for (const event of events) {
    totalCostUsd += parseFloat(event.costUsd ?? '0');

    if (event.eventType === 'model_escalation') {
      escalationCount += 1;
    }

    if (event.eventType === 'verification') {
      const payload = event.payload as { status?: string } | null;
      if (payload?.status === 'fail') {
        verificationFailures += 1;
      }
    }

    if (event.eventType === 'approval_request' || event.eventType === 'approval_gate') {
      approvalRequests += 1;
    }
  }

  return {
    taskId,
    workflowId,
    tier,
    escalationCount,
    verificationFailures,
    approvalRequests,
    totalCostUsd: Number(totalCostUsd.toFixed(6)),
  };
}
