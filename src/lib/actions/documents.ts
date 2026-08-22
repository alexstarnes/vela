'use server';

import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { appendDocumentRevision, PRD_DOCUMENT_KEY } from '@/lib/documents';
import { logTaskEvent } from '@/lib/events/logger';
import type { ActionResult } from './projects';

const AttachDocumentSchema = z.object({
  taskId: z.string().uuid(),
  key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Key must be lowercase letters, digits, and dashes'),
  contentMd: z.string().min(1, 'Document is empty').max(500_000, 'Document exceeds 500KB'),
});

/**
 * Operator-attached document revision. Appends the next revision for
 * (taskId, key); key 'prd' routes the task into the critique ring on its
 * next heartbeat.
 */
export async function attachDocument(
  input: z.infer<typeof AttachDocumentSchema>,
): Promise<ActionResult<{ key: string; revision: number }>> {
  const parsed = AttachDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { taskId, key, contentMd } = parsed.data;

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: { id: true },
  });
  if (!task) {
    return { success: false, error: 'Task not found' };
  }

  const revision = await appendDocumentRevision({
    taskId,
    key,
    contentMd,
    createdByAgentId: null,
  });

  await logTaskEvent({
    taskId,
    eventType: 'document_added',
    payload: {
      key,
      revision: revision.revision,
      length: contentMd.length,
      source: 'operator',
      routes_to_critique_ring: key === PRD_DOCUMENT_KEY,
    },
  });

  revalidatePath(`/tasks/${taskId}`);
  return { success: true, data: { key, revision: revision.revision } };
}
