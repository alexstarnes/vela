import { classifyTaskMode } from '@/lib/orchestration/mode-classifier';
import { selectWorkflowForClassification } from '@/lib/orchestration/workflow-selector';
import type { RoutingFixture } from './routing-quality.fixtures';
import { routingResultSchema } from './routing-quality.scorer';

export function evaluateRoutingFixture(fixture: RoutingFixture) {
  const classification = classifyTaskMode({
    title: fixture.title,
    description: fixture.description,
  });
  const workflowSelection = selectWorkflowForClassification(classification);

  return routingResultSchema.parse({
    mode: classification.mode,
    workflowId: workflowSelection.workflowId,
    tier: classification.recommendedTier,
  });
}
