import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionLayers,
  normalizeBacklogDependencies,
  type DependencyLink,
} from './dependency-graph';

// ─── B.1 — synthesizer hints become validated edges ────────────────
// (the synthesisSchema round-trip lives in tests/governance/dependency-ordering.ts,
//  which loads env — ring-shared needs a database connection at import time)

test('depends_on indices become edges in backlog order', () => {
  const { edges, warnings } = normalizeBacklogDependencies([
    { title: 'Save records', depends_on: [] },
    { title: 'Import records', depends_on: [0] },
    { title: 'Duplicate detection', depends_on: [0, 1] },
  ]);

  assert.deepEqual(warnings, []);
  assert.deepEqual(edges, [
    { index: 1, dependsOnIndex: 0 },
    { index: 2, dependsOnIndex: 0 },
    { index: 2, dependsOnIndex: 1 },
  ]);
});

test('a missing depends_on is treated as "ready to run"', () => {
  const { edges } = normalizeBacklogDependencies([{ title: 'A' }, { title: 'B' }]);
  assert.deepEqual(edges, []);
});

test('out-of-range indices and self-references are dropped with a warning, never thrown', () => {
  const { edges, warnings } = normalizeBacklogDependencies([
    { title: 'A', depends_on: [7] },
    { title: 'B', depends_on: [1, -1] },
  ]);

  assert.deepEqual(edges, []);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((w) => w.includes('no such story index')));
  assert.ok(warnings.some((w) => w.includes('self-reference')));
});

test('a cycle is broken by dropping the back-edge, and the rest survives', () => {
  const { edges, warnings } = normalizeBacklogDependencies([
    { title: 'A', depends_on: [] },
    { title: 'B', depends_on: [0] },
    // C depends on B (fine); A depending on C would close A→C→B→A.
    { title: 'C', depends_on: [1] },
    { title: 'D', depends_on: [2] },
  ]);
  assert.equal(edges.length, 3);

  const cyclic = normalizeBacklogDependencies([
    { title: 'A', depends_on: [2] },
    { title: 'B', depends_on: [0] },
    { title: 'C', depends_on: [1] },
  ]);
  assert.equal(cyclic.edges.length, 2, 'the back-edge is dropped, the chain is kept');
  assert.ok(cyclic.warnings.some((w) => w.includes('cycle')));
});

test('duplicate hints collapse to a single edge', () => {
  const { edges } = normalizeBacklogDependencies([
    { title: 'A', depends_on: [] },
    { title: 'B', depends_on: [0, 0, 0] },
  ]);
  assert.deepEqual(edges, [{ index: 1, dependsOnIndex: 0 }]);
});

// ─── C.2 — topological layering ────────────────────────────────────

function task(id: string, overrides: Partial<{ priority: string; createdAt: Date }> = {}) {
  return {
    id,
    priority: overrides.priority ?? 'medium',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
  };
}

function link(taskId: string, dependsOnTaskId: string, status = 'open'): DependencyLink {
  return {
    taskId,
    dependsOnTaskId,
    dependsOnTitle: dependsOnTaskId,
    dependsOnStatus: status,
    satisfied: status === 'done',
  };
}

test('a chain lays out one task per layer', () => {
  const layers = buildExecutionLayers(
    [task('a'), task('b'), task('c')],
    [link('b', 'a'), link('c', 'b')],
  );

  assert.equal(layers.length, 3);
  assert.deepEqual(layers.map((l) => l.map((entry) => entry.task.id)), [['a'], ['b'], ['c']]);
  assert.deepEqual(layers[2][0].waitingOn.map((l) => l.dependsOnTaskId), ['b']);
});

test('a done prerequisite stops pushing its dependent down a layer', () => {
  const layers = buildExecutionLayers(
    [task('a'), task('b')],
    [link('b', 'a', 'done')],
  );

  assert.equal(layers.length, 1, 'b is eligible now — its prerequisite already landed');
  assert.deepEqual(layers[0].map((entry) => entry.task.id).sort(), ['a', 'b']);
  assert.deepEqual(layers[0].find((entry) => entry.task.id === 'b')!.waitingOn, []);
});

test('a cancelled prerequisite still blocks — the operator has to decide', () => {
  const layers = buildExecutionLayers([task('a'), task('b')], [link('b', 'a', 'cancelled')]);
  assert.equal(layers.length, 2);
  assert.deepEqual(layers[1][0].waitingOn.map((l) => l.dependsOnStatus), ['cancelled']);
});

test('within a layer, order follows the checkout keys: priority then age', () => {
  const layers = buildExecutionLayers(
    [
      task('old-medium', { createdAt: new Date('2026-01-01T00:00:00Z') }),
      task('new-urgent', { priority: 'urgent', createdAt: new Date('2026-06-01T00:00:00Z') }),
      task('new-medium', { createdAt: new Date('2026-06-01T00:00:00Z') }),
    ],
    [],
  );

  assert.deepEqual(layers[0].map((entry) => entry.task.id), [
    'new-urgent',
    'old-medium',
    'new-medium',
  ]);
});

test('a prerequisite outside the laid-out set still blocks its dependent', () => {
  // e.g. the prerequisite is in_progress, so it is in the flight strip rather
  // than the plan — the dependent must not read as eligible now.
  const layers = buildExecutionLayers([task('b')], [link('b', 'running-elsewhere')]);
  assert.equal(layers.length, 2);
  assert.deepEqual(layers[0], []);
  assert.equal(layers[1][0].task.id, 'b');
});

test('a hand-added cycle degrades to a flat layout instead of hanging', () => {
  const layers = buildExecutionLayers([task('a'), task('b')], [link('a', 'b'), link('b', 'a')]);
  assert.ok(layers.length >= 1);
  assert.equal(layers.flat().length, 2);
});
