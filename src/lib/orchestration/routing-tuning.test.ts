import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTaskMode } from './mode-classifier';
import { deriveRoutingTierAdjustment } from './routing-tuning';

test('routing tier stays unchanged without enough history', () => {
  const classification = classifyTaskMode({
    title: 'Update footer copy',
    description: 'Tweak a small React text label.',
  });

  const adjustment = deriveRoutingTierAdjustment({
    classification,
    workflowId: 'featureWorkflow',
    summary: {
      workflowId: 'featureWorkflow',
      taskCount: 3,
      tierUsage: { fast: 3, standard: 0, premium: 0 },
      escalationFrequency: 0.2,
      verificationFailureRate: 0.1,
      approvalFrequency: 0,
      averageCostUsd: 0.01,
    },
  });

  assert.equal(adjustment.effectiveTier, 'fast');
  assert.equal(adjustment.floorApplied, false);
});

test('routing tier is raised to standard when historical failures are high', () => {
  const classification = classifyTaskMode({
    title: 'Update footer copy',
    description: 'Tweak a small React text label.',
  });

  const adjustment = deriveRoutingTierAdjustment({
    classification,
    workflowId: 'featureWorkflow',
    summary: {
      workflowId: 'featureWorkflow',
      taskCount: 8,
      tierUsage: { fast: 6, standard: 2, premium: 0 },
      escalationFrequency: 0.2,
      verificationFailureRate: 0.5,
      approvalFrequency: 0,
      averageCostUsd: 0.02,
    },
  });

  assert.equal(adjustment.effectiveTier, 'standard');
  assert.equal(adjustment.floorApplied, true);
});

test('security-sensitive work keeps a premium floor', () => {
  const classification = classifyTaskMode({
    title: 'Harden auth middleware',
    description: 'Update auth and permissions handling before production rollout.',
  });

  const adjustment = deriveRoutingTierAdjustment({
    classification,
    workflowId: 'highRiskWorkflow',
    summary: {
      workflowId: 'highRiskWorkflow',
      taskCount: 10,
      tierUsage: { fast: 0, standard: 2, premium: 8 },
      escalationFrequency: 0.1,
      verificationFailureRate: 0.1,
      approvalFrequency: 0.6,
      averageCostUsd: 1.25,
    },
  });

  assert.equal(adjustment.effectiveTier, 'premium');
  assert.equal(adjustment.floorApplied, false);
});
