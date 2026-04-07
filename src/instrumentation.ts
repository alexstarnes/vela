/**
 * Next.js Instrumentation — runs once on server start.
 *
 * Used to initialize the heartbeat scheduler (node-cron jobs)
 * so agents can process tasks on their configured schedules.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only initialize on the Node.js runtime (not edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeScheduler } = await import('@/lib/mastra/scheduler');
    await initializeScheduler();
    console.log('[instrumentation] Scheduler initialized');
  }
}
