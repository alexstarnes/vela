/**
 * Heartbeat Execution — the core execution loop for agent task processing.
 *
 * Phase 5 additions:
 *   - Budget enforcement: atomic spend after execution; 80% warning; 100% pause
 *   - Loop detection: LoopTracker per run; transitions task → blocked on detect
 *   - Approval gating: create_subtask intercepted when agent requires_approval;
 *     task transitions to waiting_for_human; approval row created
 *
 * Errors must NEVER crash the process.
 */

import { db } from '@/lib/db';
import { tasks, agents, heartbeats, approvals } from '@/lib/db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';
import { createMastraAgent } from './agent-factory';
import { checkBudgetPrecondition, spendBudget } from '@/lib/governance/budget';
import { LoopTracker, LoopDetectedError } from '@/lib/governance/loop-detector';
import type { Task, Agent as DbAgent } from '@/lib/db/schema';

// ─── Model cost constants (dollars per token) ─────────────────────
// Used for rough cost estimation when the model doesn't return cost metadata.
// These are conservative estimates; real costs depend on model used.
const COST_PER_INPUT_TOKEN = 0.000003; // $3/M tokens (Sonnet)
const COST_PER_OUTPUT_TOKEN = 0.000015; // $15/M tokens (Sonnet)

function estimateCostUsd(inputTokens: number, outputTokens: number): string {
  const cost = inputTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN;
  return cost.toFixed(6);
}

/**
 * Normalize tool-call objects from Mastra / AI SDK (shape varies by provider & version).
 * Without this, `toolName`/`input` are often missing → everything becomes "unknown:{}" and
 * loop detection false-positives when the same step is reflected multiple times in `steps`.
 */
function extractToolCallMeta(tc: unknown): {
  toolName: string;
  toolInput: unknown;
  toolCallId: string | null;
} {
  if (!tc || typeof tc !== 'object') {
    return { toolName: 'unknown', toolInput: {}, toolCallId: null };
  }

  const r = tc as Record<string, unknown>;

  // Mastra v1.23+ stream chunks: { type: 'tool-call', payload: { toolCallId, toolName, args } }
  if (r.payload && typeof r.payload === 'object') {
    const pl = r.payload as Record<string, unknown>;
    if (
      r.type === 'tool-call' ||
      typeof pl.toolName === 'string' ||
      typeof pl.toolCallId === 'string' ||
      pl.args !== undefined ||
      pl.input !== undefined
    ) {
      return extractToolCallMeta(r.payload);
    }
  }

  if (
    r.toolInvocation &&
    typeof r.toolInvocation === 'object' &&
    !r.toolName &&
    !r.name &&
    !r.function
  ) {
    return extractToolCallMeta(r.toolInvocation);
  }

  const toolCallId =
    (typeof r.toolCallId === 'string' && r.toolCallId) ||
    (typeof r.id === 'string' && r.id) ||
    null;

  let toolName =
    (typeof r.toolName === 'string' && r.toolName) ||
    (typeof r.name === 'string' && r.name) ||
    (typeof r.tool === 'string' && r.tool) ||
    '';

  let toolInput: unknown =
    r.input ?? r.args ?? r.arguments ?? r.parameters;

  const fn = r.function;
  if (fn && typeof fn === 'object') {
    const f = fn as Record<string, unknown>;
    if (!toolName && typeof f.name === 'string') toolName = f.name;
    if (toolInput === undefined || toolInput === null) {
      if (f.arguments !== undefined) toolInput = f.arguments;
    }
  }

  if (!toolName) toolName = 'unknown';
  if (toolInput === undefined || toolInput === null) toolInput = {};

  if (typeof toolInput === 'string') {
    try {
      toolInput = JSON.parse(toolInput) as unknown;
    } catch {
      toolInput = { _raw: toolInput };
    }
  }

  return { toolName, toolInput, toolCallId };
}

// ─── Agent requires_approval check ────────────────────────────────
// We store this as a JSON field in system_prompt conventions, but for MVP
// we check agent.role contains "requires_approval" as a simple heuristic.
// A full implementation would store this as a DB column.
function agentRequiresApproval(dbAgent: DbAgent): boolean {
  // Check the system prompt for the marker or the role
  const prompt = (dbAgent.systemPrompt ?? '').toLowerCase();
  const role = (dbAgent.role ?? '').toLowerCase();
  return prompt.includes('requires_approval:true') || role.includes('requires_approval');
}

// ─── Internal helpers ─────────────────────────────────────────────

async function checkoutNextTask(agentId: string): Promise<Task | null> {
  const result = await db.execute(sql`
    UPDATE tasks
    SET status = 'in_progress',
        locked_by = ${agentId},
        locked_at = now(),
        updated_at = now()
    WHERE id = (
      SELECT id FROM tasks
      WHERE assigned_agent_id = ${agentId}
        AND status = 'open'
        AND locked_by IS NULL
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low'    THEN 3
        END ASC,
        created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const rows = result as unknown as Task[];
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

async function releaseTaskLock(taskId: string): Promise<void> {
  try {
    await db
      .update(tasks)
      .set({ lockedBy: null, lockedAt: null, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
  } catch (err) {
    console.error(`[heartbeat] Failed to release lock on task ${taskId}:`, err);
  }
}

async function createHeartbeatRecord(agentId: string): Promise<{ id: string }> {
  const [hb] = await db
    .insert(heartbeats)
    .values({ agentId, status: 'running' })
    .returning({ id: heartbeats.id });
  return hb;
}

async function completeHeartbeatRecord(
  heartbeatId: string,
  result: {
    status: 'completed' | 'failed' | 'timeout';
    tasksProcessed: number;
    tokensUsed?: number;
    costUsd?: string;
    error?: string;
  },
): Promise<void> {
  await db
    .update(heartbeats)
    .set({
      completedAt: new Date(),
      status: result.status,
      tasksProcessed: result.tasksProcessed,
      tokensUsed: result.tokensUsed ?? 0,
      costUsd: result.costUsd ?? '0',
      error: result.error ?? null,
    })
    .where(eq(heartbeats.id, heartbeatId));
}

// ─── Core execution logic ─────────────────────────────────────────

/**
 * Run the agent for a checked-out task.
 * Returns token usage and any loop/budget signals.
 */
async function runAgentOnTask(
  dbAgent: DbAgent,
  checkedOutTask: Task,
  heartbeatId: string,
): Promise<{ totalTokens: number; costUsd: string }> {
  const loopTracker = new LoopTracker(3);

  // 1. Create Mastra agent instance
  const mastraAgent = await createMastraAgent(dbAgent, checkedOutTask);

  // 2. Execute the agent
  const result = await mastraAgent.generate(
    `Process the following task:\n\nTitle: ${checkedOutTask.title}\n${
      checkedOutTask.description ? `Description: ${checkedOutTask.description}` : ''
    }`,
  );

  // 3. Process tool calls through loop tracker
  // Prefer top-level `toolCalls` from Mastra getFullOutput(); step-level arrays can repeat the same ids.
  const out = result as Record<string, unknown>;
  const flatToolCalls: unknown[] = [];
  if (Array.isArray(out.toolCalls) && out.toolCalls.length > 0) {
    flatToolCalls.push(...(out.toolCalls as unknown[]));
  } else if (result.steps) {
    for (const step of result.steps) {
      if (step.toolCalls?.length) flatToolCalls.push(...step.toolCalls);
    }
  }

  const seenToolCallIds = new Set<string>();
  for (const tc of flatToolCalls) {
    const { toolName, toolInput, toolCallId } = extractToolCallMeta(tc);
    if (toolCallId && seenToolCallIds.has(toolCallId)) {
      continue;
    }
    if (toolCallId) seenToolCallIds.add(toolCallId);

    // Loop detection: throws LoopDetectedError if threshold exceeded
    loopTracker.checkAndRecord(toolName, toolInput);

    await logTaskEvent({
      taskId: checkedOutTask.id,
      agentId: dbAgent.id,
      eventType: 'tool_call',
      payload: {
        tool_name: toolName,
        input: toolInput,
      },
    });

    // Check for delegation requiring approval
    if (toolName === 'create_subtask' && agentRequiresApproval(dbAgent)) {
      await handleDelegationApproval(dbAgent, checkedOutTask, toolInput);
    }
  }

  // 4. Log the agent's text response
  const totalTokens = result.usage
    ? (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)
    : 0;
  const inputTokens = result.usage?.inputTokens ?? 0;
  const outputTokens = result.usage?.outputTokens ?? 0;
  const costUsd = estimateCostUsd(inputTokens, outputTokens);

  await logTaskEvent({
    taskId: checkedOutTask.id,
    agentId: dbAgent.id,
    eventType: 'message',
    payload: { role: 'agent', content: result.text },
    tokensUsed: totalTokens,
    costUsd,
  });

  await logTaskEvent({
    taskId: checkedOutTask.id,
    agentId: dbAgent.id,
    eventType: 'heartbeat_end',
    payload: {
      heartbeat_id: heartbeatId,
      tokens_used: totalTokens,
      cost_usd: costUsd,
      text_length: result.text?.length ?? 0,
    },
  });

  return { totalTokens, costUsd };
}

/**
 * When an agent that requires approval attempts to create a subtask,
 * instead of executing the delegation directly we:
 *   1. Create an approval row with the proposed subtask payload
 *   2. Transition the parent task to waiting_for_human
 */
async function handleDelegationApproval(
  dbAgent: DbAgent,
  parentTask: Task,
  toolInput: unknown,
): Promise<void> {
  const input = toolInput as Record<string, unknown>;

  // Create approval request
  const [row] = await db
    .insert(approvals)
    .values({
      agentId: dbAgent.id,
      taskId: parentTask.id,
      actionType: 'task_delegation',
      description: `Agent "${dbAgent.name}" wants to delegate subtask: "${input.title ?? 'untitled'}"`,
      payload: {
        title: input.title ?? 'Delegated subtask',
        description: input.description ?? null,
        assigned_agent_id: input.assignedAgentId ?? null,
        priority: input.priority ?? 'medium',
        project_id: parentTask.projectId,
      },
      status: 'pending',
    })
    .returning({ id: approvals.id });

  await logTaskEvent({
    taskId: parentTask.id,
    agentId: dbAgent.id,
    eventType: 'approval_request',
    payload: {
      approval_id: row.id,
      action_type: 'task_delegation',
      description: `Delegation approval requested for: "${input.title ?? 'untitled'}"`,
    },
  });

  // Transition task to waiting_for_human
  await db
    .update(tasks)
    .set({ status: 'waiting_for_human', updatedAt: new Date() })
    .where(eq(tasks.id, parentTask.id));

  await logTaskEvent({
    taskId: parentTask.id,
    agentId: dbAgent.id,
    eventType: 'status_change',
    payload: {
      from: 'in_progress',
      to: 'waiting_for_human',
      reason: 'Delegation requires human approval',
    },
  });
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Execute a heartbeat for a given agent.
 * Picks the next open task, runs the agent, enforces budget, detects loops.
 */
export async function executeHeartbeat(agentId: string): Promise<{
  success: boolean;
  taskId?: string;
  error?: string;
}> {
  let heartbeatRecord: { id: string } | null = null;
  let checkedOutTask: Task | null = null;

  try {
    // 1. Load the agent
    const dbAgent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });

    if (!dbAgent) {
      return { success: false, error: `Agent ${agentId} not found` };
    }

    // 2. Check agent status
    if (dbAgent.status !== 'active') {
      return { success: false, error: `Agent ${agentId} is ${dbAgent.status}, skipping` };
    }

    // 3. Budget pre-check — don't start if already exceeded
    const budget = await checkBudgetPrecondition(agentId);
    if (!budget.canProceed) {
      // Ensure agent status is correctly set
      await db
        .update(agents)
        .set({ status: 'budget_exceeded', updatedAt: new Date() })
        .where(eq(agents.id, agentId));
      return { success: false, error: budget.reason };
    }

    // 4. Create heartbeat record
    heartbeatRecord = await createHeartbeatRecord(agentId);

    // 5. Atomic task checkout
    checkedOutTask = await checkoutNextTask(agentId);

    if (!checkedOutTask) {
      await completeHeartbeatRecord(heartbeatRecord.id, {
        status: 'completed',
        tasksProcessed: 0,
      });
      return { success: true };
    }

    // 6. Log heartbeat start
    await logTaskEvent({
      taskId: checkedOutTask.id,
      agentId,
      eventType: 'heartbeat_start',
      payload: { heartbeat_id: heartbeatRecord.id },
    });

    await logTaskEvent({
      taskId: checkedOutTask.id,
      agentId,
      eventType: 'status_change',
      payload: { from: 'open', to: 'in_progress', reason: 'Heartbeat checkout' },
    });

    // 7. Run agent with loop detection
    const { totalTokens, costUsd } = await runAgentOnTask(
      dbAgent,
      checkedOutTask,
      heartbeatRecord.id,
    );

    // 8. Spend budget atomically (single UPDATE) — after execution so we know actual cost
    const budgetResult = await spendBudget(agentId, costUsd, checkedOutTask.id);

    if (budgetResult.status === 'exceeded') {
      // Agent is now paused; task transitions to blocked
      await db
        .update(tasks)
        .set({ status: 'blocked', updatedAt: new Date() })
        .where(eq(tasks.id, checkedOutTask.id));

      await logTaskEvent({
        taskId: checkedOutTask.id,
        agentId,
        eventType: 'status_change',
        payload: {
          from: 'in_progress',
          to: 'blocked',
          reason: 'Budget exceeded — agent paused',
        },
      });
    }

    // 9. Complete heartbeat record
    await completeHeartbeatRecord(heartbeatRecord.id, {
      status: 'completed',
      tasksProcessed: 1,
      tokensUsed: totalTokens,
      costUsd,
    });

    return { success: true, taskId: checkedOutTask.id };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[heartbeat] Error for agent ${agentId}:`, errorMsg);

    // Handle loop detection specially
    if (err instanceof LoopDetectedError && checkedOutTask) {
      try {
        await logTaskEvent({
          taskId: checkedOutTask.id,
          agentId,
          eventType: 'loop_detected',
          payload: {
            signature: err.signature,
            count: err.count,
            message: err.message,
          },
        });

        // Transition task to blocked
        await db
          .update(tasks)
          .set({ status: 'blocked', updatedAt: new Date() })
          .where(eq(tasks.id, checkedOutTask.id));

        await logTaskEvent({
          taskId: checkedOutTask.id,
          agentId,
          eventType: 'status_change',
          payload: { from: 'in_progress', to: 'blocked', reason: 'Loop detected' },
        });
      } catch {
        console.error('[heartbeat] Failed to log loop event');
      }
    }

    // Log generic error on task; requeue so scheduled heartbeats can retry (they only checkout `open`).
    if (checkedOutTask) {
      try {
        await logTaskEvent({
          taskId: checkedOutTask.id,
          agentId,
          eventType: 'error',
          payload: { message: errorMsg, stack: err instanceof Error ? err.stack : undefined },
        });

        if (!(err instanceof LoopDetectedError)) {
          await db
            .update(tasks)
            .set({ status: 'open', updatedAt: new Date() })
            .where(eq(tasks.id, checkedOutTask.id));

          await logTaskEvent({
            taskId: checkedOutTask.id,
            agentId,
            eventType: 'status_change',
            payload: {
              from: 'in_progress',
              to: 'open',
              reason: 'Run failed — requeued for retry',
            },
          });
        }
      } catch {
        console.error('[heartbeat] Failed to log error event');
      }
    }

    if (heartbeatRecord) {
      try {
        await completeHeartbeatRecord(heartbeatRecord.id, {
          status: 'failed',
          tasksProcessed: checkedOutTask ? 1 : 0,
          error: errorMsg,
        });
      } catch {
        console.error('[heartbeat] Failed to complete heartbeat record');
      }
    }

    return { success: false, taskId: checkedOutTask?.id, error: errorMsg };
  } finally {
    if (checkedOutTask) {
      await releaseTaskLock(checkedOutTask.id);
    }
  }
}

/**
 * Execute heartbeat for a specific task ID (manual trigger).
 */
export async function executeHeartbeatForTask(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  let heartbeatRecord: { id: string } | null = null;

  try {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (!task) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    if (!task.assignedAgentId) {
      return { success: false, error: `Task ${taskId} has no assigned agent` };
    }

    const dbAgent = await db.query.agents.findFirst({
      where: eq(agents.id, task.assignedAgentId),
    });

    if (!dbAgent) {
      return { success: false, error: `Agent ${task.assignedAgentId} not found` };
    }

    if (dbAgent.status !== 'active') {
      return { success: false, error: `Agent ${dbAgent.name} is ${dbAgent.status}` };
    }

    // Budget pre-check
    const budget = await checkBudgetPrecondition(dbAgent.id);
    if (!budget.canProceed) {
      await db
        .update(agents)
        .set({ status: 'budget_exceeded', updatedAt: new Date() })
        .where(eq(agents.id, dbAgent.id));
      return { success: false, error: budget.reason };
    }

    heartbeatRecord = await createHeartbeatRecord(dbAgent.id);

    const validStatuses = ['open', 'in_progress'];
    if (!validStatuses.includes(task.status)) {
      await completeHeartbeatRecord(heartbeatRecord.id, {
        status: 'completed',
        tasksProcessed: 0,
      });
      return {
        success: false,
        error: `Task is in "${task.status}" status, cannot execute`,
      };
    }

    // Atomically lock
    const lockResult = await db
      .update(tasks)
      .set({
        status: 'in_progress',
        lockedBy: dbAgent.id,
        lockedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), isNull(tasks.lockedBy)))
      .returning({ id: tasks.id });

    if (lockResult.length === 0) {
      await completeHeartbeatRecord(heartbeatRecord.id, {
        status: 'completed',
        tasksProcessed: 0,
      });
      return { success: false, error: 'Task is already locked by another process' };
    }

    try {
      await logTaskEvent({
        taskId,
        agentId: dbAgent.id,
        eventType: 'heartbeat_start',
        payload: { heartbeat_id: heartbeatRecord.id, manual: true },
      });

      if (task.status === 'open') {
        await logTaskEvent({
          taskId,
          agentId: dbAgent.id,
          eventType: 'status_change',
          payload: { from: 'open', to: 'in_progress', reason: 'Manual heartbeat' },
        });
      }

      const { totalTokens, costUsd } = await runAgentOnTask(
        dbAgent,
        { ...task, status: 'in_progress' },
        heartbeatRecord.id,
      );

      // Atomic budget spend
      const budgetResult = await spendBudget(dbAgent.id, costUsd, taskId);

      if (budgetResult.status === 'exceeded') {
        await db
          .update(tasks)
          .set({ status: 'blocked', updatedAt: new Date() })
          .where(eq(tasks.id, taskId));

        await logTaskEvent({
          taskId,
          agentId: dbAgent.id,
          eventType: 'status_change',
          payload: {
            from: 'in_progress',
            to: 'blocked',
            reason: 'Budget exceeded — agent paused',
          },
        });
      }

      await completeHeartbeatRecord(heartbeatRecord.id, {
        status: 'completed',
        tasksProcessed: 1,
        tokensUsed: totalTokens,
        costUsd,
      });

      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[heartbeat] Manual heartbeat error for task ${taskId}:`, errorMsg);

      // Handle loop detection
      if (err instanceof LoopDetectedError) {
        try {
          await logTaskEvent({
            taskId,
            agentId: dbAgent.id,
            eventType: 'loop_detected',
            payload: {
              signature: err.signature,
              count: err.count,
              message: err.message,
            },
          });

          await db
            .update(tasks)
            .set({ status: 'blocked', updatedAt: new Date() })
            .where(eq(tasks.id, taskId));

          await logTaskEvent({
            taskId,
            agentId: dbAgent.id,
            eventType: 'status_change',
            payload: { from: 'in_progress', to: 'blocked', reason: 'Loop detected' },
          });
        } catch {
          // swallow
        }
      }

      try {
        await logTaskEvent({
          taskId,
          eventType: 'error',
          payload: { message: errorMsg },
        });

        if (!(err instanceof LoopDetectedError)) {
          await db
            .update(tasks)
            .set({ status: 'open', updatedAt: new Date() })
            .where(eq(tasks.id, taskId));

          await logTaskEvent({
            taskId,
            agentId: dbAgent.id,
            eventType: 'status_change',
            payload: {
              from: 'in_progress',
              to: 'open',
              reason: 'Run failed — requeued for retry',
            },
          });
        }
      } catch {
        // swallow
      }

      if (heartbeatRecord) {
        try {
          await completeHeartbeatRecord(heartbeatRecord.id, {
            status: 'failed',
            tasksProcessed: 1,
            error: errorMsg,
          });
        } catch {
          // swallow
        }
      }

      return { success: false, error: errorMsg };
    } finally {
      await releaseTaskLock(taskId);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[heartbeat] Outer error for task ${taskId}:`, errorMsg);

    if (heartbeatRecord) {
      try {
        await completeHeartbeatRecord(heartbeatRecord.id, {
          status: 'failed',
          tasksProcessed: 1,
          error: errorMsg,
        });
      } catch {
        // swallow
      }
    }

    return { success: false, error: errorMsg };
  }
}
