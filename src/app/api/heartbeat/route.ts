/**
 * POST /api/heartbeat — Manual heartbeat trigger (fire-and-forget).
 *
 * Query params:
 *   - taskId: run heartbeat for a specific task
 *   - agentId: run heartbeat for an agent (picks next open task)
 *
 * At least one of taskId or agentId must be provided.
 * Returns immediately while the workflow runs in the background.
 * Real-time progress is delivered via the SSE event stream.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeHeartbeat, executeHeartbeatForTask } from '@/lib/mastra/heartbeat';

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const taskId = searchParams.get('taskId');
    const agentId = searchParams.get('agentId');

    if (!taskId && !agentId) {
      return NextResponse.json(
        { error: 'Either taskId or agentId query parameter is required' },
        { status: 400 },
      );
    }

    if (taskId) {
      // Fire-and-forget: run in the background so the API responds immediately.
      executeHeartbeatForTask(taskId).catch((err) => {
        console.error(`[api/heartbeat] Background task heartbeat failed for ${taskId}:`, err);
      });
      return NextResponse.json({ success: true, started: true, taskId });
    }

    if (agentId) {
      executeHeartbeat(agentId).catch((err) => {
        console.error(`[api/heartbeat] Background agent heartbeat failed for ${agentId}:`, err);
      });
      return NextResponse.json({ success: true, started: true, agentId });
    }

    return NextResponse.json({ error: 'Unreachable' }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/heartbeat] Unhandled error:', message);
    return NextResponse.json(
      { error: 'Internal server error', message },
      { status: 500 },
    );
  }
}
