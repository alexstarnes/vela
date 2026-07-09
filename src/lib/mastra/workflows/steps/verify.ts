import { createStep } from '@mastra/core/workflows';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { logTaskEvent } from '@/lib/events/logger';
import { incrementTaskFailureCount, escalateTierFromFailureCount } from '@/lib/orchestration/escalation';
import { getLowRiskAuditFailure } from '@/lib/orchestration/implementation-audit';
import { getTaskExecutionPolicy } from '@/lib/orchestration/task-shape';
import {
  classifyVerificationFailures,
  runDefaultVerificationSequence,
  runHighRiskVerificationSequence,
  runScopedVerificationSequence,
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
        policy: 'strict' as const,
        gateResults: [],
        verifiedFiles: [],
        blockingFailures: [],
        informationalFailures: [],
      },
    };
  }

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, inputData.taskId),
  });

  if (!task) {
    throw new Error(`Task ${inputData.taskId} not found`);
  }

  const executionPolicy = getTaskExecutionPolicy(task);
  const verifiedFiles =
    inputData.implementationAudit.sourceFilesChanged.length > 0
      ? inputData.implementationAudit.sourceFilesChanged
      : inputData.implementationAudit.changedFiles;

  let policy: 'scoped' | 'strict' = options.highRisk
    ? 'strict'
    : executionPolicy.verificationPolicy;
  let gateResults = [] as Awaited<ReturnType<typeof runDefaultVerificationSequence>>;
  let blockingFailures: Array<{ gate: string; summary: string; files: string[] }> = [];
  let informationalFailures: Array<{ gate: string; summary: string; files: string[] }> = [];

  if (policy === 'scoped') {
    const auditFailure = getLowRiskAuditFailure(task, inputData.implementationAudit);
    if (auditFailure) {
      blockingFailures = [
        {
          gate: 'implementation_audit',
          summary: auditFailure,
          files: inputData.implementationAudit.changedFiles,
        },
      ];
    } else {
      const scopedResult = await runScopedVerificationSequence(
        {
          taskId: task.id,
          agentId: inputData.agentId,
          projectId: task.projectId,
        },
        {
          task,
          changedFiles: verifiedFiles,
        },
      );
      gateResults = scopedResult.gateResults;
      const classified = classifyVerificationFailures({
        policy,
        gateResults,
        verifiedFiles: scopedResult.verifiedFiles,
        changedLineRanges: scopedResult.changedLineRanges,
      });
      blockingFailures = classified.blockingFailures;
      informationalFailures = classified.informationalFailures;
    }
  } else {
    gateResults = options.highRisk
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
    const classified = classifyVerificationFailures({
      policy,
      gateResults,
      verifiedFiles,
    });
    blockingFailures = classified.blockingFailures;
    informationalFailures = classified.informationalFailures;
  }

  const failedGate = blockingFailures[0];
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
      policy,
      gate_results: gateResults,
      verified_files: verifiedFiles,
      blocking_failures: blockingFailures,
      informational_failures: informationalFailures,
      escalation,
      workflow_id: inputData.workflowSelection.workflowId,
    },
  });

  return {
    ...inputData,
    verification: {
      status: (failedGate ? 'fail' : 'pass') as 'pass' | 'fail',
      policy,
      gateResults,
      verifiedFiles,
      blockingFailures,
      informationalFailures,
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
