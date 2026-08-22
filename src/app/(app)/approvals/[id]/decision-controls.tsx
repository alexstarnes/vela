'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, XCircle } from 'lucide-react';
import { approveApproval, rejectApproval } from '@/lib/actions/approvals';

const MAX_NOTES_LENGTH = 1000;

interface DecisionControlsProps {
  approvalId: string;
  status: string;
  reviewerNotes: string | null;
  resolvedAt: Date | null;
}

export function DecisionControls({
  approvalId,
  status: initialStatus,
  reviewerNotes: initialReviewerNotes,
  resolvedAt: initialResolvedAt,
}: DecisionControlsProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [reviewerNotes, setReviewerNotes] = useState(initialReviewerNotes);
  const [resolvedAt, setResolvedAt] = useState(initialResolvedAt);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDecision(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const notes = feedback.trim() || undefined;
      const fn = action === 'approve' ? approveApproval : rejectApproval;
      const result = await fn({ approvalId, reviewerNotes: notes });

      if (!result.success) {
        setError(result.error);
        return;
      }

      setStatus(action === 'approve' ? 'approved' : 'rejected');
      setReviewerNotes(notes ?? null);
      setResolvedAt(new Date());
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (status !== 'pending') {
    const resolvedColor = status === 'approved' ? '#3D8B5C' : '#C4413A';
    return (
      <div
        className="sticky top-0 z-20 px-6 py-3 border-b backdrop-blur"
        style={{ background: 'rgba(17,17,16,0.92)', borderColor: 'var(--dark-border)' }}
      >
        <p className="text-[11px] font-mono" style={{ color: resolvedColor }}>
          {status === 'approved' ? 'Approved' : 'Rejected'}
          {resolvedAt && (
            <span style={{ color: 'var(--stone-600)' }}> · {new Date(resolvedAt).toLocaleString()}</span>
          )}
          {reviewerNotes && (
            <span style={{ color: 'var(--stone-400)' }}> — &ldquo;{reviewerNotes}&rdquo;</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      className="sticky top-0 z-20 px-6 py-3 border-b backdrop-blur space-y-2"
      style={{ background: 'rgba(17,17,16,0.92)', borderColor: 'var(--dark-border)' }}
    >
      <textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value.slice(0, MAX_NOTES_LENGTH))}
        maxLength={MAX_NOTES_LENGTH}
        rows={2}
        placeholder="Optional feedback — routed to the synthesizer on rejection, recorded on the approval either way"
        disabled={busy !== null}
        className="w-full rounded-md px-3 py-2 text-[11px] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
        style={{
          background: 'var(--dark-surface2)',
          border: '1px solid var(--dark-border)',
          color: '#ECEAE4',
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono" style={{ color: 'var(--stone-600)' }}>
            {feedback.length}/{MAX_NOTES_LENGTH}
          </span>
          {error && (
            <span className="text-[9px] font-mono" style={{ color: '#C4413A' }}>
              {error}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => handleDecision('approve')}
            disabled={busy !== null}
            className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            style={{ background: '#3D8B5C20', color: '#3D8B5C', border: '1px solid #3D8B5C40' }}
          >
            <CheckCircle size={12} />
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={() => handleDecision('reject')}
            disabled={busy !== null}
            className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            style={{ background: '#C4413A20', color: '#C4413A', border: '1px solid #C4413A40' }}
          >
            <XCircle size={12} />
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
