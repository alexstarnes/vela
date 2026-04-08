import type { Agent, Task } from '@/lib/db/schema';
import type { ModeClassification } from './mode-classifier';

export type WorkflowKind = 'feature' | 'high_risk' | 'debug';
export type WorkflowId = 'featureWorkflow' | 'highRiskWorkflow' | 'debugWorkflow';

export const WORKFLOW_IDS = ['featureWorkflow', 'highRiskWorkflow', 'debugWorkflow'] as const;

export function determineWorkflowKind(
  classification: Pick<ModeClassification, 'score' | 'riskFlags'>,
): WorkflowKind {
  if (classification.riskFlags.includes('debug')) {
    return 'debug';
  }

  if (
    classification.score >= 6 ||
    classification.riskFlags.some((flag) =>
      ['auth', 'payments', 'rls', 'secrets', 'security', 'schema', 'infrastructure'].includes(flag),
    )
  ) {
    return 'high_risk';
  }

  return 'feature';
}

export function workflowIdForKind(kind: WorkflowKind): WorkflowId {
  if (kind === 'high_risk') return 'highRiskWorkflow';
  if (kind === 'debug') return 'debugWorkflow';
  return 'featureWorkflow';
}

export function selectWorkflowForClassification(
  classification: Pick<ModeClassification, 'score' | 'riskFlags'>,
): { workflowId: WorkflowId; reason: string } {
  const workflowKind = determineWorkflowKind(classification);
  const workflowId = workflowIdForKind(workflowKind);

  const reason =
    workflowKind === 'debug'
      ? 'Task includes bug/debug signals, so it uses the debug workflow.'
      : workflowKind === 'high_risk'
        ? 'Task is high-risk or security-sensitive, so it uses the high-risk workflow.'
        : 'Task is low-risk enough to use the default feature workflow.';

  return { workflowId, reason };
}

export function taskNeedsHumanApproval(
  classification: Pick<ModeClassification, 'riskFlags' | 'score'>,
): boolean {
  return (
    classification.score >= 6 ||
    classification.riskFlags.some((flag) =>
      ['auth', 'payments', 'rls', 'secrets', 'security', 'schema', 'infrastructure'].includes(flag),
    )
  );
}

export function buildApprovalReason(
  task: Pick<Task, 'title'>,
  classification: Pick<ModeClassification, 'riskFlags' | 'score'>,
): string {
  const flags = classification.riskFlags.filter((flag) => flag !== 'debug');
  if (flags.length > 0) {
    return `High-risk workflow approval required for "${task.title}" due to ${flags.join(', ')}.`;
  }

  return `High-risk workflow approval required for "${task.title}" (score ${classification.score}/8).`;
}

export function shouldUseEmbeddedWorkflowRuntime(
  agent: Pick<Agent, 'agentKind' | 'name'>,
): boolean {
  return agent.agentKind === 'runtime' && agent.name === 'Supervisor';
}
