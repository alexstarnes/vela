/**
 * GET /api/events/stream — Server-Sent Events (SSE) for live task events.
 *
 * Polls the database every 2 seconds and emits new task_events to all
 * connected clients. Clients can reconnect with Last-Event-ID header
 * to resume from where they left off.
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { taskEvents } from '@/lib/db/schema';
import { desc, gt } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const lastEventId = request.headers.get('last-event-id');

  // Convert lastEventId (timestamp string) to a date for filtering
  let sinceDate: Date;
  if (lastEventId) {
    sinceDate = new Date(lastEventId);
  } else {
    // Default: last 5 minutes of events on connect
    sinceDate = new Date(Date.now() - 5 * 60 * 1000);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let active = true;
      let lastTs = sinceDate;

      const send = (id: string, event: string, data: unknown) => {
        const chunk =
          `id: ${id}\n` +
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      // Send a connected ping
      send(new Date().toISOString(), 'connected', { ts: Date.now() });

      const poll = async () => {
        if (!active) return;

        try {
          const newEvents = await db.query.taskEvents.findMany({
            where: gt(taskEvents.createdAt, lastTs),
            orderBy: [desc(taskEvents.createdAt)],
            limit: 50,
            with: {
              agent: true,
              task: true,
            },
          });

          // Emit in chronological order
          const sorted = newEvents.reverse();
          for (const ev of sorted) {
            send(ev.createdAt.toISOString(), 'task_event', {
              id: ev.id,
              taskId: ev.taskId,
              taskTitle: (ev as { task?: { title?: string } }).task?.title ?? null,
              agentName: (ev as { agent?: { name?: string } }).agent?.name ?? null,
              eventType: ev.eventType,
              payload: ev.payload,
              tokensUsed: ev.tokensUsed,
              costUsd: ev.costUsd,
              createdAt: ev.createdAt.toISOString(),
            });
            lastTs = ev.createdAt;
          }
        } catch {
          // DB error — keep polling
        }

        if (active) {
          setTimeout(poll, 2000);
        }
      };

      // Start polling
      setTimeout(poll, 2000);

      // Keep alive ping every 30s
      const keepAlive = setInterval(() => {
        if (!active) {
          clearInterval(keepAlive);
          return;
        }
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 30000);

      request.signal.addEventListener('abort', () => {
        active = false;
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
