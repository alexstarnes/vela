import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImplementationAudit,
  getLowRiskAuditFailure,
} from './implementation-audit';
import { chooseModelCandidate, desiredTierFromFailureHistory } from './model-selection';
import { extractToolCallMeta } from '../mastra/tool-call-meta';
import {
  getTaskExecutionPolicy,
} from './task-shape';
import {
  buildVerificationPlan,
  classifyVerificationFailures,
  isFailureRelevantToFiles,
} from './verification-policy';
import {
  buildLowRiskDeterministicPlan,
  extractTaskSearchTerms,
} from './low-risk-discovery';

test('low-risk spacing task uses compact prompt and scoped verification', () => {
  const policy = getTaskExecutionPolicy({
    title: 'Add space between email submission and cloudflare verification',
    description:
      'At the bottom of the home page, add spacing between the email box and verification widget.',
  });

  assert.equal(policy.workflowId, 'featureWorkflow');
  assert.equal(policy.isLowRiskFeature, true);
  assert.equal(policy.compactPrompt, true);
  assert.equal(policy.verificationPolicy, 'scoped');
  assert.equal(policy.maxSteps.plan, 2);
  assert.equal(policy.maxSteps.implement, 12);
  assert.equal(policy.implementerBudget?.maxTokens, 60_000);
});

test('model selection prefers healthy local fast candidate over cloud fast downgrade', () => {
  const configured = {
    id: 'configured-local-standard',
    modelId: 'qwen2.5-coder:32b',
    provider: 'ollama',
    tier: 'standard',
    isLocal: true,
    isAvailable: true,
    healthState: 'online' as const,
  };
  const result = chooseModelCandidate({
    configured,
    desiredTier: 'fast',
    candidates: [
      configured,
      {
        id: 'local-fast',
        modelId: 'qwen3:8b',
        provider: 'ollama',
        tier: 'fast',
        isLocal: true,
        isAvailable: true,
        healthState: 'online' as const,
      },
      {
        id: 'cloud-fast',
        modelId: 'gpt-4o-mini',
        provider: 'openai',
        tier: 'fast',
        isLocal: false,
        isAvailable: true,
        healthState: 'unknown' as const,
      },
    ],
  });

  assert.equal(result.selected.id, 'local-fast');
  assert.equal(result.selectionKind, 'local_fallback');
});

test('low-risk tasks preserve the routed fast tier despite failure history', () => {
  const desiredTier = desiredTierFromFailureHistory({
    effectiveTier: 'fast',
    failureCount: 3,
    preserveRoutedTier: true,
  });

  assert.equal(desiredTier, 'fast');
});

test('model selection moves up in capability when the desired tier requires it', () => {
  const configured = {
    id: 'configured-local-standard',
    modelId: 'qwen2.5-coder:32b',
    provider: 'ollama',
    tier: 'standard',
    isLocal: true,
    isAvailable: true,
    healthState: 'online' as const,
  };
  const result = chooseModelCandidate({
    configured,
    desiredTier: 'premium',
    candidates: [
      configured,
      {
        id: 'premium-cloud',
        modelId: 'claude-sonnet-4-5',
        provider: 'anthropic',
        tier: 'premium',
        isLocal: false,
        isAvailable: true,
        healthState: 'unknown' as const,
      },
    ],
  });

  assert.equal(result.selected.id, 'premium-cloud');
  assert.equal(result.selectionKind, 'tier_up');
});

test('implementation audit flags package-only diffs for low-risk work', () => {
  const audit = buildImplementationAudit({
    changedFiles: ['package.json', 'package-lock.json'],
    planText: 'Likely files: src/components/Waitlist.jsx',
  });

  assert.equal(audit.sourceFilesChanged.length, 0);
  assert.match(
    getLowRiskAuditFailure(
      {
        title: 'Adjust spacing in waitlist form',
        description: 'Add a little spacing between the two UI elements.',
      },
      audit,
    ) ?? '',
    /dependency or metadata files/i,
  );
});

test('implementation audit flags no-op runs that claim success', () => {
  const audit = buildImplementationAudit({
    changedFiles: [],
    planText: 'Likely files: src/components/Waitlist.jsx',
  });

  assert.match(
    getLowRiskAuditFailure(
      {
        title: 'Adjust spacing in waitlist form',
        description: 'Add a little spacing between the two UI elements.',
      },
      audit,
    ) ?? '',
    /no repository diff/i,
  );
});

test('scoped verification plans lint changed UI code files', () => {
  const plan = buildVerificationPlan(
    {
      title: 'Adjust waitlist form spacing',
      description: 'Update the React component spacing on the home page.',
    },
    ['src/components/Waitlist.jsx'],
  );

  assert.equal(plan.policy, 'scoped');
  assert.deepEqual(plan.lintFiles, ['src/components/Waitlist.jsx']);
  assert.equal(plan.needsBuild, true);
});

test('strict verification plan remains enabled for high-risk work', () => {
  const plan = buildVerificationPlan(
    {
      title: 'Refactor billing webhook handling with a database migration',
      description: 'Update auth and payments orchestration safely.',
    },
    ['src/app/api/billing/route.ts'],
  );

  assert.equal(plan.policy, 'strict');
  assert.equal(plan.includeTests, true);
  assert.equal(plan.includeSecurityAudit, true);
});

test('scoped failure classification downgrades unrelated failures to informational', () => {
  const classified = classifyVerificationFailures({
    policy: 'scoped',
    verifiedFiles: ['src/components/Waitlist.jsx'],
    gateResults: [
      {
        gate: 'build',
        status: 'failed',
        exitCode: 1,
        stdout: '/Users/example/project/src/components/OtherWidget.jsx: build failed',
        stderr: '',
      },
    ],
  });

  assert.equal(classified.blockingFailures.length, 0);
  assert.equal(classified.informationalFailures.length, 1);
});

test('scoped lint failures outside the changed lines are informational', () => {
  const lintOutput = [
    '/Users/example/project/src/LandingPage.jsx',
    '  102:5  error    Calling setState synchronously within an effect  react-hooks/set-state-in-effect',
    '',
    '1 problem (1 error, 0 warnings)',
  ].join('\n');

  const classified = classifyVerificationFailures({
    policy: 'scoped',
    verifiedFiles: ['src/LandingPage.jsx'],
    changedLineRanges: { 'src/LandingPage.jsx': [[560, 566]] },
    gateResults: [
      {
        gate: 'lint',
        status: 'failed',
        exitCode: 1,
        stdout: lintOutput,
        stderr: '',
      },
    ],
  });

  assert.equal(classified.blockingFailures.length, 0);
  assert.equal(classified.informationalFailures.length, 1);
});

test('scoped lint failures inside the changed lines stay blocking', () => {
  const lintOutput = [
    '/Users/example/project/src/LandingPage.jsx',
    '  561:9  error    Unexpected token  some-rule',
    '',
    '1 problem (1 error, 0 warnings)',
  ].join('\n');

  const classified = classifyVerificationFailures({
    policy: 'scoped',
    verifiedFiles: ['src/LandingPage.jsx'],
    changedLineRanges: { 'src/LandingPage.jsx': [[560, 566]] },
    gateResults: [
      {
        gate: 'lint',
        status: 'failed',
        exitCode: 1,
        stdout: lintOutput,
        stderr: '',
      },
    ],
  });

  assert.equal(classified.blockingFailures.length, 1);
});

test('relevance detection only treats touched files as blocking in scoped mode', () => {
  assert.equal(
    isFailureRelevantToFiles(
      '/Users/example/project/src/components/Waitlist.jsx: line 12 error',
      ['src/components/Waitlist.jsx'],
    ),
    true,
  );
  assert.equal(
    isFailureRelevantToFiles(
      '/Users/example/project/src/components/OtherWidget.jsx: line 12 error',
      ['src/components/Waitlist.jsx'],
    ),
    false,
  );
});

test('tool-call normalization extracts nested provider payloads', () => {
  const toolCall = extractToolCallMeta({
    type: 'tool-call',
    payload: {
      toolCallId: 'abc123',
      toolName: 'list_workspace_files',
      args: { directory: '.', recursive: false },
    },
  });

  assert.deepEqual(toolCall, {
    toolCallId: 'abc123',
    toolName: 'list_workspace_files',
    toolInput: { directory: '.', recursive: false },
  });
});

test('low-risk discovery prioritizes exact widget search terms', () => {
  const terms = extractTaskSearchTerms({
    title: 'Add space between email submission and cloudflare verification',
    description: 'Adjust spacing between the email box and the Turnstile verification widget.',
  });

  assert.deepEqual(terms.slice(0, 4), [
    'turnstile',
    'cloudflare',
    'verification',
    'email',
  ]);
  assert.equal(terms.includes('footer'), false);
});

test('deterministic low-risk plan tells the implementer to stop when no exact target is found', () => {
  const plan = buildLowRiskDeterministicPlan(
    {
      title: 'Add space between email submission and cloudflare verification',
      description: 'At the bottom of the home page, adjust the waitlist area spacing.',
    },
    {
      likelyFiles: [],
      dependencyNotes: [],
      summary: 'No direct repository matches were found.',
    },
  );

  assert.match(plan, /stop and report target-not-found/i);
  assert.doesNotMatch(plan, /footer/i);
});
