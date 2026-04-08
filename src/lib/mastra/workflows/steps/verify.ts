import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { incrementTaskFailureCount, escalateTierFromFailureCount } from '@/lib/orchestration/escalation';
import {
  runDefaultVerificationSequence,
  runHighRiskVerificationSequence,
} from '@/lib/mastra/tools/verification-tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { implementedTaskSchema, verifiedTaskSchema } from './shared';

type ImplementedTask = z.infer<typeof implementedTaskSchema>;

async function verifyTask(
  inputData: ImplementedTask,
  options: { highRisk?: boolean } = {},
) {
  if (inputData.approval.status === 'requested' || !inputData.implementationSummary) {
    return {
      ...inputData,
      verification: {
        status: 'skipped' as const,
        gateResults: [],
      },
    };
  }

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, inputData.taskId),
  });

  if (!task) {
    throw new Error(`Task ${inputData.taskId} not found`);
  }

  const gateResults = options.highRisk
    ? await runHighRiskVerificationSequence({
        taskId: task.id,
        agentId: inputData.agentId,
        projectId: task.projectId,
      })
    : await runDefaultVerificationSequence({
        taskId: task.id,
        agentId: inputData.agentId,
        projectId: task.projectId,
      });

  const failedGate = gateResults.find((gate) => gate.status === 'failed');
  let escalation:
    | {
        reason: string;
        newTier: 'fast' | 'standard' | 'premium';
      }
    | undefined;

  if (failedGate) {
    const failureCount = await incrementTaskFailureCount(task.id);
    const newTier = escalateTierFromFailureCount(
      inputData.routingAdjustment.effectiveTier,
      failureCount,
    );

    if (newTier !== inputData.routingAdjustment.effectiveTier) {
      escalation = {
        reason: `Verification failed at ${failedGate.gate} after ${failureCount} attempt(s)`,
        newTier,
      };
    }
  }

  await logTaskEvent({
    taskId: task.id,
    agentId: inputData.agentId,
    eventType: 'verification',
    payload: {
      status: failedGate ? 'fail' : 'pass',
      gate_results: gateResults,
      escalation,
      workflow_id: inputData.workflowSelection.workflowId,
    },
  });

  return {
    ...inputData,
    verification: {
      status: (failedGate ? 'fail' : 'pass') as 'pass' | 'fail',
      gateResults,
      escalation,
    },
  };
}

export const verifyTaskStep = createStep({
  id: 'verify-task',
  inputSchema: implementedTaskSchema,
  outputSchema: verifiedTaskSchema,
  execute: async ({ inputData }) => verifyTask(inputData),
});

export const verifyHighRiskTaskStep = createStep({
  id: 'verify-high-risk-task',
  inputSchema: implementedTaskSchema,
  outputSchema: verifiedTaskSchema,
  execute: async ({ inputData }) => verifyTask(inputData, { highRisk: true }),
});
