'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { createAgent } from '@/lib/actions/agents';
import { useRouter } from 'next/navigation';
import type { ModelConfig, Project, Agent } from '@/lib/db/schema';

interface Props {
  modelConfigs: ModelConfig[];
  projects: Project[];
  agents: Agent[];
}

export function CreateAgentDialog({ modelConfigs, projects, agents }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    const budgetVal = data.get('budgetMonthlyUsd') as string;
    const maxIter = data.get('maxIterations') as string;

    setError(null);
    startTransition(async () => {
      const result = await createAgent({
        name: data.get('name') as string,
        role: data.get('role') as string,
        systemPrompt: (data.get('systemPrompt') as string) || undefined,
        modelConfigId: (data.get('modelConfigId') as string) || undefined,
        projectId: (data.get('projectId') as string) || undefined,
        parentId: (data.get('parentId') as string) || undefined,
        budgetMonthlyUsd: budgetVal || undefined,
        heartbeatCron: (data.get('heartbeatCron') as string) || undefined,
        heartbeatEnabled: true,
        maxIterations: maxIter ? parseInt(maxIter) : 10,
      });

      if (result.success) {
        setOpen(false);
        form.reset();
        router.push(`/agents/${result.data.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium"
        style={{ background: '#F5A623', color: '#fff' }}
      >
        <Plus size={14} strokeWidth={2} />
        New Agent
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setOpen(false)}
          />
          <div
            className="relative rounded-xl w-full max-w-lg p-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
                New Agent
              </h2>
              <button onClick={() => setOpen(false)} style={{ color: 'var(--stone-500)' }}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Name *
                  </label>
                  <input
                    name="name"
                    required
                    placeholder="e.g. Lead Engineer"
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
                    placeholder="e.g. engineer"
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
                  placeholder="You are a..."
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
                  className="w-full px-3 py-2 rounded-md text-sm outline-none"
                  style={{
                    background: 'var(--dark-surface2)',
                    border: '1px solid var(--dark-border)',
                    color: '#ECEAE4',
                  }}
                >
                  <option value="">None (top-level)</option>
                  {agents.map((a) => (
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
                    placeholder="50.00"
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
                    placeholder="*/15 * * * *"
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
                    defaultValue="10"
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
                  onClick={() => setOpen(false)}
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
                  {isPending ? 'Creating...' : 'Create Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
