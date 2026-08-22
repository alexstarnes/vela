/**
 * Small LCS-based line differ for the approval review page.
 *
 * No external diff library — this is a plain dynamic-programming longest
 * common subsequence over lines, backtracked into a same/add/del op list.
 * O(n*m) time and space, which is fine for markdown-sized PRD documents;
 * pathologically large inputs fall back to a full replace rather than
 * allocating an enormous table.
 */

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

// ~4M dp cells (Int32Array ≈ 16MB) is a generous ceiling for a markdown doc
// diff. Past that, degrade to a plain replace instead of hanging or OOMing.
const MAX_DP_CELLS = 4_000_000;

export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;

  if (n * m > MAX_DP_CELLS) {
    const ops: DiffOp[] = [];
    for (const line of a) ops.push({ type: 'del', text: line });
    for (const line of b) ops.push({ type: 'add', text: line });
    return ops;
  }

  // dp[i][j] = length of the LCS of a[i:] and b[j:]
  const dp: Int32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);

  for (let i = n - 1; i >= 0; i--) {
    const dpI = dp[i];
    const dpI1 = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      dpI[j] = a[i] === b[j] ? dpI1[j + 1] + 1 : Math.max(dpI1[j], dpI[j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j] });
    j += 1;
  }

  return ops;
}

export function diffCounts(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') added += 1;
    else if (op.type === 'del') removed += 1;
  }
  return { added, removed };
}

/** A renderable diff row: either one line, or a collapsed run of unchanged lines. */
export type DiffRow =
  | { kind: 'line'; op: DiffOp; key: number }
  | { kind: 'collapsed'; count: number; key: number };

/** Collapses runs of more than `threshold` consecutive unchanged lines. */
export function collapseUnchangedRuns(ops: DiffOp[], threshold = 8): DiffRow[] {
  const rows: DiffRow[] = [];
  let key = 0;
  let i = 0;

  while (i < ops.length) {
    if (ops[i].type === 'same') {
      let j = i;
      while (j < ops.length && ops[j].type === 'same') j += 1;
      const runLength = j - i;
      if (runLength > threshold) {
        rows.push({ kind: 'collapsed', count: runLength, key: key++ });
      } else {
        for (let k = i; k < j; k += 1) rows.push({ kind: 'line', op: ops[k], key: key++ });
      }
      i = j;
    } else {
      rows.push({ kind: 'line', op: ops[i], key: key++ });
      i += 1;
    }
  }

  return rows;
}
