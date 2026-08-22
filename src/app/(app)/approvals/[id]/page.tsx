export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, AlertTriangle, ListChecks } from 'lucide-react';
import { getApproval } from '@/lib/actions/approvals';
import { listDocumentRevisions } from '@/lib/documents';
import { MarkdownDocument } from '@/components/document-viewer/markdown-document';
import { DecisionControls } from './decision-controls';
import { diffLines, diffCounts, collapseUnchangedRuns, type DiffOp } from './diff';

// ─── Payload shapes (from critique-ring-workflow.ts ring-gate step) ──

interface PrdBacklogItem {
  title?: string;
  description?: string;
  acceptance_criteria?: string[];
  source_findings?: string[];
}

interface ReconciliationEntry {
  finding_ref?: string;
  disposition?: 'accepted' | 'rejected' | 'deferred' | string;
  reason?: string;
  resulting_change?: string;
}

interface EscalationPosition {
  reviewer?: string;
  position?: string;
}

interface Escalation {
  conflict?: string;
  positions?: EscalationPosition[];
  recommendation?: string;
}

interface PrdBacklogPayload {
  prd_revision?: number;
  reviewed_revision?: number;
  backlog?: PrdBacklogItem[];
  reconciliation?: ReconciliationEntry[];
  escalations?: Escalation[];
  reviewer_lanes?: Array<{ reviewer?: string; lane?: string; model?: string }>;
  project_id?: string | null;
}

// ─── Color maps (idiom shared with tasks/[id]/page.tsx) ──────────────

const APPROVAL_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#C27D1A20', fg: '#C27D1A' },
  approved: { bg: '#3D8B5C20', fg: '#3D8B5C' },
  rejected: { bg: '#C4413A20', fg: '#C4413A' },
};

const DISPOSITION_COLORS: Record<string, { bg: string; fg: string }> = {
  accepted: { bg: '#3D8B5C20', fg: '#3D8B5C' },
  rejected: { bg: '#C4413A20', fg: '#C4413A' },
  deferred: { bg: '#C27D1A20', fg: '#C27D1A' },
};

function diffRowStyle(type: DiffOp['type']): { background: string; color: string; opacity: number } {
  if (type === 'add') return { background: 'rgba(61,139,92,0.14)', color: '#8FCBA4', opacity: 1 };
  if (type === 'del') return { background: 'rgba(196,65,58,0.14)', color: '#E09A94', opacity: 1 };
  return { background: 'transparent', color: 'var(--stone-400)', opacity: 0.55 };
}

function gutterSymbol(type: DiffOp['type']): string {
  if (type === 'add') return '+';
  if (type === 'del') return '−'; // minus sign
  return '';
}

export default async function ApprovalReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const approval = await getApproval(id);

  if (!approval) {
    notFound();
  }

  const isPrdBacklog = approval.actionType === 'prd_backlog';
  const payload = (approval.payload ?? null) as unknown;
  const prdPayload = isPrdBacklog ? ((payload as PrdBacklogPayload) ?? {}) : null;

  // Compute the server-side line diff between the reviewed and revised PRD
  // revisions, when this is a prd_backlog approval tied to a task.
  let diffOps: DiffOp[] | null = null;
  let diffUnavailableReason: string | null = null;
  let revisedDocContent: string | null = null;

  if (isPrdBacklog && approval.taskId && prdPayload) {
    const revisions = await listDocumentRevisions(approval.taskId, 'prd');
    const oldDoc = revisions.find((r) => r.revision === prdPayload.reviewed_revision);
    const newDoc = revisions.find((r) => r.revision === prdPayload.prd_revision);

    if (oldDoc && newDoc) {
      diffOps = diffLines(oldDoc.contentMd, newDoc.contentMd);
      revisedDocContent = newDoc.contentMd;
    } else {
      diffUnavailableReason = `Revision ${prdPayload.reviewed_revision} or ${prdPayload.prd_revision} not found in this task's document history.`;
      revisedDocContent = newDoc?.contentMd ?? null;
    }
  }

  const statusColor = APPROVAL_STATUS_COLORS[approval.status] ?? APPROVAL_STATUS_COLORS.pending;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--dark-border)' }}>
        <div className="flex items-center gap-1 mb-1.5">
          {approval.taskId ? (
            <Link href={`/tasks/${approval.taskId}`} style={{ color: 'var(--stone-500)' }}>
              <ChevronLeft size={14} strokeWidth={1.5} />
            </Link>
          ) : (
            <ChevronLeft size={14} strokeWidth={1.5} style={{ color: 'var(--stone-700)' }} />
          )}
          <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>
            Approvals / {approval.id.slice(0, 8)}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-lg font-bold tracking-tight max-w-3xl" style={{ color: '#ECEAE4' }}>
            {approval.description}
          </h1>
          <span
            className="inline-block shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider"
            style={{ background: statusColor.bg, color: statusColor.fg }}
          >
            {approval.status}
          </span>
        </div>

        <div
          className="flex items-center gap-4 mt-2 text-[10px] font-mono flex-wrap"
          style={{ color: 'var(--stone-500)' }}
        >
          <span
            className="px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
            style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
          >
            {approval.actionType.replace(/_/g, ' ')}
          </span>
          <span>
            Requested by{' '}
            <strong style={{ color: '#ECEAE4' }}>{approval.agent?.name ?? 'Unknown agent'}</strong>
          </span>
          {approval.task && (
            <span>
              Task:{' '}
              <Link href={`/tasks/${approval.task.id}`} className="underline" style={{ color: '#F5A623' }}>
                {approval.task.title}
              </Link>
              {approval.task.project?.name ? ` · ${approval.task.project.name}` : ''}
            </span>
          )}
          <span>Created {new Date(approval.createdAt).toLocaleString()}</span>
          {approval.resolvedAt && <span>Resolved {new Date(approval.resolvedAt).toLocaleString()}</span>}
        </div>

        {approval.status !== 'pending' && approval.reviewerNotes && (
          <div
            className="mt-2.5 rounded-md px-3 py-2 text-[11px] max-w-2xl"
            style={{
              background: 'var(--dark-surface2)',
              border: '1px solid var(--dark-border)',
              color: 'var(--stone-300)',
            }}
          >
            <span className="font-mono uppercase tracking-wider text-[9px] block mb-0.5" style={{ color: 'var(--stone-500)' }}>
              Reviewer notes
            </span>
            {approval.reviewerNotes}
          </div>
        )}
      </div>

      {/* Decision bar */}
      <DecisionControls
        approvalId={approval.id}
        status={approval.status}
        reviewerNotes={approval.reviewerNotes}
        resolvedAt={approval.resolvedAt}
      />

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-5xl mx-auto space-y-9">
          {isPrdBacklog && prdPayload ? (
            <>
              {/* a. Escalations — loud, first */}
              {prdPayload.escalations && prdPayload.escalations.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={15} style={{ color: '#C27D1A' }} />
                    <p
                      className="text-xs font-mono uppercase tracking-wider font-bold"
                      style={{ color: '#C27D1A' }}
                    >
                      Escalations — {prdPayload.escalations.length} decision{prdPayload.escalations.length > 1 ? 's' : ''} deferred to you
                    </p>
                  </div>
                  <div className="space-y-4">
                    {prdPayload.escalations.map((escalation, index) => (
                      <div
                        key={index}
                        className="rounded-lg p-4"
                        style={{
                          background: '#C27D1A12',
                          border: '1.5px solid #C27D1A55',
                        }}
                      >
                        <p className="text-sm font-semibold mb-3" style={{ color: '#ECEAE4' }}>
                          {escalation.conflict ?? 'Unlabeled conflict'}
                        </p>
                        <div className="space-y-2 mb-3">
                          {(escalation.positions ?? []).map((position, positionIndex) => (
                            <blockquote
                              key={positionIndex}
                              className="rounded-md px-3 py-2 text-[12px] leading-6"
                              style={{
                                background: 'var(--dark-surface2)',
                                borderLeft: '2px solid var(--stone-500)',
                                color: 'var(--stone-300)',
                              }}
                            >
                              <span
                                className="block text-[9px] font-mono uppercase tracking-wider mb-0.5"
                                style={{ color: 'var(--stone-500)' }}
                              >
                                {position.reviewer ?? 'Reviewer'}
                              </span>
                              {position.position}
                            </blockquote>
                          ))}
                        </div>
                        <div
                          className="rounded-md px-3 py-2"
                          style={{ background: '#F5A62318', border: '1px solid #F5A62345' }}
                        >
                          <span
                            className="block text-[9px] font-mono uppercase tracking-wider mb-0.5 font-bold"
                            style={{ color: '#F5A623' }}
                          >
                            Synthesizer recommendation
                          </span>
                          <p className="text-[12px] leading-6" style={{ color: '#ECEAE4' }}>
                            {escalation.recommendation}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* b. What changed in the PRD */}
              <section>
                <p
                  className="text-[9px] font-mono uppercase tracking-wider mb-2"
                  style={{ color: 'var(--stone-500)' }}
                >
                  What changed in the PRD
                </p>

                {diffOps ? (
                  (() => {
                    const { added, removed } = diffCounts(diffOps);
                    const rows = collapseUnchangedRuns(diffOps, 8);
                    return (
                      <>
                        <p className="text-[10px] font-mono mb-2" style={{ color: 'var(--stone-500)' }}>
                          revision {prdPayload.reviewed_revision} → {prdPayload.prd_revision} ·{' '}
                          <span style={{ color: '#8FCBA4' }}>+{added}</span>{' '}
                          <span style={{ color: '#E09A94' }}>&minus;{removed}</span> lines
                        </p>
                        <div
                          className="overflow-x-auto rounded-lg border font-mono text-[11px] leading-5"
                          style={{ borderColor: 'var(--dark-border)' }}
                        >
                          {rows.map((row) =>
                            row.kind === 'collapsed' ? (
                              <div
                                key={row.key}
                                className="px-3 py-1 text-center text-[10px]"
                                style={{ background: 'var(--dark-surface2)', color: 'var(--stone-600)' }}
                              >
                                ⋯ {row.count} unchanged lines
                              </div>
                            ) : (
                              <div key={row.key} className="flex" style={{ background: diffRowStyle(row.op.type).background }}>
                                <span
                                  className="w-5 shrink-0 text-center select-none"
                                  style={{ color: diffRowStyle(row.op.type).color }}
                                >
                                  {gutterSymbol(row.op.type)}
                                </span>
                                <span
                                  className="whitespace-pre px-1"
                                  style={{
                                    color: diffRowStyle(row.op.type).color,
                                    opacity: diffRowStyle(row.op.type).opacity,
                                  }}
                                >
                                  {row.op.text || ' '}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <p
                    className="text-[11px] rounded-md px-3 py-2"
                    style={{
                      background: 'var(--dark-surface2)',
                      border: '1px solid var(--dark-border)',
                      color: 'var(--stone-500)',
                    }}
                  >
                    {diffUnavailableReason ?? 'Diff unavailable for this approval.'}
                  </p>
                )}
              </section>

              {/* c. Proposed backlog */}
              <section>
                <p
                  className="text-[9px] font-mono uppercase tracking-wider mb-3"
                  style={{ color: 'var(--stone-500)' }}
                >
                  Proposed backlog ({prdPayload.backlog?.length ?? 0} items)
                </p>
                <div className="space-y-3">
                  {(prdPayload.backlog ?? []).map((item, index) => (
                    <div
                      key={index}
                      className="rounded-lg p-3.5"
                      style={{ background: 'var(--dark-surface2)', border: '1px solid var(--dark-border)' }}
                    >
                      <p className="text-sm font-semibold mb-1" style={{ color: '#ECEAE4' }}>
                        {item.title ?? `Backlog item ${index + 1}`}
                      </p>
                      {item.description && (
                        <p className="text-[12px] leading-6 mb-2.5" style={{ color: 'var(--stone-300)' }}>
                          {item.description}
                        </p>
                      )}
                      {item.acceptance_criteria && item.acceptance_criteria.length > 0 && (
                        <div className="mb-2.5">
                          <span
                            className="block text-[9px] font-mono uppercase tracking-wider mb-1"
                            style={{ color: 'var(--stone-500)' }}
                          >
                            Acceptance criteria
                          </span>
                          <ul className="space-y-1">
                            {item.acceptance_criteria.map((criterion, criterionIndex) => (
                              <li
                                key={criterionIndex}
                                className="flex items-start gap-1.5 text-[12px] leading-5"
                                style={{ color: 'var(--stone-300)' }}
                              >
                                <ListChecks size={12} className="mt-0.5 shrink-0" style={{ color: '#3D8B5C' }} />
                                {criterion}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {item.source_findings && item.source_findings.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.source_findings.map((ref, refIndex) => (
                            <span
                              key={refIndex}
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--dark-bg)', color: 'var(--stone-500)' }}
                            >
                              {ref}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* d. Reconciliation — collapsed by default */}
              <details className="group">
                <summary
                  className="text-[9px] font-mono uppercase tracking-wider mb-3 cursor-pointer select-none list-none flex items-center gap-1.5"
                  style={{ color: 'var(--stone-500)' }}
                >
                  <span className="group-open:rotate-90 inline-block transition-transform">▸</span>
                  Reconciliation ({prdPayload.reconciliation?.length ?? 0} findings)
                </summary>
                <div
                  className="overflow-x-auto rounded-lg border mt-2"
                  style={{ borderColor: 'var(--dark-border)' }}
                >
                  <table className="w-full border-collapse text-left text-[11px]">
                    <thead style={{ background: 'var(--dark-surface2)' }}>
                      <tr>
                        {['Finding', 'Disposition', 'Reason', 'Resulting change'].map((header) => (
                          <th
                            key={header}
                            className="px-3 py-2 font-mono uppercase tracking-wider text-[9px] border-b"
                            style={{ borderColor: 'var(--dark-border)', color: 'var(--stone-500)' }}
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(prdPayload.reconciliation ?? []).map((entry, index) => {
                        const dispositionColor =
                          DISPOSITION_COLORS[entry.disposition ?? ''] ?? DISPOSITION_COLORS.deferred;
                        return (
                          <tr key={index} className="align-top">
                            <td
                              className="px-3 py-2 font-mono border-b"
                              style={{ borderColor: 'var(--dark-border)', color: 'var(--stone-400)' }}
                            >
                              {entry.finding_ref}
                            </td>
                            <td className="px-3 py-2 border-b" style={{ borderColor: 'var(--dark-border)' }}>
                              <span
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded-full uppercase"
                                style={{ background: dispositionColor.bg, color: dispositionColor.fg }}
                              >
                                {entry.disposition}
                              </span>
                            </td>
                            <td
                              className="px-3 py-2 border-b leading-5"
                              style={{ borderColor: 'var(--dark-border)', color: 'var(--stone-300)' }}
                            >
                              {entry.reason}
                            </td>
                            <td
                              className="px-3 py-2 border-b leading-5"
                              style={{ borderColor: 'var(--dark-border)', color: 'var(--stone-300)' }}
                            >
                              {entry.resulting_change}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>

              {/* e. Full revised PRD — collapsed by default */}
              <details className="group">
                <summary
                  className="text-[9px] font-mono uppercase tracking-wider mb-3 cursor-pointer select-none list-none flex items-center gap-1.5"
                  style={{ color: 'var(--stone-500)' }}
                >
                  <span className="group-open:rotate-90 inline-block transition-transform">▸</span>
                  Full revised PRD (revision {prdPayload.prd_revision})
                </summary>
                <div className="mt-3">
                  {revisedDocContent ? (
                    <MarkdownDocument
                      markdown={revisedDocContent}
                      sourceLabel={`documents key=prd revision=${prdPayload.prd_revision}`}
                    />
                  ) : (
                    <p
                      className="text-[11px] rounded-md px-3 py-2"
                      style={{
                        background: 'var(--dark-surface2)',
                        border: '1px solid var(--dark-border)',
                        color: 'var(--stone-500)',
                      }}
                    >
                      Revision {prdPayload.prd_revision} was not found in this task&apos;s document history.
                    </p>
                  )}
                </div>
              </details>
            </>
          ) : (
            <section>
              <p className="text-sm leading-6 mb-4" style={{ color: 'var(--stone-300)' }}>
                {approval.description}
              </p>
              <p
                className="text-[9px] font-mono uppercase tracking-wider mb-2"
                style={{ color: 'var(--stone-500)' }}
              >
                Payload
              </p>
              <pre
                className="overflow-x-auto rounded-lg border p-4 text-[11px] leading-5 font-mono"
                style={{ borderColor: 'var(--dark-border)', background: 'var(--dark-surface2)', color: 'var(--stone-300)' }}
              >
                {payload ? JSON.stringify(payload, null, 2) : 'No payload.'}
              </pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
