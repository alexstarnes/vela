export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getAgent } from '@/lib/actions/agents';
import { listModelConfigs } from '@/lib/actions/model-configs';
import { listProjects } from '@/lib/actions/projects';
import { listAgents } from '@/lib/actions/agents';
import { db } from '@/lib/db';
import { heartbeats } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { AgentDetailClient } from './agent-detail-client';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [agent, modelConfigs, projects, allAgents, recentHeartbeats] = await Promise.all([
    getAgent(id),
    listModelConfigs(),
    listProjects(),
    listAgents(),
    db.query.heartbeats.findMany({
      where: eq(heartbeats.agentId, id),
      orderBy: (h, { desc }) => [desc(h.startedAt)],
      limit: 10,
    }),
  ]);

  if (!agent) notFound();

  const budgetUsed = parseFloat(agent.budgetUsedUsd ?? '0');
  const budgetTotal = parseFloat(agent.budgetMonthlyUsd ?? '0');
  const budgetPct = budgetTotal > 0 ? Math.min((budgetUsed / budgetTotal) * 100, 100) : 0;
  const barColor = budgetPct > 80 ? '#C4413A' : budgetPct > 60 ? '#C27D1A' : '#F5A623';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <Link href="/agents" style={{ color: 'var(--stone-500)' }}>
              <ChevronLeft size={14} strokeWidth={1.5} />
            </Link>
            <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>
              Agents / {agent.name}
            </p>
          </div>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
            {agent.name}
          </h1>
        </div>
        <AgentDetailClient
          agent={agent}
          modelConfigs={modelConfigs}
          projects={projects}
          allAgents={allAgents.filter((a) => a.id !== id)}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Config grid */}
        <div
          className="rounded-lg p-4"
          style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
        >
          <p
            className="text-[10px] font-mono uppercase tracking-wider mb-3"
            style={{ color: 'var(--stone-500)' }}
          >
            Configuration
          </p>
          <div className="grid grid-cols-2 gap-4">
            {[
              ['Role', agent.role],
              ['Model', agent.modelConfig?.name ?? '—'],
              ['Schedule', agent.heartbeatCron ?? '—'],
              ['Max Iterations', String(agent.maxIterations)],
              ['Project', agent.project?.name ?? 'Global'],
              ['Status', agent.status],
            ].map(([label, value]) => (
              <div key={label}>
                <p
                  className="text-[9px] font-mono uppercase tracking-wider mb-0.5"
                  style={{ color: 'var(--stone-500)' }}
                >
                  {label}
                </p>
                <p className="text-sm font-mono" style={{ color: '#ECEAE4' }}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* System prompt */}
        {agent.systemPrompt && (
          <div
            className="rounded-lg p-4"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <p
              className="text-[10px] font-mono uppercase tracking-wider mb-2"
              style={{ color: 'var(--stone-500)' }}
            >
              System Prompt
            </p>
            <pre
              className="text-xs leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--stone-400)', fontFamily: 'monospace' }}
            >
              {agent.systemPrompt}
            </pre>
          </div>
        )}

        {/* Budget */}
        {budgetTotal > 0 && (
          <div
            className="rounded-lg p-4"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <p
              className="text-[10px] font-mono uppercase tracking-wider mb-3"
              style={{ color: 'var(--stone-500)' }}
            >
              Budget
            </p>
            <div
              className="flex justify-between text-[9px] font-mono mb-1"
              style={{ color: 'var(--stone-500)' }}
            >
              <span>Budget</span>
              <span>
                ${budgetUsed.toFixed(2)} / ${budgetTotal.toFixed(2)}
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden mb-1"
              style={{ background: 'var(--dark-border)' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${budgetPct}%`, background: barColor }}
              />
            </div>
            <p className="text-[9px] font-mono" style={{ color: 'var(--stone-500)' }}>
              {budgetPct.toFixed(0)}% used · Resets{' '}
              {agent.budgetResetAt
                ? new Date(agent.budgetResetAt).toLocaleDateString()
                : 'monthly'}
            </p>
          </div>
        )}

        {/* Heartbeat history */}
        {recentHeartbeats.length > 0 && (
          <div>
            <p
              className="text-[10px] font-mono uppercase tracking-wider mb-2"
              style={{ color: 'var(--stone-500)' }}
            >
              Recent Heartbeats
            </p>
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--dark-border)' }}
            >
              <div
                className="grid grid-cols-5 gap-2 px-4 py-2 text-[9px] font-mono uppercase tracking-wider"
                style={{ background: 'var(--dark-surface2)', color: 'var(--stone-500)' }}
              >
                <span>Time</span>
                <span>Tasks</span>
                <span>Tokens</span>
                <span>Cost</span>
                <span>Status</span>
              </div>
              {recentHeartbeats.map((h) => (
                <div
                  key={h.id}
                  className="grid grid-cols-5 gap-2 items-center px-4 py-2 text-[10px] font-mono border-t"
                  style={{ borderColor: 'var(--dark-border)', color: 'var(--stone-400)' }}
                >
                  <span style={{ color: '#ECEAE4' }}>
                    {new Date(h.startedAt).toLocaleTimeString()}
                  </span>
                  <span>{h.tasksProcessed}</span>
                  <span>{h.tokensUsed.toLocaleString()}</span>
                  <span>${parseFloat(h.costUsd ?? '0').toFixed(4)}</span>
                  <span
                    className="px-1.5 py-0.5 rounded inline-block"
                    style={{
                      background: h.status === 'completed' ? '#3D8B5C20' : '#C4413A20',
                      color: h.status === 'completed' ? '#3D8B5C' : '#C4413A',
                    }}
                  >
                    {h.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
