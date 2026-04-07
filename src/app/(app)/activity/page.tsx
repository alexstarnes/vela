export const dynamic = 'force-dynamic';

import { db } from '@/lib/db';
import { taskEvents } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { ActivityFeedClient } from './activity-feed';

export default async function ActivityPage() {
  // Load last 100 events for initial render
  const recentEvents = await db.query.taskEvents.findMany({
    orderBy: [desc(taskEvents.createdAt)],
    limit: 100,
    with: {
      agent: true,
      task: true,
    },
  });

  // Transform to serializable shape (reverse to chronological)
  const initialEvents = recentEvents.reverse().map((ev) => ({
    id: ev.id,
    taskId: ev.taskId,
    taskTitle: (ev as { task?: { title?: string } }).task?.title ?? null,
    agentName: (ev as { agent?: { name?: string } }).agent?.name ?? null,
    eventType: ev.eventType,
    payload: ev.payload as Record<string, unknown> | null,
    tokensUsed: ev.tokensUsed,
    costUsd: ev.costUsd,
    createdAt: ev.createdAt.toISOString(),
  }));

  return <ActivityFeedClient initialEvents={initialEvents} />;
}
