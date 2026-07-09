export type ExecutionTier = 'fast' | 'standard' | 'premium';
export type ModelSelectionKind =
  | 'direct'
  | 'tier_up'
  | 'local_fallback'
  | 'cli_fallback'
  | 'cloud_fallback';
export type ModelHealthState = 'online' | 'offline' | 'unknown';

/**
 * Execution lane preference: local models are free and private, CLI executes
 * under a flat-rate subscription, metered cloud APIs are the lane of last
 * resort. Lower rank wins when tiers are otherwise equal.
 */
export function laneRank(candidate: Pick<ModelSelectionCandidate, 'isLocal' | 'provider'>): number {
  if (candidate.isLocal) return 0;
  if (candidate.provider === 'cli') return 1;
  return 2;
}

/** Lanes whose availability depends on a live health probe (vs. a config flag). */
export function isHealthProbedLane(
  candidate: Pick<ModelSelectionCandidate, 'isLocal' | 'provider'>,
): boolean {
  return candidate.isLocal || candidate.provider === 'cli';
}

const TIER_ORDER: ExecutionTier[] = ['fast', 'standard', 'premium'];

export interface ModelSelectionCandidate {
  id: string;
  modelId: string;
  provider: string;
  tier: string;
  isLocal: boolean;
  isAvailable: boolean;
  healthState: ModelHealthState;
}

export interface ModelSelectionResult {
  selected: ModelSelectionCandidate;
  selectionKind: ModelSelectionKind;
  selectionReason: string;
}

export function normalizeTier(tier: string | null | undefined): ExecutionTier {
  if (tier === 'fast' || tier === 'premium') {
    return tier;
  }

  return 'standard';
}

export function tierRank(tier: string | null | undefined): number {
  return TIER_ORDER.indexOf(normalizeTier(tier));
}

function candidateScore(
  candidate: ModelSelectionCandidate,
  desiredTier: ExecutionTier,
  configuredId: string,
): [number, number, number, number] {
  const desiredRank = tierRank(desiredTier);
  const candidateRank = tierRank(candidate.tier);
  const meetsDesired = candidateRank >= desiredRank ? 0 : 1;
  const lanePenalty = laneRank(candidate);
  const distance = Math.abs(candidateRank - desiredRank);
  const configuredPenalty = candidate.id === configuredId ? 0 : 1;
  return [meetsDesired, lanePenalty, distance, configuredPenalty];
}

export function chooseModelCandidate(params: {
  configured: ModelSelectionCandidate;
  candidates: ModelSelectionCandidate[];
  desiredTier: ExecutionTier;
}): ModelSelectionResult {
  const viable = params.candidates.filter(
    (candidate) =>
      candidate.isAvailable &&
      (isHealthProbedLane(candidate) ? candidate.healthState === 'online' : true),
  );

  const pool = viable.length > 0 ? viable : [params.configured];
  const selected = [...pool].sort((a, b) => {
    const aScore = candidateScore(a, params.desiredTier, params.configured.id);
    const bScore = candidateScore(b, params.desiredTier, params.configured.id);
    return (
      aScore[0] - bScore[0] ||
      aScore[1] - bScore[1] ||
      aScore[2] - bScore[2] ||
      aScore[3] - bScore[3] ||
      // Deterministic tie-break so equal candidates don't depend on DB row
      // order ('claude-code' sorts before 'codex' and before 'gpt-*').
      a.modelId.localeCompare(b.modelId)
    );
  })[0]!;

  const configuredRank = tierRank(params.configured.tier);
  const selectedRank = tierRank(selected.tier);
  const selectionKind: ModelSelectionKind =
    selected.id === params.configured.id
      ? 'direct'
      : selectedRank > configuredRank
        ? 'tier_up'
        : selected.isLocal
          ? 'local_fallback'
          : selected.provider === 'cli'
            ? 'cli_fallback'
            : 'cloud_fallback';

  const laneLabel = selected.isLocal
    ? 'local-first candidate selected'
    : selected.provider === 'cli'
      ? 'subscription CLI candidate selected'
      : 'cloud candidate selected';
  const reasonParts = [`desired tier ${params.desiredTier}`, laneLabel];

  if (selected.id === params.configured.id) {
    reasonParts.push('configured model remained the best viable option');
  } else if (selectedRank > configuredRank) {
    reasonParts.push('higher-capability tier was required');
  } else if (selected.isLocal) {
    reasonParts.push('avoided downgrading from local execution to cloud');
  } else if (selected.provider === 'cli') {
    reasonParts.push('no healthy local candidate; CLI subscription preferred over metered API');
  } else {
    reasonParts.push('no healthy local or CLI candidate satisfied the selection policy');
  }

  return {
    selected,
    selectionKind,
    selectionReason: reasonParts.join('; '),
  };
}

export function isCapabilityIncrease(fromTier: string, toTier: string): boolean {
  return tierRank(toTier) > tierRank(fromTier);
}

export function desiredTierFromFailureHistory(params: {
  effectiveTier: string;
  failureCount: number;
  preserveRoutedTier: boolean;
}): ExecutionTier {
  const normalizedTier = normalizeTier(params.effectiveTier);
  if (params.preserveRoutedTier) {
    return normalizedTier;
  }

  if (params.failureCount >= 4) {
    return 'premium';
  }

  if (params.failureCount >= 2) {
    return TIER_ORDER[Math.min(tierRank(normalizedTier) + 1, TIER_ORDER.length - 1)];
  }

  return normalizedTier;
}
