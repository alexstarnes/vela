import test from 'node:test';
import assert from 'node:assert/strict';
import { routingEvalFixtures } from './routing-fixtures';
import { predictRoutingOutcome } from './routing-workflow';
import { routingExpectationScorer } from './routing-scorer';

test('routing fixtures resolve to the expected workflow and tier', async () => {
  for (const fixture of routingEvalFixtures) {
    const output = predictRoutingOutcome({
      name: fixture.name,
      title: fixture.title,
      description: fixture.description,
      historicalScorecard: fixture.historicalScorecard,
    });

    assert.equal(output.mode, fixture.expected.mode, fixture.name);
    assert.equal(output.workflowId, fixture.expected.workflowId, fixture.name);
    assert.equal(output.effectiveTier, fixture.expected.effectiveTier, fixture.name);
    if (typeof fixture.expected.floorApplied === 'boolean') {
      assert.equal(output.floorApplied, fixture.expected.floorApplied, fixture.name);
    }
  }
});

test('routing expectation scorer returns a perfect score for an exact match', async () => {
  const fixture = routingEvalFixtures[0];
  const output = predictRoutingOutcome({
    name: fixture.name,
    title: fixture.title,
    description: fixture.description,
    historicalScorecard: fixture.historicalScorecard,
  });

  const result = await routingExpectationScorer.run({
    input: {
      name: fixture.name,
      title: fixture.title,
      description: fixture.description,
      historicalScorecard: fixture.historicalScorecard,
    },
    output,
    groundTruth: fixture.expected,
  });

  assert.equal(result.score, 1);
});
