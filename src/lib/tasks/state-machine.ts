// Task status state machine
// Valid transitions (from implementation plan §5 + §8):
// backlog → open
// open → in_progress
// in_progress → review
// in_progress → waiting_for_human
// in_progress → open (requeue after failed run / manual retry)
// in_progress → blocked
// review → done
// review → in_progress
// waiting_for_human → open
// waiting_for_human → in_progress
// blocked → open
// Any → cancelled

export type TaskStatus =
  | 'backlog'
  | 'open'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'waiting_for_human'
  | 'blocked'
  | 'cancelled';

// Note: the implementation plan's §8 also mentions the agent-centric state machine:
// pending → running → completed
// pending → running → failed
// pending → cancelled
// running → waiting_for_human
// waiting_for_human → running
// running → delegated
// These map onto the broader task statuses above. We use the schema statuses.

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['open', 'cancelled'],
  open: ['in_progress', 'cancelled'],
  in_progress: ['review', 'waiting_for_human', 'open', 'blocked', 'cancelled'],
  review: ['done', 'in_progress', 'cancelled'],
  done: ['cancelled'],
  waiting_for_human: ['open', 'in_progress', 'cancelled'],
  blocked: ['open', 'cancelled'],
  cancelled: [],
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function assertValidTransition(from: TaskStatus, to: TaskStatus): void {
  if (!isValidTransition(from, to)) {
    throw new Error(
      `Invalid task status transition: ${from} → ${to}. ` +
        `Allowed from "${from}": ${VALID_TRANSITIONS[from]?.join(', ') || 'none'}`
    );
  }
}

export const ALL_STATUSES: TaskStatus[] = [
  'backlog',
  'open',
  'in_progress',
  'review',
  'done',
  'waiting_for_human',
  'blocked',
  'cancelled',
];
