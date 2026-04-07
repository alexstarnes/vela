/**
 * Embedded Mastra Singleton — used by Next.js API routes and the heartbeat scheduler.
 *
 * This is SEPARATE from src/mastra/ which is the standalone Mastra Studio scaffold.
 * This instance is lightweight: no storage, no observability, just the agent runtime.
 */

import { Mastra } from '@mastra/core/mastra';

let _mastra: Mastra | null = null;

/**
 * Get or create the singleton Mastra instance.
 * Agents are created dynamically by the agent-factory, not registered statically.
 */
export function getMastra(): Mastra {
  if (!_mastra) {
    _mastra = new Mastra({
      // No static agents — we create them dynamically per heartbeat
      agents: {},
    });
  }
  return _mastra;
}
