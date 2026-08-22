export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getTask, getTaskEvents, getSubtasks } from '@/lib/actions/tasks';
import { listAgents } from '@/lib/actions/agents';
import { getTaskApprovals } from '@/lib/actions/approvals';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { TaskStatusControls } from './task-status-controls';
import { TaskMessageInput } from './task-message-input';
import { ApprovalPanel } from './approval-panel';
import { AttachDocument } from './attach-document';
import { ReviewPanel } from './review-panel';
import { listTaskDocuments } from '@/lib/documents';

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  backlog: { bg: '#6B665A20', fg: '#8E897B' },
  open: { bg: '#4A7AB520', fg: '#4A7AB5' },
  in_progress: { bg: '#F5A62320', fg: '#F5A623' },
  review: { bg: '#7C3AED20', fg: '#7C3AED' },
  done: { bg: '#3D8B5C20', fg: '#3D8B5C' },
  waiting_for_human: { bg: '#C27D1A20', fg: '#C27D1A' },
  blocked: { bg: '#C4413A20', fg: '#C4413A' },
  cancelled: { bg: '#6B665A20', fg: '#6B665A' },
};

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  status_change: { icon: '↻', color: '#8E897B' },
  message: { icon: '◆', color: '#F5A623' },
  tool_call: { icon: '⚡', color: '#4A7AB5' },
  model_call: { icon: '◈', color: '#4A7AB5' },
  assignment: { icon: '→', color: '#8E897B' },
  delegation: { icon: '↗', color: '#7C3AED' },
  budget_warning: { icon: '⚠', color: '#C27D1A' },
  budget_exceeded: { icon: '✕', color: '#C4413A' },
  heartbeat_start: { icon: '◷', color: '#6B665A' },
  heartbeat_end: { icon: '◷', color: '#6B665A' },
  error: { icon: '✕', color: '#C4413A' },
  loop_detected: { icon: '⟳', color: '#C4413A' },
  approval_request: { icon: '?', color: '#C27D1A' },
  approval_response: { icon: '✓', color: '#3D8B5C' },
  model_fallback: { icon: '⤵', color: '#4A7AB5' },
  verification: { icon: '⛨', color: '#3D8B5C' },
  review: { icon: '☰', color: '#7C3AED' },
  implementation_audit: { icon: '±', color: '#4A7AB5' },
  workflow_route: { icon: '⇶', color: '#7C3AED' },
  mode_selection: { icon: '◉', color: '#6B665A' },
  repo_map: { icon: '▤', color: '#6B665A' },
  model_escalation: { icon: '↑', color: '#C27D1A' },
  routing_tuning: { icon: '≋', color: '#6B665A' },
  scorecard: { icon: '∑', color: '#6B665A' },
  document_added: { icon: '▣', color: '#F5A623' },
};

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [task, events, subtasks, agents, taskApprovals, taskDocuments] = await Promise.all([
    getTask(id),
    getTaskEvents(id),
    getSubtasks(id),
    listAgents(),
    getTaskApprovals(id),
    listTaskDocuments(id),
  ]);

  if (!task) notFound();

  const sc = STATUS_COLORS[task.status] ?? STATUS_COLORS.backlog;

  // Calculate cost from events
  const totalCost = events.reduce((sum, e) => {
    return sum + parseFloat(e.costUsd ?? '0');
  }, 0);

  const totalTokens = events.reduce((sum, e) => {
    return sum + (e.tokensUsed ?? 0);
  }, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <Link href="/tasks" style={{ color: 'var(--stone-500)' }}>
              <ChevronLeft size={14} strokeWidth={1.5} />
            </Link>
            <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>
              Tasks / {task.project?.name ?? 'Unknown'} / {task.id.slice(0, 8)}
            </p>
          </div>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
            {task.title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full"
            style={{ background: sc.bg, color: sc.fg }}
          >
            {task.status.replace(/_/g, ' ')}
          </span>
          <TaskStatusControls task={task} agents={agents} />
        </div>
      </div>

      {/* Meta row */}
      <div
        className="flex items-center gap-4 px-6 py-2 text-[10px] font-mono border-b"
        style={{ borderColor: 'var(--dark-border)', color: 'var(--stone-500)' }}
      >
        <span>
          Agent:{' '}
          <strong style={{ color: '#ECEAE4' }}>
            {task.assignedAgent?.name ?? 'Unassigned'}
          </strong>
        </span>
        <span>
          Priority:{' '}
          <span
            style={{
              color:
                task.priority === 'urgent'
                  ? '#C4413A'
                  : task.priority === 'high'
                  ? '#F5A623'
                  : task.priority === 'medium'
                  ? '#4A7AB5'
                  : '#8E897B',
            }}
          >
            {task.priority}
          </span>
        </span>
        {totalCost > 0 && (
          <span>
            Cost: <span style={{ color: '#ECEAE4' }}>${totalCost.toFixed(4)}</span>
          </span>
        )}
        {totalTokens > 0 && <span>Tokens: {totalTokens.toLocaleString()}</span>}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Event thread */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-auto p-5">
            {task.status === 'review' && (
              <ReviewPanel
                taskId={task.id}
                documents={taskDocuments}
                approvals={taskApprovals}
                events={events}
                workspacePath={task.project?.workspacePath ?? null}
              />
            )}
            {task.description && (
              <div
                className="mb-4 p-3 rounded-lg text-sm"
                style={{
                  background: 'var(--dark-surface2)',
                  border: '1px solid var(--dark-border)',
                  color: 'var(--stone-400)',
                }}
              >
                {task.description}
              </div>
            )}

            <div className="space-y-0">
              {events.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--stone-600)' }}>
                  No events yet
                </p>
              ) : (
                events.map((event) => {
                  const ei = EVENT_ICONS[event.eventType] ?? { icon: '·', color: '#8E897B' };
                  const payload = event.payload as Record<string, unknown> | null;

                  let content = '';
                  if (event.eventType === 'status_change' && payload) {
                    content = `${payload.from ?? '?'} → ${payload.to ?? '?'}${payload.reason ? ` · ${payload.reason}` : ''}`;
                  } else if (event.eventType === 'message' && payload) {
                    content = String(payload.content ?? '');
                  } else if (event.eventType === 'tool_call' && payload) {
                    content = `${payload.tool_name} → ${JSON.stringify(payload.output ?? '').slice(0, 100)}`;
                  } else if (event.eventType === 'assignment' && payload) {
                    content = `Assigned to ${payload.assigned_to ?? 'unknown'}`;
                  } else if (event.eventType === 'delegation' && payload) {
                    content = `Delegated child task ${payload.subtask_id ?? ''} to ${payload.assigned_to ?? 'unknown'}`;
                  } else if (event.eventType === 'loop_detected' && payload) {
                    content = `Loop detected: "${payload.signature}" repeated ${payload.count} times. Task halted.`;
                  } else if (event.eventType === 'budget_warning' && payload) {
                    content = `Budget at ${parseFloat(String(payload.ratio ?? '0')) * 100 | 0}% — $${parseFloat(String(payload.used_usd ?? '0')).toFixed(4)} / $${parseFloat(String(payload.limit_usd ?? '0')).toFixed(2)}`;
                  } else if (event.eventType === 'budget_exceeded' && payload) {
                    content = `Budget exceeded — $${parseFloat(String(payload.used_usd ?? '0')).toFixed(4)} / $${parseFloat(String(payload.limit_usd ?? '0')).toFixed(2)}. Agent paused.`;
                  } else if (event.eventType === 'model_fallback' && payload) {
                    content = String(
                      payload.reason ??
                        `Falling back to ${payload.fallback_model ?? 'cloud model'} (configured: ${payload.configured_model ?? 'unknown'})`,
                    );
                  } else if (event.eventType === 'verification' && payload) {
                    const gates = Array.isArray(payload.gate_results)
                      ? (payload.gate_results as Array<{ gate: string; status: string }>)
                      : [];
                    const blocking = Array.isArray(payload.blocking_failures)
                      ? payload.blocking_failures.length
                      : 0;
                    const informational = Array.isArray(payload.informational_failures)
                      ? payload.informational_failures.length
                      : 0;
                    content = `Verification ${payload.status === 'pass' ? 'PASSED' : payload.status === 'fail' ? 'FAILED' : 'skipped'} (${payload.policy} policy) — ${gates.map((g) => `${g.gate}: ${g.status}`).join(', ') || 'no gates run'}${blocking > 0 ? ` · ${blocking} blocking failure(s)` : ''}${informational > 0 ? ` · ${informational} informational (pre-existing, out of scope)` : ''}`;
                  } else if (event.eventType === 'review' && payload) {
                    content = `Reviewer ${payload.status === 'pass' ? 'PASSED' : 'requested rework'} — ${String(payload.findings ?? '').slice(0, 400)}`;
                  } else if (event.eventType === 'implementation_audit' && payload) {
                    const files = Array.isArray(payload.changedFiles) ? payload.changedFiles : [];
                    content = `${String(payload.diffSummary ?? '')} Files: ${files.join(', ') || 'none'}`;
                  } else if (event.eventType === 'workflow_route' && payload) {
                    content = `Routed to ${payload.workflow_id ?? 'workflow'}`;
                  } else if (event.eventType === 'mode_selection' && payload) {
                    content = `Mode ${payload.mode}${payload.score != null ? ` (score ${payload.score}/8)` : ''}${payload.effective_tier != null ? ` · effective tier ${payload.effective_tier}` : ''}`;
                  } else if (event.eventType === 'document_added' && payload) {
                    content = `Document '${payload.key}' revision ${payload.revision} attached (${Number(payload.length ?? 0).toLocaleString()} chars)${payload.routes_to_critique_ring ? ' — routes to critique ring' : ''}`;
                  } else if (event.eventType === 'model_escalation' && payload) {
                    content = `Escalated tier ${payload.from_tier} → ${payload.to_tier} after ${payload.failure_count} failure(s)`;
                  } else if (event.eventType === 'repo_map' && payload) {
                    content = String(payload.summary ?? '');
                  } else if (event.eventType === 'scorecard' && payload) {
                    content = `${payload.workflow_id ?? ''} · tier ${payload.tier ?? '?'} · $${Number(payload.totalCostUsd ?? 0).toFixed(4)} · ${payload.verificationFailures ?? 0} verification failure(s) · ${payload.escalationCount ?? 0} escalation(s)`;
                  } else if (event.eventType === 'model_call' && payload && payload.selected_model) {
                    content = `Routed to ${payload.selected_model}${payload.selection_kind ? ` (${String(payload.selection_kind).replace(/_/g, ' ')})` : ''}`;
                  } else if (event.eventType === 'approval_request' && payload) {
                    content = String(payload.description ?? 'Approval requested');
                  } else if (event.eventType === 'approval_response' && payload) {
                    content = `${payload.status === 'approved' ? 'Approved' : 'Rejected'}: ${payload.action_type ?? ''}${payload.reviewer_notes ? ` — ${payload.reviewer_notes}` : ''}`;
                  } else if (payload) {
                    content = JSON.stringify(payload).slice(0, 200);
                  }

                  return (
                    <div key={event.id} className="flex gap-2.5 text-[11px]">
                      <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0">
                        <span style={{ color: ei.color, fontSize: 9 }}>{ei.icon}</span>
                        <div
                          className="w-px flex-1"
                          style={{ background: 'var(--dark-border)', minHeight: 12 }}
                        />
                      </div>
                      <div className="flex-1 pb-3 min-w-0">
                        <div className="flex items-baseline gap-1.5 mb-0.5 flex-wrap">
                          {event.agent?.name && (
                            <span className="font-medium" style={{ color: '#ECEAE4' }}>
                              {event.agent.name}
                            </span>
                          )}
                          <span className="font-mono text-[9px]" style={{ color: 'var(--stone-600)' }}>
                            {new Date(event.createdAt).toLocaleTimeString()}
                          </span>
                          <span
                            className="font-mono text-[9px] px-1 py-0.5 rounded"
                            style={{
                              background: ei.color + '20',
                              color: ei.color,
                            }}
                          >
                            {event.eventType.replace(/_/g, ' ')}
                          </span>
                          {event.costUsd && parseFloat(event.costUsd) > 0 && (
                            <span className="font-mono text-[9px]" style={{ color: 'var(--stone-600)' }}>
                              ${parseFloat(event.costUsd).toFixed(6)}
                            </span>
                          )}
                        </div>
                        {content && (
                          <p
                            className="leading-relaxed break-words"
                            style={{ color: 'var(--stone-400)' }}
                          >
                            {content}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Message input */}
          <TaskMessageInput taskId={task.id} />
        </div>

        {/* Right sidebar */}
        <div
          className="w-52 shrink-0 p-4 space-y-5 border-l overflow-auto"
          style={{ borderColor: 'var(--dark-border)', background: 'var(--dark-surface2)' }}
        >
          {/* Goal ancestry */}
          <div>
            <p
              className="text-[9px] font-mono uppercase tracking-wider mb-2"
              style={{ color: 'var(--stone-500)' }}
            >
              Goal ancestry
            </p>
            <div className="text-[10px] space-y-1" style={{ color: 'var(--stone-500)' }}>
              {task.project && (
                <Link
                  href={`/projects/${task.project.id}`}
                  className="block font-medium"
                  style={{ color: '#ECEAE4' }}
                >
                  {task.project.name}
                </Link>
              )}
              {task.parentTask && (
                <Link
                  href={`/tasks/${task.parentTask.id}`}
                  className="block pl-2 border-l text-[10px]"
                  style={{ borderColor: 'var(--dark-border)', color: 'var(--stone-400)' }}
                >
                  {task.parentTask.title}
                </Link>
              )}
              <p
                className="pl-4 border-l text-[10px]"
                style={{ borderColor: '#F5A62340', color: '#F5A623' }}
              >
                {task.title}
              </p>
            </div>
          </div>

          {/* Subtasks */}
          {subtasks.length > 0 && (
            <div>
              <p
                className="text-[9px] font-mono uppercase tracking-wider mb-2"
                style={{ color: 'var(--stone-500)' }}
              >
                Subtasks
              </p>
              <div className="space-y-1">
                {subtasks.map((sub) => {
                  const subSc = STATUS_COLORS[sub.status] ?? STATUS_COLORS.backlog;
                  return (
                    <Link key={sub.id} href={`/tasks/${sub.id}`} className="flex items-center gap-1.5 group">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: subSc.fg }}
                      />
                      <span
                        className="text-[10px] group-hover:underline"
                        style={{ color: 'var(--stone-400)' }}
                      >
                        {sub.title}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Documents */}
          <div>
            <p
              className="text-[9px] font-mono uppercase tracking-wider mb-2"
              style={{ color: 'var(--stone-500)' }}
            >
              Documents
            </p>
            {taskDocuments.length > 0 && (
              <div className="space-y-1 mb-2">
                {taskDocuments.map((doc) => (
                  <Link
                    key={doc.key}
                    href={`/tasks/${task.id}/documents/${doc.key}`}
                    className="flex items-center gap-1.5 group"
                  >
                    <span className="text-[10px] font-mono group-hover:underline" style={{ color: '#F5A623' }}>
                      {doc.key}
                    </span>
                    <span className="text-[9px] font-mono" style={{ color: 'var(--stone-600)' }}>
                      rev {doc.latestRevision}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <AttachDocument taskId={task.id} />
          </div>

          {/* Pending approvals */}
          <ApprovalPanel approvals={taskApprovals} taskId={task.id} />

          {/* Assigned agent */}
          <div>
            <p
              className="text-[9px] font-mono uppercase tracking-wider mb-2"
              style={{ color: 'var(--stone-500)' }}
            >
              Assigned Agent
            </p>
            {task.assignedAgent ? (
              <Link
                href={`/agents/${task.assignedAgent.id}`}
                className="text-[10px] font-medium"
                style={{ color: '#F5A623' }}
              >
                {task.assignedAgent.name}
              </Link>
            ) : (
              <p className="text-[10px]" style={{ color: 'var(--stone-600)' }}>
                Unassigned
              </p>
            )}
          </div>

          {/* Cost breakdown */}
          <div>
            <p
              className="text-[9px] font-mono uppercase tracking-wider mb-2"
              style={{ color: 'var(--stone-500)' }}
            >
              Cost breakdown
            </p>
            <div
              className="text-[10px] font-mono space-y-0.5"
              style={{ color: 'var(--stone-500)' }}
            >
              <div className="flex justify-between">
                <span>Events</span>
                <span>{events.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Tokens</span>
                <span>{totalTokens.toLocaleString()}</span>
              </div>
              <div
                className="flex justify-between border-t pt-0.5"
                style={{ borderColor: 'var(--dark-border)', color: '#ECEAE4' }}
              >
                <span>Total</span>
                <span>${totalCost.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* Timestamps */}
          <div>
            <p
              className="text-[9px] font-mono uppercase tracking-wider mb-2"
              style={{ color: 'var(--stone-500)' }}
            >
              Timestamps
            </p>
            <div className="text-[9px] font-mono space-y-0.5" style={{ color: 'var(--stone-600)' }}>
              <div>
                <span>Created </span>
                <span>{new Date(task.createdAt).toLocaleDateString()}</span>
              </div>
              <div>
                <span>Updated </span>
                <span>{new Date(task.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
