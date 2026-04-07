'use client';

import { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { approveApproval, rejectApproval } from '@/lib/actions/approvals';
import { useRouter } from 'next/navigation';

interface Approval {
  id: string;
  actionType: string;
  description: string;
  status: string;
  payload: unknown;
  createdAt: Date;
}

interface ApprovalPanelProps {
  approvals: Approval[];
  taskId: string;
}

export function ApprovalPanel({ approvals: initialApprovals, taskId }: ApprovalPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [approvalsList, setApprovalsList] = useState(initialApprovals);
  const router = useRouter();

  const pending = approvalsList.filter((a) => a.status === 'pending');

  if (pending.length === 0) return null;

  async function handleApprove(approvalId: string) {
    setBusy(approvalId);
    try {
      await approveApproval({ approvalId });
      setApprovalsList((prev) =>
        prev.map((a) => (a.id === approvalId ? { ...a, status: 'approved' } : a)),
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(approvalId: string) {
    setBusy(approvalId);
    try {
      await rejectApproval({ approvalId });
      setApprovalsList((prev) =>
        prev.map((a) => (a.id === approvalId ? { ...a, status: 'rejected' } : a)),
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <p
        className="text-[9px] font-mono uppercase tracking-wider mb-2"
        style={{ color: 'var(--stone-500)' }}
      >
        Pending Approvals
      </p>
      {pending.map((approval) => {
        const payload = approval.payload as Record<string, unknown> | null;
        const isBusy = busy === approval.id;

        return (
          <div
            key={approval.id}
            className="rounded-md p-2.5"
            style={{ background: '#C27D1A10', border: '1px solid #C27D1A40' }}
          >
            <p className="text-[10px] font-medium mb-1" style={{ color: '#ECEAE4' }}>
              {approval.description}
            </p>
            {payload && (
              <div className="text-[9px] font-mono mb-1.5" style={{ color: 'var(--stone-500)' }}>
                {payload.title != null && <div>Subtask: {String(payload.title)}</div>}
                {payload.assigned_agent_id != null && (
                  <div>Agent: {String(payload.assigned_agent_id).slice(0, 8)}</div>
                )}
              </div>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={() => handleApprove(approval.id)}
                disabled={isBusy}
                className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                style={{ background: '#3D8B5C20', color: '#3D8B5C' }}
              >
                <CheckCircle size={10} />
                {isBusy ? '...' : 'Approve'}
              </button>
              <button
                onClick={() => handleReject(approval.id)}
                disabled={isBusy}
                className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                style={{ background: '#C4413A20', color: '#C4413A' }}
              >
                <XCircle size={10} />
                {isBusy ? '...' : 'Reject'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
