/**
 * Scheduler — manages node-cron jobs for agent heartbeats.
 *
 * - Initializes on app startup by loading all active agents with heartbeat_cron
 * - Supports dynamic rescheduling when agent config changes
 * - All jobs are tracked in memory (Map) keyed by agent ID
 */

import cron, { type ScheduledTask } from 'node-cron';
import { db } from '@/lib/db';
import { agents, tasks } from '@/lib/db/schema';
import { eq, and, lt, isNotNull, sql } from 'drizzle-orm';
import { executeHeartbeat } from './heartbeat';

// In-memory registry of active cron jobs, keyed by agent ID
const cronJobs = new Map<string, ScheduledTask>();

// Flag to prevent multiple initializations
let isInitialized = false;

/**
 * Initialize the scheduler by loading all active agents and creating cron jobs.
 * Should be called once on app startup.
 */
export async function initializeScheduler(): Promise<void> {
  if (isInitialized) {
    console.log('[scheduler] Already initialized, skipping');
    return;
  }

  try {
    const activeAgents = await db.query.agents.findMany({
      where: eq(agents.status, 'active'),
    });

    let scheduled = 0;
    for (const agent of activeAgents) {
      if (agent.heartbeatEnabled && agent.heartbeatCron) {
        scheduleAgent(agent.id, agent.heartbeatCron);
        scheduled++;
      }
    }

    // Schedule stale lock cleanup every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      cleanupStaleLocks().catch((err) => {
        console.error('[scheduler] Stale lock cleanup error:', err);
      });
    });

    isInitialized = true;
    console.log(
      `[scheduler] Initialized: ${scheduled} agents scheduled out of ${activeAgents.length} active (+ stale lock cleanup)`,
    );
  } catch (err) {
    console.error('[scheduler] Failed to initialize:', err);
    // Don't throw — scheduler failure should not prevent app startup
  }
}

/**
 * Schedule a single agent's heartbeat.
 */
function scheduleAgent(agentId: string, cronExpression: string): void {
  // Validate the cron expression
  if (!cron.validate(cronExpression)) {
    console.warn(
      `[scheduler] Invalid cron expression "${cronExpression}" for agent ${agentId}, skipping`,
    );
    return;
  }

  // Stop existing job if any
  stopAgent(agentId);

  const job = cron.schedule(cronExpression, () => {
    console.log(`[scheduler] Heartbeat triggered for agent ${agentId}`);
    // Fire and forget — errors handled inside executeHeartbeat
    executeHeartbeat(agentId).catch((err) => {
      console.error(`[scheduler] Unhandled heartbeat error for agent ${agentId}:`, err);
    });
  });

  cronJobs.set(agentId, job);
  console.log(`[scheduler] Scheduled agent ${agentId} with cron: ${cronExpression}`);
}

/**
 * Stop a single agent's cron job.
 */
function stopAgent(agentId: string): void {
  const existing = cronJobs.get(agentId);
  if (existing) {
    existing.stop();
    cronJobs.delete(agentId);
  }
}

/**
 * Reschedule an agent's heartbeat — call this when agent config changes.
 * Reloads the agent from DB and updates the cron job.
 */
export async function rescheduleAgent(agentId: string): Promise<void> {
  try {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });

    if (!agent) {
      // Agent deleted — stop any existing job
      stopAgent(agentId);
      return;
    }

    if (agent.status === 'active' && agent.heartbeatEnabled && agent.heartbeatCron) {
      scheduleAgent(agentId, agent.heartbeatCron);
    } else {
      // Agent paused or heartbeat disabled — stop the job
      stopAgent(agentId);
    }
  } catch (err) {
    console.error(`[scheduler] Failed to reschedule agent ${agentId}:`, err);
  }
}

/**
 * Stop all cron jobs. Call on graceful shutdown.
 */
export function stopAll(): void {
  for (const [agentId, job] of cronJobs) {
    job.stop();
    console.log(`[scheduler] Stopped agent ${agentId}`);
  }
  cronJobs.clear();
  isInitialized = false;
}

/**
 * Release locks on tasks stuck in in_progress with a locked_at older than 10 minutes.
 * Requeues them to open so they can be retried.
 */
async function cleanupStaleLocks(): Promise<void> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const staleTasks = await db
    .update(tasks)
    .set({ status: 'open', lockedBy: null, lockedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(tasks.status, 'in_progress'),
        isNotNull(tasks.lockedAt),
        lt(tasks.lockedAt, tenMinutesAgo),
      ),
    )
    .returning({ id: tasks.id });

  if (staleTasks.length > 0) {
    console.log(`[scheduler] Released ${staleTasks.length} stale task lock(s): ${staleTasks.map((t) => t.id).join(', ')}`);
  }
}

/**
 * Get the current scheduler status.
 */
export function getSchedulerStatus(): {
  isInitialized: boolean;
  activeJobs: number;
  agents: string[];
} {
  return {
    isInitialized,
    activeJobs: cronJobs.size,
    agents: Array.from(cronJobs.keys()),
  };
}
