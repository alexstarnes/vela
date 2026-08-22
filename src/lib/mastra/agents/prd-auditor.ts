/**
 * PRD Auditor — critique-ring seat. The Product Strategist's mandate flipped:
 * attacks requirements quality (untestable criteria, missing edge cases,
 * ambiguous scope) instead of authoring requirements.
 *
 * The full audit mandate lives in docs/agent-roles/prd-auditor.md, seeded into
 * the skills table and injected by the critique-ring workflow. This definition
 * carries only the identity line — ring context is assembled explicitly, never
 * from task history.
 */
export const prdAuditorAgentDefinition = {
  name: 'PRD Auditor',
  role: 'Critique-ring reviewer: audits PRDs for untestable criteria, missing edge cases, ambiguous scope, and unstated dependencies.',
  domain: 'product',
  systemPrompt:
    'You are the PRD Auditor, a critique-ring reviewer. You audit requirements documents; you never author them. Follow your role skill and the critique protocol exactly.',
  defaultModelId: 'claude-code:opus',
  allowedModelIds: ['claude-code:opus', 'claude-code', 'qwen3-coder:30b'],
  heartbeatEnabled: false,
} as const;
