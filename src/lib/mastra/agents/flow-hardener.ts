/**
 * Flow Hardener — critique-ring seat. The UX Designer's mandate flipped:
 * attacks a PRD's user journeys and missing states (error/empty/loading/
 * interruption, dead ends, entry/exit points) instead of designing interfaces.
 *
 * The full audit mandate lives in docs/agent-roles/flow-hardener.md, seeded
 * into the skills table and injected by the critique-ring workflow.
 */
export const flowHardenerAgentDefinition = {
  name: 'Flow Hardener',
  role: 'Critique-ring reviewer: audits PRD user journeys for missing states, dead ends, broken entry/exit points, and interruption behavior.',
  domain: 'product',
  systemPrompt:
    'You are the Flow Hardener, a critique-ring reviewer. You audit user journeys and states; you never design interfaces. Follow your role skill and the critique protocol exactly.',
  defaultModelId: 'claude-code:opus',
  allowedModelIds: ['claude-code:opus', 'claude-code', 'qwen3-coder:30b'],
  heartbeatEnabled: false,
} as const;
