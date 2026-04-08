import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { classifyTaskMode } from '@/lib/orchestration/mode-classifier';
import { applyRoutingTierFloor } from '@/lib/orchestration/routing-tuning';
import {
  determineWorkflowKind,
  selectWorkflowForClassification,
} from '@/lib/orchestration/workflow-selector';
import { logTaskEvent } from '@/lib/events/logger';
import { classifiedTaskSchema, workflowRunInputSchema } from './shared';

export const classifyTaskStep = createStep({
  id: 'classify-task',
  inputSchema: workflowRunInputSchema,
  outputSchema: classifiedTaskSchema,
  execute: async ({ inputData }) => {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, inputData.taskId),
    });

    if (!task) {
      throw new Error(`Task ${inputData.taskId} not found`);
    }

    const classification = classifyTaskMode(task);
    const workflowSelection = selectWorkflowForClassification(classification);
    const routingAdjustment = await applyRoutingTierFloor({
      classification,
      workflowId: workflowSelection.workflowId,
      task,
    });

    const workflowTypeMap: Record<string, string> = {
      featureWorkflow: 'feature',
      highRiskWorkflow: 'high_risk',
      debugWorkflow: 'debug',
    };

    await db
      .update(tasks)
      .set({
        modeScore: classification.score,
        workflowType: workflowTypeMap[workflowSelection.workflowId] ?? 'feature',
      })
      .where(eq(tasks.id, inputData.taskId));

    await logTaskEvent({
      taskId: inputData.taskId,
      agentId: inputData.agentId,
      eventType: 'mode_selection',
      payload: {
        mode: classification.mode,
        score: classification.score,
        recommended_tier: classification.recommendedTier,
        effective_tier: routingAdjustment.effectiveTier,
        floor_applied: routingAdjustment.floorApplied,
        risk_flags: classification.riskFlags,
        workflow_id: workflowSelection.workflowId,
      },
    });

    return {
      ...inputData,
      classification,
      workflowKind: determineWorkflowKind(classification),
      workflowSelection,
      routingAdjustment,
    };
  },
});
