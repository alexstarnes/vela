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
  | 'model_fallback'
  | 'model_escalation'
  | 'verification'
  | 'workflow_route'
  | 'repo_map'
  | 'review'
  | 'approval_gate'
  | 'routing_tuning'
  | 'scorecard'
  | 'mode_selection'
  | 'implementation_audit'
  | 'ring_context'
  | 'ring_findings'
  | 'ring_reconciliation';

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

  // SSE delivery: /api/events/stream serves these rows to clients by polling the
  // task_events table every 2s, with last-event-id reconnect. Not a real-time
  // push — fine unless latency becomes an actual complaint.
  console.log(`[task_event] task=${taskId} type=${eventType}`, payload ?? '');
}
