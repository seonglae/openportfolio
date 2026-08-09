// Rows come off a Convex index in the order the index defines, not in the order
// of any field they happen to carry. Balance rows for one symbol are written by
// whichever sync finished first, so "the first row" and "the freshest row" are
// different things, and reading `rows[0]` silently reports the wrong one.

export function highestBy<T>(rows: readonly T[], rank: (row: T) => number): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (!best || rank(row) > rank(best)) best = row;
  }
  return best;
}

export function lowestBy<T>(rows: readonly T[], rank: (row: T) => number): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (!best || rank(row) < rank(best)) best = row;
  }
  return best;
}

// Groups preserving first-seen key order, which is what a table render wants.
export function groupBy<T, K extends string>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}
