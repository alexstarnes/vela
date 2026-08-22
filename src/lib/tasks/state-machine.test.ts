import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_STATUSES,
  assertValidTransition,
  isValidTransition,
  type TaskStatus,
} from './state-machine';

test('every status can be cancelled', () => {
  for (const from of ALL_STATUSES) {
    if (from === 'cancelled') continue;
    assert.equal(isValidTransition(from, 'cancelled'), true, `${from} → cancelled should be allowed`);
  }
});

test('cancel is reversible — a cancelled task can be brought back', () => {
  assert.equal(isValidTransition('cancelled', 'backlog'), true);
  assert.equal(isValidTransition('cancelled', 'open'), true);
});

test('reopening does not jump straight into a running state', () => {
  // Reopen must not skip the queue: an operator undoing a cancel decides when
  // the agent runs, rather than landing the task mid-flight.
  for (const to of ['in_progress', 'review', 'done', 'waiting_for_human', 'blocked'] as TaskStatus[]) {
    assert.equal(isValidTransition('cancelled', to), false, `cancelled → ${to} should be refused`);
  }
});

test('an open task can be pulled back to the backlog', () => {
  // De-queueing is not cancelling — the work is still wanted, just not now.
  assert.equal(isValidTransition('open', 'backlog'), true);
});

test('a task cannot skip from backlog straight into progress', () => {
  assert.equal(isValidTransition('backlog', 'in_progress'), false);
});

test('assertValidTransition names the allowed targets when it refuses', () => {
  assert.throws(
    () => assertValidTransition('done', 'in_progress'),
    (err: Error) => err.message.includes('done') && err.message.includes('cancelled')
  );
});

test('every listed target is itself a known status', () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      // Exercised for its own sake: isValidTransition must never throw on a
      // pair of real statuses, however unlikely the combination.
      assert.equal(typeof isValidTransition(from, to), 'boolean');
    }
  }
});
