/**
 * POST /api/approvals/[id]/reject — Reject a pending approval request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rejectApproval } from '@/lib/actions/approvals';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const result = await rejectApproval({
      approvalId: id,
      reviewerNotes: body?.reviewerNotes,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
