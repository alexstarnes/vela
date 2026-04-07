'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { createProject } from '@/lib/actions/projects';
import { useRouter } from 'next/navigation';

export function CreateProjectDialog() {
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
      const result = await createProject({
        name: data.get('name') as string,
        goal: (data.get('goal') as string) || undefined,
        context: (data.get('context') as string) || undefined,
      });

      if (result.success) {
        setOpen(false);
        form.reset();
        router.push(`/projects/${result.data.id}`);
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
        New Project
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setOpen(false)}
          />

          {/* Dialog */}
          <div
            className="relative rounded-xl w-full max-w-md p-6 shadow-2xl"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
                New Project
              </h2>
              <button onClick={() => setOpen(false)} style={{ color: 'var(--stone-500)' }}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                  Name *
                </label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Vela Core"
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
                  Goal
                </label>
                <input
                  name="goal"
                  placeholder="What is this project trying to achieve?"
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
                  Context
                </label>
                <textarea
                  name="context"
                  rows={3}
                  placeholder="Additional context injected into agent prompts..."
                  className="w-full px-3 py-2 rounded-md text-sm outline-none resize-none"
                  style={{
                    background: 'var(--dark-surface2)',
                    border: '1px solid var(--dark-border)',
                    color: '#ECEAE4',
                  }}
                />
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
                  {isPending ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
