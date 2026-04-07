export const dynamic = 'force-dynamic';

import { listTasks } from '@/lib/actions/tasks';
import { listProjects } from '@/lib/actions/projects';
import { listAgents } from '@/lib/actions/agents';
import { listPendingApprovals } from '@/lib/actions/approvals';
import { CheckSquare, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { CreateTaskDialog } from './create-task-dialog';
import { KanbanBoard } from './kanban-board';

export default async function TasksPage() {
  const [allTasks, projects, agents, pendingApprovals] = await Promise.all([
    listTasks(),
    listProjects(),
    listAgents(),
    listPendingApprovals(),
  ]);

  const waitingTasks = allTasks.filter((t) => t.status === 'waiting_for_human');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>
            Tasks
          </p>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4', fontFamily: 'Syne, system-ui' }}>
            All Tasks
          </h1>
        </div>
        <CreateTaskDialog projects={projects} agents={agents} />
      </div>

      {/* Waiting for human / pending approvals banner */}
      {(waitingTasks.length > 0 || pendingApprovals.length > 0) && (
        <div
          className="mx-4 mt-3 rounded-lg p-2.5 flex items-center gap-2.5 shrink-0"
          style={{ background: '#C27D1A15', border: '1px solid #C27D1A40' }}
        >
          <AlertTriangle size={14} strokeWidth={1.5} style={{ color: '#C27D1A', flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium" style={{ color: '#ECEAE4' }}>
              {waitingTasks.length > 0 && (
                <>
                  {waitingTasks.length} task{waitingTasks.length > 1 ? 's' : ''} waiting for your input
                  {pendingApprovals.length > 0 && ' · '}
                </>
              )}
              {pendingApprovals.length > 0 && (
                <>
                  {pendingApprovals.length} pending approval{pendingApprovals.length > 1 ? 's' : ''}
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {waitingTasks.slice(0, 3).map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  className="text-[10px] font-mono underline"
                  style={{ color: '#C27D1A' }}
                >
                  {t.title}
                </Link>
              ))}
              {waitingTasks.length > 3 && (
                <span className="text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
                  +{waitingTasks.length - 3} more
                </span>
              )}
              {pendingApprovals.slice(0, 2).map((a) => (
                <Link
                  key={a.id}
                  href={`/tasks/${a.taskId}`}
                  className="text-[10px] font-mono underline"
                  style={{ color: '#C27D1A' }}
                >
                  {a.description.slice(0, 40)}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {waitingTasks[0] && (
              <Link href={`/tasks/${waitingTasks[0].id}`}>
                <button
                  className="text-[10px] font-mono px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  style={{ background: '#C27D1A', color: '#fff' }}
                >
                  Review
                </button>
              </Link>
            )}
            {!waitingTasks[0] && pendingApprovals[0] && (
              <Link href={`/tasks/${pendingApprovals[0].taskId}`}>
                <button
                  className="text-[10px] font-mono px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  style={{ background: '#C27D1A', color: '#fff' }}
                >
                  Review
                </button>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {allTasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <CheckSquare
            size={40}
            strokeWidth={1}
            className="mx-auto mb-4"
            style={{ color: 'var(--stone-600)' }}
          />
          <h2 className="text-sm font-medium mb-1" style={{ color: '#ECEAE4' }}>
            No tasks yet
          </h2>
          <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
            Create a project and add tasks to get started.
          </p>
        </div>
      ) : (
        <KanbanBoard
          tasks={allTasks}
          agents={agents}
          projects={projects}
        />
      )}
    </div>
  );
}
