import { listAgents } from '@/lib/actions/agents';
import { listModelConfigs } from '@/lib/actions/model-configs';
import { listProjects } from '@/lib/actions/projects';
import Link from 'next/link';
import { Bot } from 'lucide-react';
import { CreateAgentDialog } from './create-agent-dialog';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const [allAgents, modelConfigs, projects] = await Promise.all([
    listAgents(),
    listModelConfigs(),
    listProjects(),
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>
            Agent Registry
          </p>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
            Agents
          </h1>
        </div>
        <CreateAgentDialog modelConfigs={modelConfigs} projects={projects} agents={allAgents} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {allAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot
              size={40}
              strokeWidth={1}
              className="mx-auto mb-4"
              style={{ color: 'var(--stone-600)' }}
            />
            <h2 className="text-sm font-medium mb-1" style={{ color: '#ECEAE4' }}>
              No agents configured
            </h2>
            <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
              Define agents with roles, models, and heartbeat schedules.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-w-5xl">
            {allAgents.map((agent) => {
              const budgetUsed = parseFloat(agent.budgetUsedUsd ?? '0');
              const budgetTotal = parseFloat(agent.budgetMonthlyUsd ?? '0');
              const budgetPct = budgetTotal > 0 ? budgetUsed / budgetTotal : 0;
              const isBudgetExceeded = agent.status === 'budget_exceeded';
              const isBudgetWarning = budgetPct >= 0.8 && budgetPct < 1.0;

              return (
                <Link key={agent.id} href={`/agents/${agent.id}`} className="block">
                  <div
                    className="rounded-lg p-4 cursor-pointer hover:border-amber-400/30 transition-colors"
                    style={{
                      background: 'var(--dark-surface)',
                      border: `1px solid ${isBudgetExceeded ? '#C4413A40' : isBudgetWarning ? '#C27D1A40' : 'var(--dark-border)'}`,
                      opacity: isBudgetExceeded ? 0.7 : 1,
                    }}
                  >
                    {/* Agent header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ background: '#F5A62320', color: '#F5A623' }}
                        >
                          {agent.name
                            .split(' ')
                            .map((w) => w[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: '#ECEAE4' }}>
                            {agent.name}
                          </p>
                          <p className="text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
                            {agent.role}
                          </p>
                        </div>
                      </div>
                      <AgentStatusBadge status={agent.status} />
                    </div>

                    {/* Meta */}
                    <div
                      className="text-[10px] font-mono space-y-1 mb-3"
                      style={{ color: 'var(--stone-500)' }}
                    >
                      <div className="flex justify-between">
                        <span>Model</span>
                        <span style={{ color: 'var(--stone-400)' }}>
                          {agent.modelConfig?.name ?? '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Schedule</span>
                        <span style={{ color: 'var(--stone-400)' }}>
                          {agent.heartbeatCron ?? '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Project</span>
                        <span style={{ color: 'var(--stone-400)' }}>
                          {agent.project?.name ?? 'Global'}
                        </span>
                      </div>
                    </div>

                    {/* Budget bar */}
                    {budgetTotal > 0 && (
                      <BudgetBar used={budgetUsed} total={budgetTotal} />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentStatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#3D8B5C20', fg: '#3D8B5C' },
    paused: { bg: '#6B665A20', fg: '#8E897B' },
    budget_exceeded: { bg: '#C4413A20', fg: '#C4413A' },
  };
  const c = colors[status] ?? { bg: '#6B665A20', fg: '#8E897B' };
  return (
    <span
      className="text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0"
      style={{ background: c.bg, color: c.fg }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function BudgetBar({ used, total }: { used: number; total: number }) {
  const pct = Math.min((used / total) * 100, 100);
  const isWarning = pct >= 80 && pct < 100;
  const isExceeded = pct >= 100;
  const barColor = isExceeded ? '#C4413A' : isWarning ? '#C27D1A' : '#F5A623';

  return (
    <div>
      <div
        className="flex justify-between text-[9px] font-mono mb-0.5"
        style={{ color: 'var(--stone-500)' }}
      >
        <div className="flex items-center gap-1">
          <span>Budget</span>
          {isWarning && (
            <span
              className="text-[8px] font-mono px-1 py-0.5 rounded"
              style={{ background: '#C27D1A20', color: '#C27D1A' }}
            >
              80%+
            </span>
          )}
          {isExceeded && (
            <span
              className="text-[8px] font-mono px-1 py-0.5 rounded"
              style={{ background: '#C4413A20', color: '#C4413A' }}
            >
              EXCEEDED
            </span>
          )}
        </div>
        <span>
          ${used.toFixed(2)} / ${total.toFixed(2)}
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--dark-border)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}
