/**
 * Loop Detector — per-task-run detection of repeated tool call signatures.
 *
 * Maintained in memory scoped to a single heartbeat execution.
 * Different tasks calling the same tool is fine — this only catches
 * the same task calling the identical tool+input combo 3+ times in one run.
 */

import crypto from 'crypto';

export class LoopDetectedError extends Error {
  constructor(
    public readonly signature: string,
    public readonly count: number,
  ) {
    super(
      `Loop detected: tool call "${signature}" repeated ${count} times in a single heartbeat run`,
    );
    this.name = 'LoopDetectedError';
  }
}

/**
 * Produces a deterministic hash for a tool call (name + serialized input).
 */
export function toolCallSignature(toolName: string, input: unknown): string {
  const raw = `${toolName}:${JSON.stringify(input)}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * In-memory tracker for a single heartbeat run.
 * Instantiate once per heartbeat execution, then call checkAndRecord
 * before / after each tool step.
 */
export class LoopTracker {
  private counts = new Map<string, number>();
  private readonly threshold: number;

  constructor(threshold = 3) {
    this.threshold = threshold;
  }

  /**
   * Record a tool call and throw LoopDetectedError if the threshold is met.
   * @param toolName  The tool's id/name
   * @param input     The tool's input arguments
   */
  checkAndRecord(toolName: string, input: unknown): void {
    const sig = toolCallSignature(toolName, input);
    const prev = this.counts.get(sig) ?? 0;
    const next = prev + 1;
    this.counts.set(sig, next);

    if (next >= this.threshold) {
      throw new LoopDetectedError(`${toolName}:${sig}`, next);
    }
  }

  /** Returns all recorded signatures and their counts (for debugging). */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts.entries());
  }
}
