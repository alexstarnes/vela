/**
 * Shared helpers for the governance exercise scripts (Phase 1 of the
 * completion plan). These scripts hit the live dev server + live DB — they
 * are exercises that produce event-log evidence, not isolated unit tests.
 *
 * Run from the repo root:  npx tsx tests/governance/<script>.ts
 */
import './load-env';
import { db } from '@/lib/db';
import { agents, tasks, taskEvents } from '@/lib/db/schema';
import { eq, and, desc, gt } from 'drizzle-orm';

export const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export { db, agents, tasks, taskEvents, eq, and, desc, gt };

export async function getAgentByName(name: string) {
  const row = await db.query.agents.findFirst({
    where: and(eq(agents.name, name), eq(agents.agentKind, 'runtime')),
  });
  if (!row) throw new Error(`Runtime agent "${name}" not found`);
  return row;
}

export type AgentBudgetSnapshot = {
  budgetMonthlyUsd: string | null;
  budgetUsedUsd: string;
  budgetMonthlyRuns: number | null;
  budgetUsedRuns: number;
  budgetResetAt: Date | null;
  status: string;
  maxIterations: number;
};

export async function snapshotAgentBudget(agentId: string): Promise<AgentBudgetSnapshot> {
  const row = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!row) throw new Error(`Agent ${agentId} not found`);
  return {
    budgetMonthlyUsd: row.budgetMonthlyUsd,
    budgetUsedUsd: row.budgetUsedUsd,
    budgetMonthlyRuns: row.budgetMonthlyRuns,
    budgetUsedRuns: row.budgetUsedRuns,
    budgetResetAt: row.budgetResetAt,
    status: row.status,
    maxIterations: row.maxIterations,
  };
}

export async function restoreAgentBudget(agentId: string, snap: AgentBudgetSnapshot) {
  await db.update(agents).set({ ...snap, updatedAt: new Date() }).where(eq(agents.id, agentId));
}

export async function login(): Promise<string> {
  const res = await fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.VELA_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('No session cookie returned');
  return setCookie.split(';')[0];
}

export async function triggerHeartbeatForTask(cookie: string, taskId: string) {
  const res = await fetch(`${APP_URL}/api/heartbeat?taskId=${taskId}`, {
    method: 'POST',
    headers: { cookie },
  });
  return res.json();
}

export async function triggerHeartbeatForAgent(cookie: string, agentId: string) {
  const res = await fetch(`${APP_URL}/api/heartbeat?agentId=${agentId}`, {
    method: 'POST',
    headers: { cookie },
  });
  return res.json();
}

export async function createTestTask(params: {
  projectId: string;
  agentId: string;
  title: string;
  description: string;
}): Promise<string> {
  const [task] = await db
    .insert(tasks)
    .values({
      title: params.title,
      description: params.description,
      projectId: params.projectId,
      assignedAgentId: params.agentId,
      priority: 'medium',
      status: 'open',
    })
    .returning({ id: tasks.id });
  return task.id;
}

export async function getProjectByName(name: string) {
  const row = await db.query.projects.findFirst({
    where: (p, { eq: eqOp }) => eqOp(p.name, name),
  });
  if (!row) throw new Error(`Project "${name}" not found`);
  return row;
}

export async function taskStatus(taskId: string): Promise<string> {
  const row = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!row) throw new Error(`Task ${taskId} not found`);
  return row.status;
}

export async function eventsOfType(taskId: string, eventType: string) {
  return db.query.taskEvents.findMany({
    where: and(eq(taskEvents.taskId, taskId), eq(taskEvents.eventType, eventType)),
    orderBy: [desc(taskEvents.createdAt)],
  });
}

export async function waitFor<T>(
  fn: () => Promise<T | null | false>,
  opts: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 3000));
  }
  throw new Error(`Timed out waiting for: ${opts.label}`);
}

export function evidence(label: string, data: unknown) {
  console.log(`\nEVIDENCE [${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

export async function closeDb() {
  // drizzle postgres-js client keeps the process alive; exit explicitly.
  process.exit(0);
}
