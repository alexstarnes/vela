export const dynamic = 'force-dynamic';

import { listProjects } from '@/lib/actions/projects';
import { listTasks } from '@/lib/actions/tasks';
import { listAgents } from '@/lib/actions/agents';
import { FolderOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { CreateProjectDialog } from './create-project-dialog';

export default async function ProjectsPage() {
  const [allProjects, allTasks, allAgents] = await Promise.all([
    listProjects(),
    listTasks(),
    listAgents(),
  ]);

  const activeProjects = allProjects.filter((p) => p.status === 'active');
  const archivedProjects = allProjects.filter((p) => p.status === 'archived');

  function getProjectStats(projectId: string) {
    const projectTasks = allTasks.filter((t) => t.projectId === projectId);
    const doneTasks = projectTasks.filter((t) => t.status === 'done');
    const projectAgents = allAgents.filter((a) => a.projectId === projectId);
    return {
      total: projectTasks.length,
      done: doneTasks.length,
      agents: projectAgents.length,
    };
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <h1
            className="text-lg font-bold tracking-tight"
            style={{ color: '#ECEAE4' }}
          >
            Projects
          </h1>
        </div>
        <CreateProjectDialog />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {allProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FolderOpen
              size={40}
              strokeWidth={1}
              className="mx-auto mb-4"
              style={{ color: 'var(--stone-600)' }}
            />
            <h2 className="text-sm font-medium mb-1" style={{ color: '#ECEAE4' }}>
              No projects yet
            </h2>
            <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
              Create your first project to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {activeProjects.map((project) => {
              const stats = getProjectStats(project.id);
              const progressPct =
                stats.total > 0 ? (stats.done / stats.total) * 100 : 0;

              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block"
                >
                  <div
                    className="rounded-lg p-4 flex items-start gap-4 cursor-pointer transition-colors hover:border-amber-400/40"
                    style={{
                      background: 'var(--dark-surface)',
                      border: '1px solid var(--dark-border)',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p
                          className="text-sm font-semibold truncate"
                          style={{ color: '#ECEAE4' }}
                        >
                          {project.name}
                        </p>
                        <span
                          className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0"
                          style={{
                            background: '#E8F5E920',
                            color: '#3D8B5C',
                          }}
                        >
                          {project.status}
                        </span>
                      </div>
                      {project.goal && (
                        <p
                          className="text-xs mb-3 line-clamp-2"
                          style={{ color: 'var(--stone-400)' }}
                        >
                          {project.goal}
                        </p>
                      )}
                      <div
                        className="flex gap-4 text-[10px] font-mono mb-2"
                        style={{ color: 'var(--stone-500)' }}
                      >
                        <span>
                          {stats.total} tasks ({stats.done} done)
                        </span>
                        <span>{stats.agents} agents</span>
                      </div>
                      {/* Progress bar */}
                      <div
                        className="h-1 rounded-full overflow-hidden"
                        style={{ background: 'var(--dark-border)' }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${progressPct}%`,
                            background: '#F5A623',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}

            {archivedProjects.length > 0 && (
              <div className="mt-6">
                <p
                  className="text-[10px] font-mono uppercase tracking-wider mb-2"
                  style={{ color: 'var(--stone-500)' }}
                >
                  Archived
                </p>
                {archivedProjects.map((project) => {
                  const stats = getProjectStats(project.id);
                  return (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="block mb-2"
                    >
                      <div
                        className="rounded-lg p-4 opacity-60"
                        style={{
                          background: 'var(--dark-surface)',
                          border: '1px solid var(--dark-border)',
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <p
                            className="text-sm font-medium"
                            style={{ color: '#ECEAE4' }}
                          >
                            {project.name}
                          </p>
                          <span
                            className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full"
                            style={{
                              background: 'var(--dark-surface2)',
                              color: 'var(--stone-500)',
                            }}
                          >
                            archived
                          </span>
                        </div>
                        <div
                          className="text-[10px] font-mono"
                          style={{ color: 'var(--stone-500)' }}
                        >
                          {stats.total} tasks
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
