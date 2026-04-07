'use client';

import { useState, useTransition } from 'react';
import { Edit2, Pause, Play, Trash2, X } from 'lucide-react';
import { updateAgent, pauseAgent, activateAgent, deleteAgent } from '@/lib/actions/agents';
import { useRouter } from 'next/navigation';
import type { ModelConfig, Project, Agent } from '@/lib/db/schema';

interface Props {
  agent: Agent & { modelConfig?: ModelConfig | null; project?: Project | null };
  modelConfigs: ModelConfig[];
  projects: Project[];
  allAgents: Agent[];
}

export function AgentDetailClient({ agent, modelConfigs, projects, allAgents }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    const budgetVal = data.get('budgetMonthlyUsd') as string;
    const maxIter = data.get('maxIterations') as string;

    setError(null);
    startTransition(async () => {
      const result = await updateAgent({
        id: agent.id,
        name: data.get('name') as string,
        role: data.get('role') as string,
        systemPrompt: (data.get('systemPrompt') as string) || undefined,
        modelConfigId: (data.get('modelConfigId') as string) || undefined,
        projectId: (data.get('projectId') as string) || undefined,
        parentId: (data.get('parentId') as string) || undefined,
        budgetMonthlyUsd: budgetVal || undefined,
        heartbeatCron: (data.get('heartbeatCron') as string) || undefined,
        maxIterations: maxIter ? parseInt(maxIter) : undefined,
      });

      if (result.success) {
        setEditOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handlePause() {
    startTransition(async () => {
      if (agent.status === 'paused') {
        await activateAgent(agent.id);
      } else {
        await pauseAgent(agent.id);
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteAgent(agent.id);
      router.push('/agents');
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full"
          style={{
            background:
              agent.status === 'active'
                ? '#3D8B5C20'
                : agent.status === 'budget_exceeded'
                ? '#C4413A20'
                : '#6B665A20',
            color:
              agent.status === 'active'
                ? '#3D8B5C'
                : agent.status === 'budget_exceeded'
                ? '#C4413A'
                : '#8E897B',
          }}
        >
          {agent.status.replace(/_/g, ' ')}
        </span>
        <button
          onClick={handlePause}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono"
          style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
        >
          {agent.status === 'paused' ? (
            <Play size={12} strokeWidth={1.5} />
          ) : (
            <Pause size={12} strokeWidth={1.5} />
          )}
          {agent.status === 'paused' ? 'Activate' : 'Pause'}
        </button>
        <button
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono"
          style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
        >
          <Edit2 size={12} strokeWidth={1.5} />
          Edit
        </button>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono"
          style={{ background: '#C4413A20', color: '#C4413A' }}
        >
          <Trash2 size={12} strokeWidth={1.5} />
          Delete
        </button>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setEditOpen(false)}
          />
          <div
            className="relative rounded-xl w-full max-w-lg p-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
                Edit Agent
              </h2>
              <button onClick={() => setEditOpen(false)} style={{ color: 'var(--stone-500)' }}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Name *
                  </label>
                  <input
                    name="name"
                    required
                    defaultValue={agent.name}
                    className="w-full px-3 py-2 rounded-md text-sm outline-none"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Role *
                  </label>
                  <input
                    name="role"
                    required
                    defaultValue={agent.role}
                    className="w-full px-3 py-2 rounded-md text-sm outline-none"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                  System Prompt
                </label>
                <textarea
                  name="systemPrompt"
                  rows={4}
                  defaultValue={agent.systemPrompt ?? ''}
                  className="w-full px-3 py-2 rounded-md text-sm outline-none resize-none font-mono"
                  style={{
                    background: 'var(--dark-surface2)',
                    border: '1px solid var(--dark-border)',
                    color: '#ECEAE4',
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Model
                  </label>
                  <select
                    name="modelConfigId"
                    defaultValue={agent.modelConfigId ?? ''}
                    className="w-full px-3 py-2 rounded-md text-sm outline-none"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  >
                    <option value="">No model</option>
                    {modelConfigs.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Project
                  </label>
                  <select
                    name="projectId"
                    defaultValue={agent.projectId ?? ''}
                    className="w-full px-3 py-2 rounded-md text-sm outline-none"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  >
                    <option value="">Global (no project)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                  Parent Agent
                </label>
                <select
                  name="parentId"
                  defaultValue={agent.parentId ?? ''}
                  className="w-full px-3 py-2 rounded-md text-sm outline-none"
                  style={{
                    background: 'var(--dark-surface2)',
                    border: '1px solid var(--dark-border)',
                    color: '#ECEAE4',
                  }}
                >
                  <option value="">None (top-level)</option>
                  {allAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Budget (USD/mo)
                  </label>
                  <input
                    name="budgetMonthlyUsd"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={agent.budgetMonthlyUsd ?? ''}
                    className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Heartbeat Cron
                  </label>
                  <input
                    name="heartbeatCron"
                    defaultValue={agent.heartbeatCron ?? ''}
                    className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Max Iterations
                  </label>
                  <input
                    name="maxIterations"
                    type="number"
                    min="1"
                    max="100"
                    defaultValue={agent.maxIterations}
                    className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs" style={{ color: '#C4413A' }}>
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="px-4 py-2 rounded-md text-sm font-mono"
                  style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 rounded-md text-sm font-mono font-medium"
                  style={{ background: '#F5A623', color: '#fff', opacity: isPending ? 0.7 : 1 }}
                >
                  {isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
