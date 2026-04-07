export const dynamic = 'force-dynamic';

import { Clock, RefreshCw } from 'lucide-react';
import { listAgents } from '@/lib/actions/agents';
import { db } from '@/lib/db';
import { heartbeats } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { RunNowButton } from './run-now-button';

function parseCronNext(cron: string | null): string {
  if (!cron) return '—';
  // Simple human hint — in production, use a cron parser library
  return 'Scheduled';
}

function formatTime(date: Date | null | undefined): string {
  if (!date) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default async function SchedulerPage() {
  const [agents, recentHeartbeats] = await Promise.all([
    listAgents(),
    db.query.heartbeats.findMany({
      orderBy: [desc(heartbeats.startedAt)],
      limit: 20,
      with: { agent: true },
    }),
  ]);

  const scheduledAgents = agents.filter((a) => a.heartbeatCron);
  const unscheduledAgents = agents.filter((a) => !a.heartbeatCron);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>Scheduler</p>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4', fontFamily: 'Syne, system-ui' }}>
            Heartbeat Scheduler
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <RefreshCw size={14} strokeWidth={1.5} style={{ color: 'var(--stone-500)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>
            {scheduledAgents.length} scheduled
          </span>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-auto space-y-6">
        {/* Agent schedule table */}
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock size={40} strokeWidth={1} className="mx-auto mb-4" style={{ color: 'var(--stone-600)' }} />
            <h2 className="text-sm font-medium mb-1" style={{ color: '#ECEAE4' }}>
              No agents yet
            </h2>
            <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
              Create agents with cron expressions to schedule heartbeats.
            </p>
          </div>
        ) : (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--dark-border)' }}>
            {/* Table header */}
            <div
              className="grid gap-2 px-4 py-2 text-[9px] font-mono uppercase tracking-wider"
              style={{
                background: 'var(--dark-surface2)',
                color: 'var(--stone-500)',
                gridTemplateColumns: '1fr 1fr 1fr 1fr auto auto',
              }}
            >
              <span>Agent</span>
              <span>Schedule</span>
              <span>Next Run</span>
              <span>Status</span>
              <span>Enabled</span>
              <span></span>
            </div>

            {/* Scheduled agents */}
            {scheduledAgents.map((agent) => {
              const statusBg =
                agent.status === 'active' ? '#3D8B5C20' :
                agent.status === 'budget_exceeded' ? '#C4413A20' :
                '#6B665A20';
              const statusFg =
                agent.status === 'active' ? '#3D8B5C' :
                agent.status === 'budget_exceeded' ? '#C4413A' :
                '#8E897B';

              return (
                <div
                  key={agent.id}
                  className="grid gap-2 items-center px-4 py-2 text-[10px] font-mono border-t"
                  style={{
                    borderColor: 'var(--dark-border)',
                    color: 'var(--stone-500)',
                    gridTemplateColumns: '1fr 1fr 1fr 1fr auto auto',
                  }}
                >
                  <span style={{ color: '#ECEAE4' }}>{agent.name}</span>
                  <span className="font-mono">{agent.heartbeatCron}</span>
                  <span>{agent.heartbeatEnabled ? parseCronNext(agent.heartbeatCron) : '—'}</span>
                  <span>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: statusBg, color: statusFg }}
                    >
                      {agent.status.replace(/_/g, ' ')}
                    </span>
                  </span>
                  <span>
                    <div
                      className="w-7 h-4 rounded-full relative"
                      style={{ background: agent.heartbeatEnabled ? '#F5A623' : 'var(--dark-surface2)' }}
                    >
                      <div
                        className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                        style={{ left: agent.heartbeatEnabled ? 14 : 2 }}
                      />
                    </div>
                  </span>
                  <span>
                    <RunNowButton agentId={agent.id} agentName={agent.name} />
                  </span>
                </div>
              );
            })}

            {/* Unscheduled agents */}
            {unscheduledAgents.map((agent) => (
              <div
                key={agent.id}
                className="grid gap-2 items-center px-4 py-2 text-[10px] font-mono border-t opacity-50"
                style={{
                  borderColor: 'var(--dark-border)',
                  color: 'var(--stone-600)',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr auto auto',
                }}
              >
                <span>{agent.name}</span>
                <span>—</span>
                <span>—</span>
                <span>
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: '#6B665A20', color: '#8E897B' }}
                  >
                    no schedule
                  </span>
                </span>
                <span>
                  <div className="w-7 h-4 rounded-full relative" style={{ background: 'var(--dark-surface2)' }}>
                    <div className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white" />
                  </div>
                </span>
                <span>
                  <RunNowButton agentId={agent.id} agentName={agent.name} />
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recent heartbeats */}
        <div>
          <p
            className="text-[10px] font-mono uppercase tracking-wider mb-2"
            style={{ color: 'var(--stone-500)' }}
          >
            Recent heartbeats
          </p>

          {recentHeartbeats.length === 0 ? (
            <div
              className="rounded-lg px-4 py-6 text-center text-xs"
              style={{ background: 'var(--dark-surface2)', border: '1px solid var(--dark-border)', color: 'var(--stone-600)' }}
            >
              No heartbeats recorded yet. Click &ldquo;Run Now&rdquo; to trigger one.
            </div>
          ) : (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--dark-border)' }}>
              {recentHeartbeats.map((hb, i) => {
                const dur = hb.completedAt
                  ? ((new Date(hb.completedAt).getTime() - new Date(hb.startedAt).getTime()) / 1000).toFixed(1) + 's'
                  : 'running…';
                const statusBg = hb.status === 'completed' ? '#3D8B5C20' : '#C4413A20';
                const statusFg = hb.status === 'completed' ? '#3D8B5C' : '#C4413A';

                return (
                  <div
                    key={hb.id}
                    className="flex items-center gap-4 px-4 py-1.5 text-[10px] font-mono border-t"
                    style={{
                      borderColor: i === 0 ? 'transparent' : 'var(--dark-border)',
                      color: 'var(--stone-500)',
                    }}
                  >
                    <span className="font-mono" style={{ color: '#ECEAE4' }}>
                      {formatTime(hb.startedAt)}
                    </span>
                    <span>{(hb as { agent?: { name?: string } }).agent?.name ?? '—'}</span>
                    <span>{hb.tasksProcessed} tasks</span>
                    <span>${parseFloat(hb.costUsd ?? '0').toFixed(4)}</span>
                    <span>{hb.tokensUsed.toLocaleString()} tok</span>
                    <span>{dur}</span>
                    <span className="ml-auto">
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: statusBg, color: statusFg }}
                      >
                        {hb.status}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
