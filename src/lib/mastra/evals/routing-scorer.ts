import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';
import { routingEvalInputSchema, routingEvalOutputSchema } from './routing-workflow';

export const routingExpectationSchema = z.object({
  mode: z.enum(['single_agent', 'delegated', 'delegated_premium', 'team']),
  workflowId: z.enum(['featureWorkflow', 'highRiskWorkflow', 'debugWorkflow']),
  effectiveTier: z.enum(['fast', 'standard', 'premium']),
  floorApplied: z.boolean().optional(),
});

export const routingExpectationScorer = createScorer({
  id: 'routing-expectation',
  name: 'Routing Expectation',
  description: 'Checks that routing outcomes match the labeled mode, workflow, and tier.',
  type: {
    input: routingEvalInputSchema,
    output: routingEvalOutputSchema,
  },
})
  .generateScore(({ run }) => {
    const expected = routingExpectationSchema.parse(run.groundTruth);

    let score = 0;
    if (run.output.mode === expected.mode) score += 0.34;
    if (run.output.workflowId === expected.workflowId) score += 0.33;
    if (run.output.effectiveTier === expected.effectiveTier) score += 0.33;

    if (
      typeof expected.floorApplied === 'boolean' &&
      run.output.floorApplied !== expected.floorApplied
    ) {
      score = Math.max(0, score - 0.1);
    }

    return Number(score.toFixed(2));
  })
  .generateReason(({ run, score }) => {
    const expected = routingExpectationSchema.parse(run.groundTruth);
    return [
      `fixture=${run.output.fixtureName}`,
      `score=${score}`,
      `mode expected=${expected.mode} actual=${run.output.mode}`,
      `workflow expected=${expected.workflowId} actual=${run.output.workflowId}`,
      `tier expected=${expected.effectiveTier} actual=${run.output.effectiveTier}`,
      typeof expected.floorApplied === 'boolean'
        ? `floorApplied expected=${expected.floorApplied} actual=${run.output.floorApplied}`
        : null,
    ]
      .filter(Boolean)
      .join('; ');
  });
