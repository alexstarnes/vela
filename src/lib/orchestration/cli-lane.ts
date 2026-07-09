/**
 * CLI execution lane state — deterministic helpers for routing implementation
 * work through subscription-backed coding CLIs (Claude Code, Codex).
 *
 * Subscription plans have rolling usage caps sized for interactive use, so an
 * autonomous fleet will hit them. When a run reports a cap (or the bridge is
 * unreachable), the lane enters a cooldown window during which the router
 * treats every CLI candidate as offline and falls back to metered API models.
 */

import type { CliName } from '@/lib/helper/client';

const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

function cooldownDurationMs(): number {
  const configured = Number(process.env.VELA_CLI_COOLDOWN_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COOLDOWN_MS;
}

/** cli name → epoch ms until which the lane is considered offline */
const cooldownUntil = new Map<CliName, number>();

export function setCliLaneCooldown(cli: CliName, durationMs?: number): void {
  cooldownUntil.set(cli, Date.now() + (durationMs ?? cooldownDurationMs()));
}

export function clearCliLaneCooldown(cli: CliName): void {
  cooldownUntil.delete(cli);
}

export function isCliLaneCoolingDown(cli: CliName): boolean {
  const until = cooldownUntil.get(cli);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldownUntil.delete(cli);
    return false;
  }
  return true;
}

export function cliLaneCooldownRemainingMs(cli: CliName): number {
  const until = cooldownUntil.get(cli);
  return until ? Math.max(0, until - Date.now()) : 0;
}

/**
 * Map a model_configs row (provider 'cli') to the CLI binary it runs on.
 * Convention: modelId 'claude-code[...]' → claude, 'codex[...]' → codex.
 */
export function cliNameForModelId(modelId: string): CliName {
  return modelId.startsWith('codex') ? 'codex' : 'claude';
}

/**
 * Optional model flag passed through to the CLI (`--model`). The bare
 * 'claude-code' / 'codex' ids use the CLI's configured default model.
 */
export function cliModelFlagForModelId(modelId: string): string | undefined {
  const [, flag] = modelId.split(':');
  return flag || undefined;
}

/** Failure kinds that should open the cooldown window and trigger API failover. */
export function isCliFailoverErrorKind(
  errorKind: string | null,
): errorKind is 'usage_limit' | 'auth' | 'timeout' {
  return errorKind === 'usage_limit' || errorKind === 'auth' || errorKind === 'timeout';
}
