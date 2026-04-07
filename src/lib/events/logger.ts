import { db } from '@/lib/db';
import { taskEvents } from '@/lib/db/schema';

export type EventType =
  | 'status_change'
  | 'message'
  | 'tool_call'
  | 'model_call'
  | 'assignment'
  | 'delegation'
  | 'budget_warning'
  | 'budget_exceeded'
  | 'heartbeat_start'
  | 'heartbeat_end'
  | 'error'
  | 'loop_detected'
  | 'approval_request'
  | 'approval_response'
  | 'model_fallback';

export interface LogEventParams {
  taskId: string;
  agentId?: string;
  eventType: EventType;
  payload?: Record<string, unknown>;
  tokensUsed?: number;
  costUsd?: string;
}

export async function logTaskEvent(params: LogEventParams) {
  const { taskId, agentId, eventType, payload, tokensUsed, costUsd } = params;

  await db.insert(taskEvents).values({
    taskId,
    agentId: agentId ?? null,
    eventType,
    payload: payload ?? null,
    tokensUsed: tokensUsed ?? null,
    costUsd: costUsd ?? null,
  });

  // Stub SSE emitter — Phase 4 will wire up real-time push
  console.log(`[task_event] task=${taskId} type=${eventType}`, payload ?? '');
}
