/**
 * Documents — keyed, revisioned, append-only task documents.
 *
 * Revisions are never updated in place: appending a new revision is the only
 * write. Latest revision wins. Reserved key 'prd' routes a task into the
 * critique-ring workflow (product mode).
 */
import { db } from '@/lib/db';
import { documents, type Document } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export const PRD_DOCUMENT_KEY = 'prd';

export async function getLatestDocument(
  taskId: string,
  key: string,
): Promise<Document | null> {
  const row = await db.query.documents.findFirst({
    where: and(eq(documents.taskId, taskId), eq(documents.key, key)),
    orderBy: [desc(documents.revision)],
  });
  return row ?? null;
}

export async function listDocumentRevisions(
  taskId: string,
  key: string,
): Promise<Document[]> {
  return db.query.documents.findMany({
    where: and(eq(documents.taskId, taskId), eq(documents.key, key)),
    orderBy: [desc(documents.revision)],
  });
}

/**
 * Append the next revision for (taskId, key). Concurrency-safe: the unique
 * index on (task_id, key, revision) turns a lost race into a retryable
 * conflict instead of a silent duplicate revision.
 */
export async function appendDocumentRevision(params: {
  taskId: string;
  key: string;
  contentMd: string;
  createdByAgentId?: string | null;
}): Promise<Document> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await getLatestDocument(params.taskId, params.key);
    const nextRevision = (latest?.revision ?? 0) + 1;
    try {
      const [row] = await db
        .insert(documents)
        .values({
          taskId: params.taskId,
          key: params.key,
          contentMd: params.contentMd,
          revision: nextRevision,
          createdByAgentId: params.createdByAgentId ?? null,
        })
        .returning();
      return row;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/uq_documents_task_key_revision|duplicate key/i.test(message) || attempt === 2) {
        throw error;
      }
      // Revision race — re-read MAX(revision) and retry.
    }
  }
  throw new Error('appendDocumentRevision: unreachable');
}

/** Deterministic product-mode check: a task carrying a PRD document. */
export async function taskHasPrdDocument(taskId: string): Promise<boolean> {
  const row = await db.query.documents.findFirst({
    where: and(eq(documents.taskId, taskId), eq(documents.key, PRD_DOCUMENT_KEY)),
    columns: { id: true },
  });
  return Boolean(row);
}
