import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';
import { routingFixtureSchema } from './routing-quality.fixtures';

export const routingResultSchema = z.object({
  mode: z.enum(['single_agent', 'delegated', 'delegated_premium', 'team']),
  workflowId: z.enum(['featureWorkflow', 'highRiskWorkflow', 'debugWorkflow']),
  tier: z.enum(['fast', 'standard', 'premium']),
});

export const routingQualityScorer = createScorer({
  id: 'routing-quality',
  name: 'Routing Quality',
  description: 'Checks routing mode, workflow, and tier against labeled fixtures.',
  type: {
    input: routingFixtureSchema,
    output: routingResultSchema,
  },
})
  .generateScore(({ run }) => {
    const expected = run.input?.expected;
    const actual = run.output;

    if (!expected) {
      return 0;
    }

    let score = 0;
    if (expected.mode === actual.mode) score += 1 / 3;
    if (expected.workflowId === actual.workflowId) score += 1 / 3;
    if (expected.tier === actual.tier) score += 1 / 3;

    return Number(score.toFixed(4));
  })
  .generateReason(({ run, score }) => {
    const expected = run.input?.expected;
    const actual = run.output;

    if (!expected) {
      return `score=${score} | missing expected routing label`;
    }

    return [
      `score=${score}`,
      `mode expected=${expected.mode} actual=${actual.mode}`,
      `workflow expected=${expected.workflowId} actual=${actual.workflowId}`,
      `tier expected=${expected.tier} actual=${actual.tier}`,
    ].join(' | ');
  });
