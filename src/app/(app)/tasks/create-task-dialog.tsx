'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { createTask } from '@/lib/actions/tasks';
import { useRouter } from 'next/navigation';
import type { Project, Agent } from '@/lib/db/schema';

interface Props {
  projects: Project[];
  agents: Agent[];
}

export function CreateTaskDialog({ projects, agents }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    setError(null);
    startTransition(async () => {
      const result = await createTask({
        title: data.get('title') as string,
        description: (data.get('description') as string) || undefined,
        projectId: data.get('projectId') as string,
        assignedAgentId: (data.get('assignedAgentId') as string) || undefined,
        priority: (data.get('priority') as 'low' | 'medium' | 'high' | 'urgent') || 'medium',
      });

      if (result.success) {
        setOpen(false);
        form.reset();
        router.push(`/tasks/${result.data.id}`);
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
        New Task
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setOpen(false)}
          />
          <div
            className="relative rounded-xl w-full max-w-md p-6 shadow-2xl"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
                New Task
              </h2>
              <button onClick={() => setOpen(false)} style={{ color: 'var(--stone-500)' }}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                  Title *
                </label>
                <input
                  name="title"
                  required
                  placeholder="e.g. Implement heartbeat loop"
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
                  Description
                </label>
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Task description..."
                  className="w-full px-3 py-2 rounded-md text-sm outline-none resize-none"
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
                    Project *
                  </label>
                  <select
                    name="projectId"
                    required
                    className="w-full px-3 py-2 rounded-md text-sm outline-none"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  >
                    <option value="">Select project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Priority
                  </label>
                  <select
                    name="priority"
                    defaultValue="medium"
                    className="w-full px-3 py-2 rounded-md text-sm outline-none"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: '#ECEAE4',
                    }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                  Assign Agent (optional)
                </label>
                <select
                  name="assignedAgentId"
                  className="w-full px-3 py-2 rounded-md text-sm outline-none"
                  style={{
                    background: 'var(--dark-surface2)',
                    border: '1px solid var(--dark-border)',
                    color: '#ECEAE4',
                  }}
                >
                  <option value="">Auto-assign</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.role})
                    </option>
                  ))}
                </select>
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
                  {isPending ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
