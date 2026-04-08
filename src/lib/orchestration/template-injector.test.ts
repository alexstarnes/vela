import test from 'node:test';
import assert from 'node:assert/strict';
import { injectImplementationTemplates, injectReviewerTemplates } from './template-injector';

test('implementer templates include security and performance specialists when triggered', () => {
  const templates = injectImplementationTemplates({
    title: 'Improve auth performance',
    description:
      'Refactor the login flow, token handling, and render path to reduce latency and tighten security.',
  });

  assert.ok(templates.some((template) => template.includes('Specialist Template: Security Auditor')));
  assert.ok(
    templates.some((template) => template.includes('Specialist Template: Performance Engineer')),
  );
});

test('reviewer templates always include code review guidance', () => {
  const templates = injectReviewerTemplates({
    title: 'Review dashboard filter implementation',
    description: 'Check the UI, API route, and query update for edge cases.',
  });

  assert.ok(templates.some((template) => template.includes('Specialist Template: Code Reviewer')));
});
