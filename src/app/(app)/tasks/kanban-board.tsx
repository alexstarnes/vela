'use client';

import { useState, useCallback, useTransition } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { transitionTask } from '@/lib/actions/tasks';
import Link from 'next/link';
import { isValidTransition, type TaskStatus } from '@/lib/tasks/state-machine';
import { LayoutGrid, List, AlertCircle } from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
];

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  backlog: { bg: '#6B665A20', fg: '#8E897B' },
  open: { bg: '#4A7AB520', fg: '#4A7AB5' },
  in_progress: { bg: '#F5A62320', fg: '#F5A623' },
  review: { bg: '#7C3AED20', fg: '#7C3AED' },
  done: { bg: '#3D8B5C20', fg: '#3D8B5C' },
  waiting_for_human: { bg: '#C27D1A20', fg: '#C27D1A' },
  blocked: { bg: '#C4413A20', fg: '#C4413A' },
  cancelled: { bg: '#6B665A20', fg: '#6B665A' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: '#6B665A',
  medium: '#4A7AB5',
  high: '#F5A623',
  urgent: '#C4413A',
};

// ─── Types ─────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignedAgent?: Agent | null;
  project?: Project | null;
}

interface KanbanBoardProps {
  tasks: Task[];
  agents: Agent[];
  projects: Project[];
}

// ─── Task Card ─────────────────────────────────────────────────────

function TaskCard({ task, index }: { task: Task; index: number }) {
  const sc = STATUS_COLORS[task.status] ?? STATUS_COLORS.backlog;
  const priColor = PRIORITY_COLORS[task.priority] ?? '#6B665A';

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="mb-1.5"
          style={provided.draggableProps.style}
        >
          <Link href={`/tasks/${task.id}`}>
            <div
              className="rounded-md p-2.5 cursor-pointer transition-all"
              style={{
                background: snapshot.isDragging ? 'var(--dark-surface2)' : 'var(--dark-surface)',
                border: `1px solid ${snapshot.isDragging ? '#F5A62360' : 'var(--dark-border)'}`,
                boxShadow: snapshot.isDragging ? '0 4px 12px rgba(0,0,0,0.4)' : 'none',
                opacity: snapshot.isDragging ? 0.95 : 1,
              }}
            >
              <div className="flex items-start justify-between gap-1.5 mb-1.5">
                <p className="text-[11px] font-medium leading-tight" style={{ color: '#ECEAE4' }}>
                  {task.title}
                </p>
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
                  style={{ background: priColor }}
                />
              </div>
              <div className="flex items-center justify-between">
                {task.assignedAgent && (
                  <div className="flex items-center gap-1">
                    <div
                      className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold"
                      style={{ background: '#F5A62320', color: '#F5A623' }}
                    >
                      {task.assignedAgent.name[0]}
                    </div>
                    <span className="text-[9px]" style={{ color: 'var(--stone-500)' }}>
                      {task.assignedAgent.name}
                    </span>
                  </div>
                )}
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded ml-auto"
                  style={{ background: sc.bg, color: sc.fg }}
                >
                  {task.priority}
                </span>
              </div>
              {task.project && (
                <p className="text-[9px] font-mono mt-1" style={{ color: 'var(--stone-600)' }}>
                  {task.project.name}
                </p>
              )}
            </div>
          </Link>
        </div>
      )}
    </Draggable>
  );
}

// ─── List Row ──────────────────────────────────────────────────────

function TaskListRow({ task }: { task: Task }) {
  const sc = STATUS_COLORS[task.status] ?? STATUS_COLORS.backlog;
  const priColor = PRIORITY_COLORS[task.priority] ?? '#6B665A';

  return (
    <Link href={`/tasks/${task.id}`}>
      <div
        className="flex items-center gap-3 px-4 py-2.5 border-b hover:bg-[var(--dark-surface2)] transition-colors"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priColor }} />
        <p className="flex-1 text-[11px] font-medium" style={{ color: '#ECEAE4' }}>
          {task.title}
        </p>
        {task.project && (
          <span className="text-[9px] font-mono hidden sm:block" style={{ color: 'var(--stone-600)' }}>
            {task.project.name}
          </span>
        )}
        {task.assignedAgent && (
          <span className="text-[9px]" style={{ color: 'var(--stone-500)' }}>
            {task.assignedAgent.name}
          </span>
        )}
        <span
          className="text-[9px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: sc.bg, color: sc.fg }}
        >
          {task.status.replace(/_/g, ' ')}
        </span>
      </div>
    </Link>
  );
}

// ─── Main Board ────────────────────────────────────────────────────

export function KanbanBoard({ tasks: initialTasks, agents, projects }: KanbanBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [filterAgentId, setFilterAgentId] = useState<string>('');
  const [filterProjectId, setFilterProjectId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Apply filters
  const filteredTasks = tasks.filter((t) => {
    if (filterAgentId && t.assignedAgent?.id !== filterAgentId) return false;
    if (filterProjectId && t.project?.id !== filterProjectId) return false;
    return true;
  });

  const tasksByStatus = COLUMNS.reduce(
    (acc, col) => {
      acc[col.status] = filteredTasks.filter((t) => t.status === col.status);
      return acc;
    },
    {} as Record<string, Task[]>
  );

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId, destination } = result;
      if (!destination) return;

      const newStatus = destination.droppableId as TaskStatus;
      const task = tasks.find((t) => t.id === draggableId);
      if (!task) return;

      const fromStatus = task.status as TaskStatus;
      if (fromStatus === newStatus) return;

      // Validate transition
      if (!isValidTransition(fromStatus, newStatus)) {
        setError(`Cannot move task from "${fromStatus.replace(/_/g, ' ')}" to "${newStatus.replace(/_/g, ' ')}"`);
        setTimeout(() => setError(null), 3000);
        return;
      }

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) => (t.id === draggableId ? { ...t, status: newStatus } : t))
      );

      startTransition(async () => {
        const res = await transitionTask({ id: draggableId, status: newStatus });
        if (!res.success) {
          // Revert on error
          setTasks((prev) =>
            prev.map((t) => (t.id === draggableId ? { ...t, status: fromStatus } : t))
          );
          setError(res.error ?? 'Failed to update task status');
          setTimeout(() => setError(null), 3000);
        }
      });
    },
    [tasks]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Filter bar */}
      <div
        className="flex items-center gap-2 px-5 py-2 border-b flex-wrap"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <span className="text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
          Filter:
        </span>

        {/* Project filter */}
        <select
          value={filterProjectId}
          onChange={(e) => setFilterProjectId(e.target.value)}
          className="text-[10px] font-mono px-2 py-0.5 rounded-full outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-[var(--dark-bg)]"
          style={{
            background: filterProjectId ? '#4A7AB520' : 'var(--dark-surface2)',
            color: filterProjectId ? '#4A7AB5' : 'var(--stone-500)',
            border: `1px solid ${filterProjectId ? '#4A7AB540' : 'var(--dark-border)'}`,
          }}
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Agent filter */}
        <select
          value={filterAgentId}
          onChange={(e) => setFilterAgentId(e.target.value)}
          className="text-[10px] font-mono px-2 py-0.5 rounded-full outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-[var(--dark-bg)]"
          style={{
            background: filterAgentId ? '#F5A62320' : 'var(--dark-surface2)',
            color: filterAgentId ? '#F5A623' : 'var(--stone-500)',
            border: `1px solid ${filterAgentId ? '#F5A62340' : 'var(--dark-border)'}`,
          }}
        >
          <option value="">All Agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {(filterAgentId || filterProjectId) && (
          <button
            onClick={() => { setFilterAgentId(''); setFilterProjectId(''); }}
            className="text-[10px] font-mono px-2 py-0.5 rounded-full focus:outline-none focus:ring-2 focus:ring-amber-500"
            style={{ color: 'var(--stone-500)', background: 'var(--dark-surface2)', border: '1px solid var(--dark-border)' }}
          >
            Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setView('board')}
            className="p-1 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 focus:ring-offset-[var(--dark-bg)]"
            style={{
              background: view === 'board' ? '#F5A62320' : 'transparent',
              color: view === 'board' ? '#F5A623' : 'var(--stone-500)',
            }}
            title="Board view"
          >
            <LayoutGrid size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setView('list')}
            className="p-1 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 focus:ring-offset-[var(--dark-bg)]"
            style={{
              background: view === 'list' ? '#F5A62320' : 'transparent',
              color: view === 'list' ? '#F5A623' : 'var(--stone-500)',
            }}
            title="List view"
          >
            <List size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="mx-4 mt-2 rounded-lg px-3 py-2 flex items-center gap-2 text-[11px]"
          style={{ background: '#C4413A15', border: '1px solid #C4413A40', color: '#C4413A' }}
        >
          <AlertCircle size={13} strokeWidth={1.5} />
          {error}
        </div>
      )}

      {/* Board / List content */}
      {view === 'list' ? (
        <div className="flex-1 overflow-auto">
          {/* List header */}
          <div
            className="grid grid-cols-4 gap-3 px-4 py-1.5 text-[9px] font-mono uppercase tracking-wider border-b"
            style={{ background: 'var(--dark-surface2)', borderColor: 'var(--dark-border)', color: 'var(--stone-500)' }}
          >
            <span>Title</span>
            <span>Project</span>
            <span>Agent</span>
            <span>Status</span>
          </div>
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: '#ECEAE4' }}>No tasks match filters</p>
              <p className="text-xs" style={{ color: 'var(--stone-500)' }}>Try clearing the filters above</p>
            </div>
          ) : (
            filteredTasks.map((task) => <TaskListRow key={task.id} task={task} />)
          )}
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex-1 flex gap-2 p-4 overflow-x-auto overflow-y-hidden min-h-0">
            {COLUMNS.map((col) => {
              const colTasks = tasksByStatus[col.status] ?? [];
              return (
                <div
                  key={col.status}
                  className="rounded-lg p-2 flex flex-col min-w-[200px] flex-1"
                  style={{ background: 'var(--dark-surface2)' }}
                >
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <p
                      className="text-[9px] font-mono uppercase tracking-wider"
                      style={{ color: 'var(--stone-500)' }}
                    >
                      {col.label}
                    </p>
                    <span className="text-[9px] font-mono" style={{ color: 'var(--stone-600)' }}>
                      {colTasks.length}
                    </span>
                  </div>
                  <Droppable droppableId={col.status}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="flex-1 overflow-y-auto min-h-[60px] rounded transition-colors"
                        style={{
                          background: snapshot.isDraggingOver ? '#F5A62308' : 'transparent',
                        }}
                      >
                        {colTasks.map((task, index) => (
                          <TaskCard key={task.id} task={task} index={index} />
                        ))}
                        {provided.placeholder}
                        {colTasks.length === 0 && !snapshot.isDraggingOver && (
                          <div
                            className="flex items-center justify-center py-6 text-[9px] font-mono rounded border border-dashed"
                            style={{ color: 'var(--stone-700)', borderColor: 'var(--dark-border)' }}
                          >
                            Empty
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}
