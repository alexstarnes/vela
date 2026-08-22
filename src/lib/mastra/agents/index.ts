import { differentiationStrategistAgentDefinition } from './differentiation-strategist';
import { flowHardenerAgentDefinition } from './flow-hardener';
import { implementerAgentDefinition } from './implementer';
import { prdAuditorAgentDefinition } from './prd-auditor';
import { repoMapperAgentDefinition } from './repo-mapper';
import { reviewerAgentDefinition } from './reviewer';
import { supervisorAgentDefinition } from './supervisor';
import { synthesizerAgentDefinition } from './synthesizer';
import { verifierAgentDefinition } from './verifier';

export const runtimeAgentDefinitions = [
  supervisorAgentDefinition,
  repoMapperAgentDefinition,
  implementerAgentDefinition,
  reviewerAgentDefinition,
  verifierAgentDefinition,
  prdAuditorAgentDefinition,
  flowHardenerAgentDefinition,
  differentiationStrategistAgentDefinition,
  synthesizerAgentDefinition,
] as const;

/** The three independent critique-ring reviewer seats, in invocation order. */
export const ringReviewerNames = [
  'PRD Auditor',
  'Flow Hardener',
  'Differentiation Strategist',
] as const;

export type RuntimeAgentDefinition = (typeof runtimeAgentDefinitions)[number];
export type RuntimeAgentName = RuntimeAgentDefinition['name'];

export const runtimeAgentDefinitionByName = Object.fromEntries(
  runtimeAgentDefinitions.map((definition) => [definition.name, definition]),
) as Record<RuntimeAgentName, RuntimeAgentDefinition>;

export function getRuntimeAgentDefinition(
  agentName: string,
): RuntimeAgentDefinition | null {
  return (runtimeAgentDefinitionByName as Record<string, RuntimeAgentDefinition | undefined>)[agentName] ?? null;
}

export function isRuntimeAgentName(agentName: string): agentName is RuntimeAgentName {
  return agentName in runtimeAgentDefinitionByName;
}
