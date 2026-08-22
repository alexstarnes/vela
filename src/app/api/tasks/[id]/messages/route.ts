/**
 * POST /api/tasks/[id]/messages — append a human comment to a task's event log.
 *
 * Used by external surfaces (the Discord bot forwards message replies here).
 * Auth: session cookie via middleware, like every other API route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';

const BodySchema = z.object({
  content: z.string().min(1).max(10000),
  author: z.string().max(200).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ success: false, error: 'Invalid task id' }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') },
        { status: 400 },
      );
    }

    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
    if (!task) {
      return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });
    }

    await logTaskEvent({
      taskId: id,
      eventType: 'message',
      payload: {
        role: 'user',
        content: parsed.data.content,
        author: parsed.data.author ?? null,
        via: 'api',
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
