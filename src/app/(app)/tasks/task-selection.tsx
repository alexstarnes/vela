'use client';

/**
 * Multi-select + bulk actions for task lists.
 *
 * Shared by the tasks board/list and the project detail page so selection
 * behaves identically wherever tasks are listed: click to toggle, shift-click
 * to extend a range, Escape to clear, and a floating bar for the action.
 *
 * Only cancel is wired up — it is the action operators need in bulk. The
 * server action behind it (`bulkTransitionTasks`) is status-generic, so adding
 * requeue/assign later is a button, not a rewrite.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { bulkTransitionTasks } from '@/lib/actions/tasks';
import { AlertTriangle, Check, X } from 'lucide-react';

// ─── Selection hook ────────────────────────────────────────────────

export interface TaskSelection {
  selectedIds: string[];
  selectedCount: number;
  isSelected: (id: string) => boolean;
  /** Toggle one row. Pass the click event to get shift-click range select. */
  toggle: (id: string, event?: { shiftKey?: boolean }) => void;
  selectAll: () => void;
  clear: () => void;
  allSelected: boolean;
  anySelected: boolean;
}

/**
 * @param orderedIds ids in the order they are rendered — shift-click extends
 *   over this order, so pass the *filtered* list the user can actually see.
 */
export function useTaskSelection(orderedIds: string[]): TaskSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  const orderKey = orderedIds.join(',');

  // Drop ids that left the list (filtered out, cancelled, deleted) so the
  // count in the action bar never claims more than is on screen.
  useEffect(() => {
    const visible = new Set(orderKey ? orderKey.split(',') : []);
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [orderKey]);

  const toggle = useCallback(
    (id: string, event?: { shiftKey?: boolean }) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const anchor = anchorRef.current;

        if (event?.shiftKey && anchor && anchor !== id) {
          const from = orderedIds.indexOf(anchor);
          const to = orderedIds.indexOf(id);
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            // A shift-click always *adds* the range — matching Finder/Gmail,
            // where extending a selection never silently drops rows.
            for (const rangeId of orderedIds.slice(lo, hi + 1)) next.add(rangeId);
            return next;
          }
        }

        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchorRef.current = id;
        return next;
      });
    },
    [orderedIds]
  );

  const selectAll = useCallback(() => {
    setSelected((prev) => (prev.size === orderedIds.length ? new Set() : new Set(orderedIds)));
    anchorRef.current = null;
  }, [orderedIds]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  // Escape is the universal "never mind" for a selection.
  useEffect(() => {
    if (selected.size === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') clear();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected.size, clear]);

  const selectedIds = useMemo(
    () => orderedIds.filter((id) => selected.has(id)),
    [orderedIds, selected]
  );

  return {
    selectedIds,
    selectedCount: selected.size,
    isSelected: (id: string) => selected.has(id),
    toggle,
    selectAll,
    clear,
    allSelected: orderedIds.length > 0 && selected.size === orderedIds.length,
    anySelected: selected.size > 0,
  };
}

// ─── Checkbox ──────────────────────────────────────────────────────

interface CheckboxProps {
  checked: boolean;
  onToggle: (event: { shiftKey?: boolean }) => void;
  label: string;
  /** Renders a dash instead of a tick — for "some but not all" select-all. */
  indeterminate?: boolean;
}

/**
 * Rows are wrapped in <Link>, so the checkbox must swallow the click before it
 * navigates. Rendered as a button with role=checkbox rather than an <input> so
 * that suppression is unambiguous.
 */
export function TaskSelectBox({ checked, onToggle, label, indeterminate }: CheckboxProps) {
  function handleClick(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onToggle({ shiftKey: e.shiftKey });
  }

  // On the kanban board the card itself is a drag handle listening on
  // mousedown — stop it here so ticking a checkbox never starts a drag.
  function handleMouseDown(e: ReactMouseEvent) {
    e.stopPropagation();
  }

  const on = checked || indeterminate;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      className="shrink-0 w-3.5 h-3.5 rounded-[3px] flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dark-bg)]"
      style={{
        background: on ? '#F5A623' : 'transparent',
        border: `1px solid ${on ? '#F5A623' : 'var(--stone-600)'}`,
      }}
    >
      {indeterminate ? (
        <span className="block w-1.5 h-[1.5px]" style={{ background: '#1A1917' }} />
      ) : checked ? (
        <Check size={10} strokeWidth={3} style={{ color: '#1A1917' }} />
      ) : null}
    </button>
  );
}

// ─── Bulk action bar ───────────────────────────────────────────────

interface BarProps {
  selection: TaskSelection;
  /** Total rows currently visible, for the "select all" affordance. */
  totalVisible: number;
  /** Status by task id — decides whether Reopen is offered for this selection. */
  statusById: Record<string, string>;
}

/**
 * Floating bar, shown only while something is selected. Cancel takes two
 * clicks: cancelling a batch is irreversible (`cancelled` is a terminal state
 * with no transitions out) so it gets an inline confirm rather than firing on
 * the first click.
 */
export function BulkTaskActionBar({ selection, totalVisible, statusById }: BarProps) {
  const { selectedIds, selectedCount, clear, selectAll } = selection;
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    verb: 'cancelled' | 'reopened';
    updated: number;
    skipped: number;
    error?: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Reopen is offered only when the selection actually contains cancelled
  // tasks — otherwise it is a button that can only ever report "0 reopened".
  const cancelledCount = selectedIds.filter((id) => statusById[id] === 'cancelled').length;

  // A changed selection invalidates a pending confirm — otherwise the second
  // click could cancel a different set of tasks than the first click described.
  useEffect(() => {
    setConfirming(false);
  }, [selectedIds.join(',')]);

  function run(target: 'cancelled' | 'backlog') {
    const ids = target === 'cancelled' ? selectedIds : selectedIds.filter((id) => statusById[id] === 'cancelled');
    const verb = target === 'cancelled' ? 'cancelled' : 'reopened';

    startTransition(async () => {
      const res = await bulkTransitionTasks({
        ids,
        status: target,
        reason:
          target === 'cancelled'
            ? `Cancelled in bulk (${ids.length} task${ids.length === 1 ? '' : 's'})`
            : `Reopened in bulk — returned to backlog (${ids.length} task${ids.length === 1 ? '' : 's'})`,
      });

      if (!res.success) {
        setResult({ verb, updated: 0, skipped: 0, error: res.error });
        setConfirming(false);
        return;
      }

      setResult({ verb, updated: res.data.updated.length, skipped: res.data.skipped.length });
      setConfirming(false);
      clear();
      router.refresh();
    });
  }

  // Result toast outlives the selection, so it renders even at count 0.
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(t);
  }, [result]);

  if (selectedCount === 0 && !result) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {result && (
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] shadow-lg"
          style={{
            background: result.error ? '#C4413A15' : 'var(--dark-surface)',
            border: `1px solid ${result.error ? '#C4413A40' : 'var(--dark-border)'}`,
            color: result.error ? '#C4413A' : '#ECEAE4',
          }}
        >
          {result.error ? (
            <>
              <AlertTriangle size={13} strokeWidth={1.5} />
              {result.error}
            </>
          ) : (
            <>
              <Check size={13} strokeWidth={2} style={{ color: '#3D8B5C' }} />
              <span>
                {result.updated} task{result.updated === 1 ? '' : 's'} {result.verb}
                {result.verb === 'reopened' && result.updated > 0 ? ' to backlog' : ''}
              </span>
              {result.skipped > 0 && (
                <span style={{ color: 'var(--stone-500)' }}>
                  · {result.skipped} skipped (already {result.verb === 'cancelled' ? 'cancelled' : 'active'} or changed)
                </span>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setResult(null)}
            aria-label="Dismiss"
            className="ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
            style={{ color: 'var(--stone-500)' }}
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {selectedCount > 0 && (
        <div
          role="region"
          aria-label="Bulk task actions"
          className="pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-2 shadow-xl"
          style={{
            background: 'var(--dark-surface)',
            border: '1px solid var(--dark-border)',
          }}
        >
          <span className="text-[11px] font-mono" style={{ color: '#ECEAE4' }}>
            {selectedCount} selected
          </span>

          {totalVisible > selectedCount && (
            <button
              type="button"
              onClick={selectAll}
              disabled={isPending}
              className="text-[10px] font-mono px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              style={{ color: 'var(--stone-500)', background: 'var(--dark-surface2)' }}
            >
              Select all {totalVisible}
            </button>
          )}

          <span className="w-px h-4" style={{ background: 'var(--dark-border)' }} />

          {confirming ? (
            <>
              <span className="text-[11px]" style={{ color: '#C4413A' }}>
                Cancel {selectedCount}? This can&apos;t be undone.
              </span>
              <button
                type="button"
                onClick={() => run('cancelled')}
                disabled={isPending}
                autoFocus
                className="text-[10px] font-mono px-2.5 py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                style={{ background: '#C4413A', color: '#fff', opacity: isPending ? 0.6 : 1 }}
              >
                {isPending ? 'Cancelling…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="text-[10px] font-mono px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                style={{ color: 'var(--stone-500)', background: 'var(--dark-surface2)' }}
              >
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={isPending}
                className="text-[10px] font-mono px-2.5 py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                style={{
                  background: '#C4413A25',
                  color: '#C4413A',
                  border: '1px solid #C4413A40',
                }}
              >
                Cancel {selectedCount} task{selectedCount === 1 ? '' : 's'}
              </button>
              {cancelledCount > 0 && (
                <button
                  type="button"
                  onClick={() => run('backlog')}
                  disabled={isPending}
                  title="Returns cancelled tasks to backlog, not straight into an agent's queue"
                  className="text-[10px] font-mono px-2.5 py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  style={{
                    background: '#4A7AB525',
                    color: '#4A7AB5',
                    border: '1px solid #4A7AB540',
                    opacity: isPending ? 0.6 : 1,
                  }}
                >
                  {isPending ? 'Reopening…' : `Reopen ${cancelledCount}`}
                </button>
              )}
              <button
                type="button"
                onClick={clear}
                disabled={isPending}
                className="text-[10px] font-mono px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                style={{ color: 'var(--stone-500)', background: 'var(--dark-surface2)' }}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
