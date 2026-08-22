'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  BulkTaskActionBar,
  TaskSelectBox,
  useTaskSelection,
} from '@/app/(app)/tasks/task-selection';

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

export interface ProjectTask {
  id: string;
  title: string;
  status: string;
}

/**
 * The project page's task list, with the same multi-select + bulk cancel as
 * the tasks board. Selection covers the rows actually rendered here (the page
 * shows the most recent slice) — "View all" goes to the full board.
 */
export function ProjectTaskList({ tasks }: { tasks: ProjectTask[] }) {
  const selection = useTaskSelection(useMemo(() => tasks.map((t) => t.id), [tasks]));

  if (tasks.length === 0) {
    return (
      <p className="text-xs text-center py-4" style={{ color: 'var(--stone-500)' }}>
        No tasks yet
      </p>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 px-3 pb-2">
        <TaskSelectBox
          checked={selection.allSelected}
          indeterminate={selection.anySelected && !selection.allSelected}
          onToggle={selection.selectAll}
          label={selection.allSelected ? 'Deselect all tasks' : 'Select all tasks'}
        />
        <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--stone-600)' }}>
          {selection.anySelected ? `${selection.selectedCount} selected` : 'Select'}
        </span>
      </div>

      <div className="space-y-2">
        {tasks.map((task) => {
          const selected = selection.isSelected(task.id);
          const c = STATUS_COLORS[task.status] ?? STATUS_COLORS.backlog;

          return (
            <Link key={task.id} href={`/tasks/${task.id}`} className="block">
              <div
                className="flex items-center gap-3 px-3 py-2 rounded-md"
                style={{
                  background: selected ? '#F5A62310' : 'var(--dark-surface)',
                  border: `1px solid ${selected ? '#F5A62360' : 'var(--dark-border)'}`,
                }}
              >
                <TaskSelectBox
                  checked={selected}
                  onToggle={(e) => selection.toggle(task.id, e)}
                  label={`Select task ${task.title}`}
                />
                <span className="flex-1 text-sm" style={{ color: '#ECEAE4' }}>
                  {task.title}
                </span>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: c.bg, color: c.fg }}
                >
                  {task.status.replace(/_/g, ' ')}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <BulkTaskActionBar
        selection={selection}
        totalVisible={tasks.length}
        statusById={Object.fromEntries(tasks.map((t) => [t.id, t.status]))}
      />
    </>
  );
}
