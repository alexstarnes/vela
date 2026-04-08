import assert from 'node:assert/strict';
import test from 'node:test';
import { routingFixtures } from './routing-quality.fixtures';
import { evaluateRoutingFixture } from './routing-evaluator';
import { routingQualityScorer } from './routing-quality.scorer';

test('routing fixtures match the expected mode, workflow, and tier labels', async () => {
  for (const fixture of routingFixtures) {
    const output = evaluateRoutingFixture(fixture);
    const score = await routingQualityScorer.run({
      input: fixture,
      output,
      groundTruth: fixture.expected,
      scoreSource: 'experiment',
    });

    assert.equal(
      score.score,
      1,
      `${fixture.id} expected perfect routing score but received ${score.score}: ${score.reason}`,
    );
  }
});
