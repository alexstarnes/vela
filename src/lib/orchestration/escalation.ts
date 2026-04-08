import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

const TIER_ORDER = ['fast', 'standard', 'premium'] as const;

export type ExecutionTier = (typeof TIER_ORDER)[number];

export function escalateTierFromFailureCount(
  tier: string,
  failureCount: number,
): ExecutionTier {
  const normalizedTier = (TIER_ORDER.includes(tier as ExecutionTier) ? tier : 'standard') as ExecutionTier;
  const currentIndex = TIER_ORDER.indexOf(normalizedTier);

  if (failureCount >= 4) {
    return 'premium';
  }

  if (failureCount >= 2) {
    return TIER_ORDER[Math.min(currentIndex + 1, TIER_ORDER.length - 1)];
  }

  return normalizedTier;
}

export async function incrementTaskFailureCount(taskId: string): Promise<number> {
  const [row] = await db
    .update(tasks)
    .set({
      failureCount: sql`${tasks.failureCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning({ failureCount: tasks.failureCount });

  return row?.failureCount ?? 0;
}

export async function resetTaskFailureCount(taskId: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      failureCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
}
