import Link from 'next/link';
import { AlertTriangle, GitBranch, Radio } from 'lucide-react';
import { buildExecutionLayers, type DependencyLink } from '@/lib/tasks/dependencies';
import { DependencyEdgeControl } from './dependency-edge-control';
import type { WorkspaceOverview } from '@/lib/workspace/branch-lifecycle';

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

/** Statuses that need eyes right now — the in-flight strip. */
const IN_FLIGHT_STATUSES = ['in_progress', 'review', 'waiting_for_human'] as const;
/** Statuses that still want to run — the execution plan. */
const PLANNED_STATUSES = ['open', 'backlog', 'blocked'] as const;

export interface FlightViewTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: Date;
  assignedAgent?: { name: string } | null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[10px] font-mono uppercase tracking-wider"
      style={{ color: 'var(--stone-500)' }}
    >
      {children}
    </p>
  );
}

/**
 * C.1 — what is in flight right now. `in_progress`, `review` and
 * `waiting_for_human` are the statuses that either are consuming budget or are
 * waiting on the operator, so they get prominence over the flat task list.
 */
function InFlightStrip({ tasks }: { tasks: FlightViewTask[] }) {
  if (tasks.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
        Nothing in flight — no task is running, awaiting review, or waiting on you.
      </p>
    );
  }

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {tasks.map((task) => {
        const sc = STATUS_COLORS[task.status] ?? STATUS_COLORS.backlog;
        return (
          <Link key={task.id} href={`/tasks/${task.id}`} className="block">
            <div
              className="rounded-lg p-3 h-full"
              style={{ background: 'var(--dark-surface)', border: `1.5px solid ${sc.fg}55` }}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: sc.bg, color: sc.fg }}
                >
                  {task.status.replace(/_/g, ' ')}
                </span>
                {task.status === 'in_progress' && (
                  <Radio size={10} style={{ color: sc.fg }} strokeWidth={2} />
                )}
              </div>
              <p className="text-[13px] font-medium leading-snug" style={{ color: '#ECEAE4' }}>
                {task.title}
              </p>
              <p className="mt-1 text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
                {task.assignedAgent?.name ?? 'Unassigned'} · {task.priority}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * C.2 — the execution plan in topological layers. Layer 0 has no unmet
 * dependencies and is eligible for checkout now; layer N waits on something
 * below it. Layered columns, not a graph library: ordering is the question
 * being answered, and edge routing would obscure more than it shows.
 */
function ExecutionPlan({
  tasks,
  links,
}: {
  tasks: FlightViewTask[];
  links: DependencyLink[];
}) {
  if (tasks.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
        No queued work — every task of this project is in flight or finished.
      </p>
    );
  }

  const layers = buildExecutionLayers(tasks, links);
  const linksByTask = new Map<string, DependencyLink[]>();
  for (const link of links) {
    if (!linksByTask.has(link.taskId)) linksByTask.set(link.taskId, []);
    linksByTask.get(link.taskId)!.push(link);
  }

  // A flat grid with no chips is ambiguous: it looks identical whether the
  // stories genuinely have no prerequisites or whether nobody ever recorded
  // any. Say which, and say how ordering gets written.
  const relevantEdges = tasks.filter((task) => (linksByTask.get(task.id)?.length ?? 0) > 0).length;

  return (
    <div className="space-y-3">
      {relevantEdges === 0 && (
        <div
          className="rounded-md px-3 py-2 text-[10px] leading-4"
          style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
        >
          <strong style={{ color: 'var(--stone-300)' }}>No ordering recorded</strong> for these
          tasks — every one below is eligible for checkout right now. Ordering is written
          automatically when you approve a PRD backlog (the synthesizer names each story&rsquo;s
          prerequisites), or you can propose it for an existing backlog with{' '}
          <code style={{ color: '#F5A623' }}>
            npx tsx scripts/propose-task-dependencies.ts --project {tasks[0] ? '<project-id>' : ''}
          </code>
          , then prune it here.
        </div>
      )}
      {layers.map((layer, index) => (
        <div key={index}>
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: index === 0 ? '#3D8B5C20' : 'var(--dark-surface2)',
                color: index === 0 ? '#3D8B5C' : 'var(--stone-500)',
              }}
            >
              {index === 0 ? 'eligible now' : `after layer ${index - 1}`}
            </span>
            <span className="text-[9px] font-mono" style={{ color: 'var(--stone-600)' }}>
              {layer.length} task{layer.length === 1 ? '' : 's'}
            </span>
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
          >
            {layer.map(({ task, waitingOn }) => {
              const sc = STATUS_COLORS[task.status] ?? STATUS_COLORS.backlog;
              const cancelledBlockers = waitingOn.filter(
                (link) => link.dependsOnStatus === 'cancelled',
              );
              return (
                <div
                  key={task.id}
                  className="rounded-lg p-3"
                  style={{
                    background: 'var(--dark-surface)',
                    border: `1px solid ${index === 0 ? `${sc.fg}44` : 'var(--dark-border)'}`,
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: sc.bg, color: sc.fg }}
                    >
                      {task.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[9px] font-mono" style={{ color: 'var(--stone-600)' }}>
                      {task.priority}
                    </span>
                  </div>
                  <Link href={`/tasks/${task.id}`}>
                    <p
                      className="text-[12px] font-medium leading-snug hover:underline"
                      style={{ color: '#ECEAE4' }}
                    >
                      {task.title}
                    </p>
                  </Link>
                  <p className="mt-1 text-[9px] font-mono" style={{ color: 'var(--stone-600)' }}>
                    {task.assignedAgent?.name ?? 'Unassigned'}
                  </p>
                  {(linksByTask.get(task.id)?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {linksByTask.get(task.id)!.map((link) => (
                        <DependencyEdgeControl
                          key={link.dependsOnTaskId}
                          taskId={link.taskId}
                          dependsOnTaskId={link.dependsOnTaskId}
                          dependsOnTitle={link.dependsOnTitle}
                          satisfied={link.satisfied}
                        />
                      ))}
                    </div>
                  )}
                  {cancelledBlockers.length > 0 && (
                    <p
                      className="mt-1.5 flex items-start gap-1 text-[9px] leading-3"
                      style={{ color: '#C27D1A' }}
                    >
                      <AlertTriangle size={9} className="mt-px shrink-0" />
                      Waits on a cancelled task — re-point or delete the edge, or this never runs.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * C.3 — "is the tree healthy" at a glance. The branch lifecycle only holds if
 * the shared working tree is clean between tasks; quarantine branches are the
 * receipt that leftovers were preserved rather than discarded.
 */
function WorkspaceCard({ overview }: { overview: WorkspaceOverview }) {
  if (!overview.available) {
    return (
      <p className="text-xs" style={{ color: overview.error ? '#C27D1A' : 'var(--stone-500)' }}>
        {overview.error
          ? `Workspace state unavailable — ${overview.error}`
          : 'No connected workspace.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded"
          style={{ background: 'var(--dark-surface2)', color: '#ECEAE4' }}
        >
          <GitBranch size={11} style={{ color: 'var(--stone-500)' }} />
          {overview.branch ?? 'detached HEAD'}
        </span>
        <span
          className="text-[10px] font-mono px-2 py-1 rounded"
          style={{
            background: overview.dirty ? '#C27D1A20' : '#3D8B5C20',
            color: overview.dirty ? '#C27D1A' : '#3D8B5C',
          }}
        >
          {overview.dirty ? `${overview.changes.length} uncommitted change(s)` : 'clean'}
        </span>
        {overview.baseBranch && (
          <span className="text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
            base: {overview.baseBranch}
          </span>
        )}
        {overview.taskBranches.length > 0 && (
          <span className="text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
            {overview.taskBranches.length} task branch(es)
          </span>
        )}
      </div>

      {overview.dirty && (
        <p className="text-[10px] leading-4" style={{ color: 'var(--stone-500)' }}>
          The next run will move these onto a quarantine branch before it starts — nothing is
          discarded, but they are not part of any task&rsquo;s work yet.
        </p>
      )}

      {overview.quarantineBranches.length > 0 && (
        <div>
          <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: '#C27D1A' }}>
            Quarantined work
          </p>
          <div className="flex flex-wrap gap-1">
            {overview.quarantineBranches.map((branch) => (
              <span
                key={branch}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: '#C27D1A18', color: '#C27D1A' }}
                title={`Recover with: git checkout ${branch}`}
              >
                {branch}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The project-level answer to "what is in flight, in what order, and what
 * depends on what" — the flat task list could not answer any of the three.
 */
export function ProjectFlightView({
  tasks,
  links,
  workspace,
}: {
  tasks: FlightViewTask[];
  links: DependencyLink[];
  workspace: WorkspaceOverview;
}) {
  const inFlight = tasks.filter((task) =>
    (IN_FLIGHT_STATUSES as readonly string[]).includes(task.status),
  );
  const planned = tasks.filter((task) =>
    (PLANNED_STATUSES as readonly string[]).includes(task.status),
  );
  const plannedIds = new Set(planned.map((task) => task.id));
  const plannedEdgeCount = links.filter((link) => plannedIds.has(link.taskId)).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>In flight</SectionLabel>
          <span className="text-[10px] font-mono" style={{ color: 'var(--stone-600)' }}>
            running · in review · waiting on you
          </span>
        </div>
        <InFlightStrip tasks={inFlight} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>Execution plan</SectionLabel>
          <span className="text-[10px] font-mono" style={{ color: 'var(--stone-600)' }}>
            {plannedEdgeCount > 0
              ? `${plannedEdgeCount} dependency edge${plannedEdgeCount === 1 ? '' : 's'} · layered by dependency, then priority and age`
              : 'ordered by priority, then age'}
          </span>
        </div>
        <ExecutionPlan tasks={planned} links={links} />
      </div>

      <div
        className="rounded-lg p-4 space-y-3"
        style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
      >
        <SectionLabel>Workspace</SectionLabel>
        <WorkspaceCard overview={workspace} />
      </div>
    </div>
  );
}
