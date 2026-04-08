import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTaskMode } from './mode-classifier';
import {
  buildApprovalReason,
  determineWorkflowKind,
  selectWorkflowForClassification,
  shouldUseEmbeddedWorkflowRuntime,
  taskNeedsHumanApproval,
} from './workflow-selector';

test('classifyTaskMode routes a small UI tweak to the feature workflow', () => {
  const classification = classifyTaskMode({
    title: 'Update empty state copy',
    description: 'Tweak the React copy on the dashboard page.',
  });

  assert.equal(classification.mode, 'single_agent');
  assert.equal(determineWorkflowKind(classification), 'feature');
  assert.equal(selectWorkflowForClassification(classification).workflowId, 'featureWorkflow');
  assert.equal(taskNeedsHumanApproval(classification), false);
});

test('debug signals route into the debug workflow', () => {
  const classification = classifyTaskMode({
    title: 'Debug board crash',
    description: 'Investigate the bug causing an error when the board loads.',
  });

  assert.ok(classification.riskFlags.includes('debug'));
  assert.equal(determineWorkflowKind(classification), 'debug');
  assert.equal(selectWorkflowForClassification(classification).workflowId, 'debugWorkflow');
});

test('security-sensitive work requires approval and high-risk routing', () => {
  const classification = classifyTaskMode({
    title: 'Migrate auth checks for project routes',
    description: 'Update auth, permissions, and schema validation before rollout.',
  });

  assert.equal(determineWorkflowKind(classification), 'high_risk');
  assert.equal(taskNeedsHumanApproval(classification), true);
  assert.match(
    buildApprovalReason({ title: 'Auth migration' }, classification),
    /High-risk workflow approval required/,
  );
});

test('embedded workflow runtime is restricted to the runtime Supervisor', () => {
  assert.equal(
    shouldUseEmbeddedWorkflowRuntime({ agentKind: 'runtime', name: 'Supervisor' }),
    true,
  );
  assert.equal(
    shouldUseEmbeddedWorkflowRuntime({ agentKind: 'runtime', name: 'Implementer' }),
    false,
  );
  assert.equal(
    shouldUseEmbeddedWorkflowRuntime({ agentKind: 'legacy_reference', name: 'Supervisor' }),
    false,
  );
});
