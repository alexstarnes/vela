/**
 * Phase 2 load test: /api/events/stream must deliver every task_event to
 * every concurrently-connected client, with no duplicates and no gaps, even
 * under a rapid burst of inserts and the route's 2s poll cadence.
 *
 * Requires a dev server already running at APP_URL (default
 * http://localhost:3000 — `npm run dev` in another terminal) and
 * VELA_PASSWORD set in the environment. This script does NOT start or stop
 * the server, and does not touch anything but its own scratch rows.
 *
 * The 100 task_events are inserted via 100 separate concurrent db.insert()
 * calls (not one bulk INSERT of 100 rows) so each row gets its own
 * transaction-scoped `now()` and therefore a distinct created_at. A single
 * bulk statement would give all 100 rows the identical timestamp, which
 * would make the stream's `ORDER BY created_at DESC LIMIT 50` pagination
 * non-deterministic for reasons unrelated to what this test is checking.
 * Firing 100 inserts concurrently is still a genuine burst — comfortably
 * faster than the route's 2s poll interval — which is what actually
 * exercises the backlog-draining path.
 *
 * Regression coverage for src/app/api/events/stream/route.ts.
 */
import '../governance/load-env';
import { db } from '@/lib/db';
import { projects, tasks, taskEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const CONNECTION_COUNT = 5;
const EVENT_COUNT = 100;
const CONNECT_SETTLE_MS = 1000;
const WAIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1000;

function evidence(label: string, data: unknown) {
  console.log(`\nEVIDENCE [${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

async function login(): Promise<string> {
  const res = await fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.VELA_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('No session cookie returned from /api/auth/login');
  return setCookie.split(';')[0];
}

type ParsedSSEEvent = { id?: string; event?: string; data?: string };

type ConnectionState = {
  idx: number;
  seqs: Set<number>;
  receivedRaw: number;
  connected: boolean;
  errors: string[];
};

async function readSSE(
  conn: ConnectionState,
  taskId: string,
  cookie: string,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${APP_URL}/api/events/stream`, {
      headers: { cookie, accept: 'text/event-stream' },
      signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return;
    conn.errors.push(`connect threw: ${String(err)}`);
    return;
  }

  if (!res.ok || !res.body) {
    conn.errors.push(`connect failed: ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        if (!rawEvent.trim() || rawEvent.startsWith(':')) continue; // keep-alive ping

        const parsed: ParsedSSEEvent = {};
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('id: ')) parsed.id = line.slice(4);
          else if (line.startsWith('event: ')) parsed.event = line.slice(7);
          else if (line.startsWith('data: ')) parsed.data = line.slice(6);
        }

        if (parsed.event === 'connected') {
          conn.connected = true;
          continue;
        }

        if (parsed.event === 'task_event' && parsed.data) {
          try {
            const payload = JSON.parse(parsed.data) as {
              taskId?: string;
              eventType?: string;
              payload?: { seq?: number };
            };
            if (
              payload.taskId === taskId &&
              payload.eventType === 'message' &&
              typeof payload.payload?.seq === 'number'
            ) {
              conn.receivedRaw += 1;
              conn.seqs.add(payload.payload.seq);
            }
          } catch (err) {
            conn.errors.push(`bad data JSON: ${String(err)}`);
          }
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name !== 'AbortError') {
      conn.errors.push(`stream read error: ${String(err)}`);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

async function main() {
  let projectId: string | null = null;
  let taskId: string | null = null;

  try {
    // ── Scratch fixtures: project + task to hang task_events off of ──
    const [project] = await db
      .insert(projects)
      .values({
        name: `Load Test SSE ${Date.now()}`,
        sourceType: 'manual',
        workspacePath: null,
        status: 'active',
      })
      .returning();
    projectId = project.id;

    const [task] = await db
      .insert(tasks)
      .values({
        projectId: project.id,
        title: `SSE load test scratch task ${Date.now()}`,
        description: 'Never executed — sse-under-load load test fixture.',
        status: 'open',
      })
      .returning();
    taskId = task.id;

    evidence('setup', {
      appUrl: APP_URL,
      projectId,
      taskId,
      connectionCount: CONNECTION_COUNT,
      eventCount: EVENT_COUNT,
    });

    // ── Auth ──
    const cookie = await login();

    // ── Open N concurrent SSE connections ──
    const connections: ConnectionState[] = Array.from({ length: CONNECTION_COUNT }, (_, idx) => ({
      idx,
      seqs: new Set<number>(),
      receivedRaw: 0,
      connected: false,
      errors: [],
    }));
    const controllers = connections.map(() => new AbortController());
    const readerPromises = connections.map((conn, i) =>
      readSSE(conn, taskId!, cookie, controllers[i].signal),
    );

    // Let connections establish (each should see the initial `connected`
    // ping) before we burst-insert events.
    await new Promise((r) => setTimeout(r, CONNECT_SETTLE_MS));

    evidence('connections-established', {
      connected: connections.map((c) => ({ idx: c.idx, connected: c.connected, errors: c.errors })),
    });

    // ── Rapid burst insert of 100 task_events (see file header for why
    // these are 100 separate concurrent inserts, not one bulk statement) ──
    await Promise.all(
      Array.from({ length: EVENT_COUNT }, (_, i) =>
        db.insert(taskEvents).values({
          taskId: taskId!,
          eventType: 'message',
          payload: { seq: i },
        }),
      ),
    );

    // ── Wait up to 30s for all connections to receive all 100 seqs ──
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    for (;;) {
      const allDone = connections.every((c) => c.seqs.size >= EVENT_COUNT);
      if (allDone || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // ── Stop the streams ──
    controllers.forEach((c) => c.abort());
    await Promise.allSettled(readerPromises);

    // ── Assertions ──
    const expectedSeqs = Array.from({ length: EVENT_COUNT }, (_, i) => i);
    const perConnection = connections.map((c) => {
      const missing = expectedSeqs.filter((s) => !c.seqs.has(s));
      const duplicateCount = c.receivedRaw - c.seqs.size;
      const complete = missing.length === 0 && duplicateCount === 0 && c.errors.length === 0;
      return {
        idx: c.idx,
        connected: c.connected,
        receivedRaw: c.receivedRaw,
        uniqueReceived: c.seqs.size,
        duplicateCount,
        missingCount: missing.length,
        missingSample: missing.slice(0, 10),
        errors: c.errors,
        complete,
      };
    });

    evidence('results', { perConnection });

    for (const r of perConnection) {
      console.log(
        r.complete
          ? `PASS [connection ${r.idx}]: received all ${EVENT_COUNT} seq values, no duplicates, no gaps`
          : `FAIL [connection ${r.idx}]: unique=${r.uniqueReceived}/${EVENT_COUNT} duplicates=${r.duplicateCount} missing=${r.missingCount}${r.missingCount ? ` (e.g. ${r.missingSample.join(', ')})` : ''}${r.errors.length ? ` errors: ${r.errors.join('; ')}` : ''}`,
      );
    }

    const pass = perConnection.every((r) => r.complete);
    console.log(
      pass
        ? 'PASS: all connections received the full 100-event burst with no duplicates or gaps'
        : 'FAIL: see per-connection results above',
    );
    process.exitCode = pass ? 0 : 1;
  } catch (err) {
    console.error('sse-under-load errored:', err);
    process.exitCode = 1;
  } finally {
    if (taskId) {
      await db.delete(taskEvents).where(eq(taskEvents.taskId, taskId));
      await db.delete(tasks).where(eq(tasks.id, taskId));
    }
    if (projectId) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
