'use client';

import { useState, useTransition } from 'react';
import { Plus, X, Trash2 } from 'lucide-react';
import { createSkill, updateSkill, deleteSkill } from '@/lib/actions/skills';
import { useRouter } from 'next/navigation';
import type { Skill, Project } from '@/lib/db/schema';

interface Props {
  globalSkills: Skill[];
  projectSkills: Skill[];
  projects: Project[];
}

// Very simple markdown-to-HTML renderer for preview
function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 style="font-weight:600;margin:8px 0 4px;color:#ECEAE4">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-weight:700;margin:12px 0 6px;font-size:0.875rem;color:#ECEAE4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-weight:700;margin:0 0 8px;font-size:1rem;color:#ECEAE4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#ECEAE4">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="font-family:monospace;background:rgba(255,255,255,0.07);padding:1px 4px;border-radius:3px">$1</code>')
    .replace(/\n/g, '<br/>');
}

export function SkillsClient({ globalSkills, projectSkills, projects }: Props) {
  const [selected, setSelected] = useState<Skill | null>(
    globalSkills[0] ?? projectSkills[0] ?? null
  );
  const [editContent, setEditContent] = useState(selected?.contentMd ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function selectSkill(skill: Skill) {
    setSelected(skill);
    setEditContent(skill.contentMd ?? '');
  }

  function handleSave() {
    if (!selected) return;
    startTransition(async () => {
      const result = await updateSkill({ id: selected.id, contentMd: editContent });
      if (!result.success) {
        alert(`Save failed: ${result.error}`);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(skillId: string) {
    if (!confirm('Delete this skill? This cannot be undone.')) return;
    startTransition(async () => {
      await deleteSkill(skillId);
      if (selected?.id === skillId) {
        setSelected(null);
        setEditContent('');
      }
      router.refresh();
    });
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    setCreateError(null);
    startTransition(async () => {
      const result = await createSkill({
        name: data.get('name') as string,
        scope: data.get('scope') as 'global' | 'project',
        projectId: (data.get('projectId') as string) || undefined,
        contentMd: '',
      });

      if (result.success) {
        setCreateOpen(false);
        form.reset();
        router.refresh();
      } else {
        setCreateError(result.error);
      }
    });
  }

  const allSkills = [...globalSkills, ...projectSkills];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
            Skills
          </h1>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium"
          style={{ background: '#F5A623', color: '#fff' }}
        >
          <Plus size={14} strokeWidth={2} />
          New Skill
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Skill list */}
        <div
          className="w-52 shrink-0 border-r p-3 overflow-auto"
          style={{ borderColor: 'var(--dark-border)' }}
        >
          {globalSkills.length > 0 && (
            <>
              <p
                className="text-[9px] font-mono uppercase tracking-wider mb-2 px-1"
                style={{ color: 'var(--stone-500)' }}
              >
                Global
              </p>
              {globalSkills.map((s) => (
                <div
                  key={s.id}
                  className="group flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] mb-0.5 cursor-pointer"
                  style={{
                    background: selected?.id === s.id ? '#F5A62315' : 'transparent',
                    color: selected?.id === s.id ? '#F5A623' : 'var(--stone-400)',
                    border: selected?.id === s.id ? '1px solid #F5A62330' : '1px solid transparent',
                  }}
                  onClick={() => selectSkill(s)}
                >
                  <span className="truncate">{s.name}.md</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: '#C4413A' }}
                  >
                    <Trash2 size={10} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </>
          )}

          {projectSkills.length > 0 && (
            <>
              <p
                className="text-[9px] font-mono uppercase tracking-wider mb-2 mt-4 px-1"
                style={{ color: 'var(--stone-500)' }}
              >
                Project
              </p>
              {projectSkills.map((s) => (
                <div
                  key={s.id}
                  className="group flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] mb-0.5 cursor-pointer"
                  style={{
                    background: selected?.id === s.id ? '#F5A62315' : 'transparent',
                    color: selected?.id === s.id ? '#F5A623' : 'var(--stone-400)',
                    border: selected?.id === s.id ? '1px solid #F5A62330' : '1px solid transparent',
                  }}
                  onClick={() => selectSkill(s)}
                >
                  <span className="truncate">{s.name}.md</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: '#C4413A' }}
                  >
                    <Trash2 size={10} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </>
          )}

          {allSkills.length === 0 && (
            <p className="text-[10px] px-1 py-4 text-center" style={{ color: 'var(--stone-600)' }}>
              No skills yet
            </p>
          )}
        </div>

        {/* Editor + Preview split */}
        {selected ? (
          <div className="flex-1 flex overflow-hidden">
            {/* Editor */}
            <div
              className="flex-1 flex flex-col border-r"
              style={{ borderColor: 'var(--dark-border)' }}
            >
              <div
                className="flex items-center justify-between px-4 py-2 border-b"
                style={{ borderColor: 'var(--dark-border)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
                    Edit
                  </span>
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{
                      background: selected.scope === 'global' ? '#F5A62315' : 'var(--dark-surface2)',
                      color: selected.scope === 'global' ? '#F5A623' : 'var(--stone-500)',
                    }}
                  >
                    {selected.scope}
                  </span>
                </div>
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="text-[10px] font-mono px-2 py-0.5 rounded"
                  style={{
                    background: '#F5A623',
                    color: '#fff',
                    opacity: isPending ? 0.6 : 1,
                  }}
                >
                  {isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="flex-1 p-4 text-[11px] font-mono leading-relaxed resize-none outline-none"
                style={{
                  background: 'transparent',
                  color: 'var(--stone-400)',
                }}
                placeholder="# Skill Name&#10;&#10;Write your skill content in Markdown..."
              />
            </div>

            {/* Preview */}
            <div className="flex-1 flex flex-col">
              <div
                className="px-4 py-2 border-b"
                style={{ borderColor: 'var(--dark-border)' }}
              >
                <span className="text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
                  Preview
                </span>
              </div>
              <div
                className="flex-1 p-4 overflow-auto text-[11px] leading-relaxed"
                style={{ color: 'var(--stone-400)' }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(editContent) }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--stone-600)' }}>
              Select a skill to edit
            </p>
          </div>
        )}
      </div>

      {/* Create skill dialog */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setCreateOpen(false)}
          />
          <div
            className="relative rounded-xl w-full max-w-md p-6 shadow-2xl"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
                New Skill
              </h2>
              <button onClick={() => setCreateOpen(false)} style={{ color: 'var(--stone-500)' }}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                  Name *
                </label>
                <input
                  name="name"
                  required
                  placeholder="e.g. orchestration-patterns"
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
                  Scope
                </label>
                <select
                  name="scope"
                  defaultValue="global"
                  className="w-full px-3 py-2 rounded-md text-sm outline-none"
                  style={{
                    background: 'var(--dark-surface2)',
                    border: '1px solid var(--dark-border)',
                    color: '#ECEAE4',
                  }}
                >
                  <option value="global">Global</option>
                  <option value="project">Project</option>
                </select>
              </div>

              {projects.length > 0 && (
                <div>
                  <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
                    Project (if project-scoped)
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
                    <option value="">None</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {createError && (
                <p className="text-xs" style={{ color: '#C4413A' }}>
                  {createError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
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
                  {isPending ? 'Creating...' : 'Create Skill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
