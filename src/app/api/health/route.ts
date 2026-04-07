/**
 * GET /api/health — Process health + scheduler status.
 */

import { NextResponse } from 'next/server';
import { getSchedulerStatus } from '@/lib/mastra/scheduler';

export async function GET() {
  try {
    const scheduler = getSchedulerStatus();

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      scheduler,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: 'error', message },
      { status: 500 },
    );
  }
}
