import Link from 'next/link';
import { ArrowRight, FileText, GitCompareArrows } from 'lucide-react';
import { getWorkspaceGitDiff } from '@/lib/helper/client';
import type { TaskDocumentSummary } from '@/lib/documents';

interface ReviewEventLike {
  eventType: string;
  payload: unknown;
  createdAt: Date;
}

interface ApprovalLike {
  id: string;
  actionType: string;
  status: string;
  description: string;
}

/**
 * "What you're reviewing" — rendered only while the task sits at `review`.
 * The status controls in the header decide; this panel shows the deliverable
 * so the decision is informed: document revisions for product tasks, the live
 * workspace diff for code tasks, and the reviewer/verification verdicts.
 */
export async function ReviewPanel({
  taskId,
  documents,
  approvals,
  events,
  workspacePath,
}: {
  taskId: string;
  documents: TaskDocumentSummary[];
  approvals: ApprovalLike[];
  events: ReviewEventLike[];
  workspacePath: string | null;
}) {
  const latestOf = (type: string) =>
    [...events].reverse().find((e) => e.eventType === type)?.payload as
      | Record<string, unknown>
      | undefined;

  const review = latestOf('review');
  const verification = latestOf('verification');
  const audit = latestOf('implementation_audit');
  const changedFiles = Array.isArray(audit?.changedFiles) ? (audit.changedFiles as string[]) : [];

  // Live workspace diff for code tasks — best-effort: the helper may be down
  // or the workspace already cleaned; the audit summary still renders.
  let workspaceDiff: string | null = null;
  if (workspacePath && changedFiles.length > 0) {
    try {
      const { stdout } = await getWorkspaceGitDiff({ workspacePath });
      workspaceDiff = stdout.trim() ? stdout : null;
    } catch {
      workspaceDiff = null;
    }
  }

  return (
    <div
      className="mb-4 rounded-lg p-4"
      style={{ background: '#7C3AED12', border: '1.5px solid #7C3AED55' }}
    >
      <p className="text-xs font-mono uppercase tracking-wider font-bold mb-3" style={{ color: '#7C3AED' }}>
        Ready for your review
      </p>

      {/* Deliverable documents */}
      {documents.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {documents.map((doc) => (
            <Link
              key={doc.key}
              href={`/tasks/${taskId}/documents/${doc.key}`}
              className="flex items-center gap-2 rounded-md px-3 py-2 group"
              style={{ background: 'var(--dark-surface2)', border: '1px solid var(--dark-border)' }}
            >
              <FileText size={13} style={{ color: '#F5A623' }} />
              <span className="text-[12px] font-medium group-hover:underline" style={{ color: '#ECEAE4' }}>
                {doc.key.toUpperCase()} — revision {doc.latestRevision}
              </span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
                {doc.revisionCount} revision{doc.revisionCount > 1 ? 's' : ''}
              </span>
              <ArrowRight size={11} className="ml-auto" style={{ color: 'var(--stone-500)' }} />
            </Link>
          ))}
        </div>
      )}

      {/* Verdicts */}
      {(review || verification) && (
        <div className="mb-3 text-[11px] leading-5 space-y-1" style={{ color: 'var(--stone-300)' }}>
          {verification && (
            <p>
              <span className="font-mono text-[9px] uppercase tracking-wider mr-1.5" style={{ color: 'var(--stone-500)' }}>
                Verification
              </span>
              {verification.status === 'pass' ? 'passed' : String(verification.status ?? 'unknown')}
              {typeof verification.policy === 'string' ? ` (${verification.policy} policy)` : ''}
            </p>
          )}
          {review && (
            <p>
              <span className="font-mono text-[9px] uppercase tracking-wider mr-1.5" style={{ color: 'var(--stone-500)' }}>
                Reviewer
              </span>
              {review.status === 'pass' ? 'no blocking findings' : 'requested rework'}
              {typeof review.findings === 'string' && review.findings.trim()
                ? ` — ${review.findings.slice(0, 300)}`
                : ''}
            </p>
          )}
        </div>
      )}

      {/* Code change under review */}
      {changedFiles.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: 'var(--stone-500)' }}>
            Changed files
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {changedFiles.map((file) => (
              <span
                key={file}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: 'var(--dark-surface2)', color: 'var(--stone-300)' }}
              >
                {file}
              </span>
            ))}
          </div>
          {workspaceDiff && (
            <details className="group">
              <summary
                className="text-[10px] font-mono cursor-pointer select-none list-none flex items-center gap-1.5"
                style={{ color: '#F5A623' }}
              >
                <GitCompareArrows size={11} />
                <span className="group-hover:underline">View workspace diff</span>
              </summary>
              <pre
                className="mt-2 overflow-x-auto rounded-lg border p-3 text-[10px] leading-4 font-mono max-h-96 overflow-y-auto"
                style={{
                  borderColor: 'var(--dark-border)',
                  background: 'var(--dark-bg)',
                  color: 'var(--stone-300)',
                }}
              >
                {workspaceDiff}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Related approvals (resolved ones keep their review pages) */}
      {approvals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {approvals.map((approval) => (
            <Link
              key={approval.id}
              href={`/approvals/${approval.id}`}
              className="text-[10px] font-mono px-2 py-1 rounded underline"
              style={{
                background: 'var(--dark-surface2)',
                color: approval.status === 'pending' ? '#C27D1A' : 'var(--stone-400)',
              }}
            >
              {approval.actionType.replace(/_/g, ' ')} · {approval.status}
            </Link>
          ))}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-4" style={{ color: 'var(--stone-500)' }}>
        Use the header controls to decide: <strong style={{ color: 'var(--stone-300)' }}>Approve</strong>{' '}
        marks the task done · <strong style={{ color: 'var(--stone-300)' }}>Request changes</strong>{' '}
        sends it back to the agent.
      </p>
    </div>
  );
}
