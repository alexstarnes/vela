'use client';

import { useTransition } from 'react';
import { transitionTask } from '@/lib/actions/tasks';
import { useRouter } from 'next/navigation';
import type { Task, Agent } from '@/lib/db/schema';
import type { TaskStatus } from '@/lib/tasks/state-machine';

// Valid transitions from each status
const NEXT_TRANSITIONS: Record<TaskStatus, { to: TaskStatus; label: string }[]> = {
  backlog: [{ to: 'open', label: 'Open' }, { to: 'cancelled', label: 'Cancel' }],
  open: [{ to: 'in_progress', label: 'Start' }, { to: 'cancelled', label: 'Cancel' }],
  in_progress: [
    { to: 'review', label: '→ Review' },
    { to: 'waiting_for_human', label: 'Wait for input' },
    { to: 'blocked', label: 'Block' },
    { to: 'cancelled', label: 'Cancel' },
  ],
  review: [
    { to: 'done', label: 'Approve' },
    { to: 'in_progress', label: 'Request changes' },
    { to: 'cancelled', label: 'Cancel' },
  ],
  done: [{ to: 'cancelled', label: 'Cancel' }],
  waiting_for_human: [{ to: 'in_progress', label: 'Resume' }, { to: 'cancelled', label: 'Cancel' }],
  blocked: [{ to: 'open', label: 'Unblock' }, { to: 'cancelled', label: 'Cancel' }],
  cancelled: [],
};

interface Props {
  task: Task;
  agents: Agent[];
}

export function TaskStatusControls({ task, agents }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const currentStatus = task.status as TaskStatus;
  const transitions = NEXT_TRANSITIONS[currentStatus] ?? [];

  function handleTransition(to: TaskStatus) {
    startTransition(async () => {
      const result = await transitionTask({ id: task.id, status: to });
      if (!result.success) {
        alert(`Transition failed: ${result.error}`);
        return;
      }
      router.refresh();
    });
  }

  if (transitions.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {transitions.map((t) => (
        <button
          key={t.to}
          onClick={() => handleTransition(t.to)}
          disabled={isPending}
          className="text-[11px] font-mono px-2.5 py-1 rounded-md"
          style={{
            background:
              t.to === 'done'
                ? '#3D8B5C20'
                : t.to === 'cancelled'
                ? '#C4413A20'
                : 'var(--dark-surface2)',
            color:
              t.to === 'done'
                ? '#3D8B5C'
                : t.to === 'cancelled'
                ? '#C4413A'
                : 'var(--stone-400)',
            opacity: isPending ? 0.6 : 1,
            border: '1px solid var(--dark-border)',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
