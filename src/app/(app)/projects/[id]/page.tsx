export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getProject } from '@/lib/actions/projects';
import { listTasks } from '@/lib/actions/tasks';
import { listAgents } from '@/lib/actions/agents';
import { listSkills } from '@/lib/actions/skills';
import Link from 'next/link';
import { ChevronLeft, FolderOpen } from 'lucide-react';
import { ProjectDetailClient } from './project-detail-client';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, allTasks, allAgents, allSkills] = await Promise.all([
    getProject(id),
    listTasks({ projectId: id }),
    listAgents(),
    listSkills(id),
  ]);

  if (!project) notFound();

  const projectAgents = allAgents.filter((a) => a.projectId === id);
  const doneTasks = allTasks.filter((t) => t.status === 'done');
  const progressPct = allTasks.length > 0 ? (doneTasks.length / allTasks.length) * 100 : 0;

  const globalSkills = allSkills.filter((s) => s.scope === 'global');
  const projectSkills = allSkills.filter((s) => s.scope === 'project');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <Link href="/projects" style={{ color: 'var(--stone-500)' }}>
              <ChevronLeft size={14} strokeWidth={1.5} />
            </Link>
            <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>
              Projects / {project.name}
            </p>
          </div>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
            {project.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full"
            style={{
              background: project.status === 'active' ? '#3D8B5C20' : 'var(--dark-surface2)',
              color: project.status === 'active' ? '#3D8B5C' : 'var(--stone-500)',
            }}
          >
            {project.status}
          </span>
          <ProjectDetailClient project={project} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Tasks', value: allTasks.length },
            { label: 'Completed', value: doneTasks.length },
            { label: 'Agents', value: projectAgents.length },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg p-4"
              style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
            >
              <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--stone-500)' }}>
                {label}
              </p>
              <p className="text-2xl font-bold" style={{ color: '#ECEAE4' }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        {allTasks.length > 0 && (
          <div>
            <div className="flex justify-between text-[10px] font-mono mb-1" style={{ color: 'var(--stone-500)' }}>
              <span>Progress</span>
              <span>{doneTasks.length}/{allTasks.length} done</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--dark-border)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progressPct}%`, background: '#F5A623' }}
              />
            </div>
          </div>
        )}

        {/* Goal & Context */}
        {(project.goal || project.context) && (
          <div
            className="rounded-lg p-4 space-y-3"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            {project.goal && (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--stone-500)' }}>
                  Goal
                </p>
                <p className="text-sm" style={{ color: '#ECEAE4' }}>{project.goal}</p>
              </div>
            )}
            {project.context && (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--stone-500)' }}>
                  Context
                </p>
                <p className="text-sm" style={{ color: 'var(--stone-400)' }}>{project.context}</p>
              </div>
            )}
          </div>
        )}

        {/* Tasks */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--stone-500)' }}>
              Tasks
            </p>
            <Link
              href={`/tasks?projectId=${id}`}
              className="text-[10px] font-mono"
              style={{ color: '#F5A623' }}
            >
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {allTasks.slice(0, 10).map((task) => (
              <Link key={task.id} href={`/tasks/${task.id}`} className="block">
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-md"
                  style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
                >
                  <span className="text-sm" style={{ color: '#ECEAE4' }}>{task.title}</span>
                  <StatusBadge status={task.status} />
                </div>
              </Link>
            ))}
            {allTasks.length === 0 && (
              <p className="text-xs text-center py-4" style={{ color: 'var(--stone-500)' }}>
                No tasks yet
              </p>
            )}
          </div>
        </div>

        {/* Skills */}
        {(globalSkills.length > 0 || projectSkills.length > 0) && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: 'var(--stone-500)' }}>
              Skills
            </p>
            <div className="flex flex-wrap gap-2">
              {[...globalSkills, ...projectSkills].map((skill) => (
                <Link key={skill.id} href={`/skills?id=${skill.id}`}>
                  <span
                    className="inline-block text-[11px] font-mono px-2.5 py-1 rounded-md"
                    style={{
                      background: skill.scope === 'global' ? '#F5A62320' : 'var(--dark-surface2)',
                      color: skill.scope === 'global' ? '#F5A623' : 'var(--stone-400)',
                      border: '1px solid var(--dark-border)',
                    }}
                  >
                    {skill.name}.md
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    backlog: { bg: '#6B665A20', fg: '#8E897B' },
    open: { bg: '#4A7AB520', fg: '#4A7AB5' },
    in_progress: { bg: '#F5A62320', fg: '#F5A623' },
    review: { bg: '#7C3AED20', fg: '#7C3AED' },
    done: { bg: '#3D8B5C20', fg: '#3D8B5C' },
    waiting_for_human: { bg: '#C27D1A20', fg: '#C27D1A' },
    blocked: { bg: '#C4413A20', fg: '#C4413A' },
    cancelled: { bg: '#6B665A20', fg: '#6B665A' },
  };
  const c = colors[status] ?? { bg: '#6B665A20', fg: '#8E897B' };
  return (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
      style={{ background: c.bg, color: c.fg }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
