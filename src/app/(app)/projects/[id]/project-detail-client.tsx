'use client';

import { useState, useTransition } from 'react';
import { Edit2, Archive, X } from 'lucide-react';
import { updateProject, archiveProject } from '@/lib/actions/projects';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/db/schema';

export function ProjectDetailClient({ project }: { project: Project }) {
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    setError(null);
    startTransition(async () => {
      const result = await updateProject({
        id: project.id,
        name: data.get('name') as string,
        goal: (data.get('goal') as string) || undefined,
        context: (data.get('context') as string) || undefined,
      });

      if (result.success) {
        setEditOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleArchive() {
    if (!confirm('Archive this project? It will be hidden from the active list.')) return;
    startTransition(async () => {
      await archiveProject(project.id);
      router.push('/projects');
    });
  }

  return (
    <>
      <button
        onClick={() => setEditOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono"
        style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
      >
        <Edit2 size={12} strokeWidth={1.5} />
        Edit
      </button>
      {project.status === 'active' && (
        <button
          onClick={handleArchive}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono"
          style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
        >
          <Archive size={12} strokeWidth={1.5} />
          Archive
        </button>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setEditOpen(false)}
          />
          <div
            className="relative rounded-xl w-full max-w-md p-6 shadow-2xl"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
                Edit Project
              </h2>
              <button onClick={() => setEditOpen(false)} style={{ color: 'var(--stone-500)' }}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                  Name *
                </label>
                <input
                  name="name"
                  required
                  defaultValue={project.name}
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
                  defaultValue={project.goal ?? ''}
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
                  defaultValue={project.context ?? ''}
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
