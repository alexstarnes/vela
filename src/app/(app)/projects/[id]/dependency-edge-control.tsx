'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { removeTaskDependency } from '@/lib/actions/dependencies';

/**
 * Operator pruning for a single "after: <task>" chip.
 *
 * Dependency edges are proposed by a model — the synthesizer at backlog
 * approval, or the retro-fit pass over an existing backlog. Removing one here
 * immediately changes checkout eligibility, because the gate is computed from
 * the edges on every checkout rather than cached into task status.
 */
export function DependencyEdgeControl({
  taskId,
  dependsOnTaskId,
  dependsOnTitle,
  satisfied,
}: {
  taskId: string;
  dependsOnTaskId: string;
  dependsOnTitle: string;
  satisfied: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeTaskDependency({ taskId, dependsOnTaskId });
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded"
      style={{
        background: satisfied ? '#3D8B5C18' : 'var(--dark-surface2)',
        color: satisfied ? '#3D8B5C' : 'var(--stone-400)',
        opacity: isPending ? 0.5 : 1,
      }}
      title={
        error ??
        (satisfied
          ? `Satisfied: "${dependsOnTitle}" is done`
          : `Blocked until "${dependsOnTitle}" is done`)
      }
    >
      after: {dependsOnTitle.length > 28 ? `${dependsOnTitle.slice(0, 28)}…` : dependsOnTitle}
      <button
        type="button"
        onClick={handleRemove}
        disabled={isPending}
        aria-label={`Remove dependency on ${dependsOnTitle}`}
        style={{ color: error ? '#C4413A' : 'var(--stone-600)' }}
      >
        <X size={9} strokeWidth={2} />
      </button>
    </span>
  );
}
