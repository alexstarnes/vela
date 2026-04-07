/**
 * POST /api/heartbeat — Manual heartbeat trigger.
 *
 * Query params:
 *   - taskId: run heartbeat for a specific task
 *   - agentId: run heartbeat for an agent (picks next open task)
 *
 * At least one of taskId or agentId must be provided.
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
      const result = await executeHeartbeatForTask(taskId);
      return NextResponse.json(result, {
        status: result.success ? 200 : 422,
      });
    }

    if (agentId) {
      const result = await executeHeartbeat(agentId);
      return NextResponse.json(result, {
        status: result.success ? 200 : 422,
      });
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
