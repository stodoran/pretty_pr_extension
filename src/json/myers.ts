/**
 * Myers' O((N+M)·D) line diff: fast when two long texts differ in a few
 * places (a 40,000-line file with a handful of edits). Common leading and
 * trailing lines are trimmed first.
 */

export type Op = ' ' | '-' | '+';

/** Above this many differences, the middle is shown as one remove + add. */
const MAX_D = 4000;

export function diffLineOps(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  // Lines as integer ids, so the inner loop compares numbers.
  const ids = new Map<string, number>();
  const id = (s: string) => {
    let v = ids.get(s);
    if (v === undefined) ids.set(s, (v = ids.size));
    return v;
  };
  const x = Int32Array.from(a.slice(pre, a.length - suf), id);
  const y = Int32Array.from(b.slice(pre, b.length - suf), id);
  const middle = myers(x, y) ?? [...Array<Op>(x.length).fill('-'), ...Array<Op>(y.length).fill('+')];
  return [...Array<Op>(pre).fill(' '), ...middle, ...Array<Op>(suf).fill(' ')];
}

function myers(x: Int32Array, y: Int32Array): Op[] | null {
  const n = x.length;
  const m = y.length;
  if (!n || !m) return [...Array<Op>(n).fill('-'), ...Array<Op>(m).fill('+')];
  const max = Math.min(n + m, MAX_D);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    // Only diagonals -d..d are touched at step d: keep just that slice.
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) (i++, j++);
      v[off + k] = i;
      if (i >= n && j >= m) return backtrack(trace, d, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], dEnd: number, n: number, m: number): Op[] {
  const ops: Op[] = [];
  let i = n;
  let j = m;
  for (let d = dEnd; d > 0; d--) {
    const t = trace[d]!; // v before step d, diagonals -d-1..d+1
    const at = (k: number) => t[k + d + 1]!;
    const k = i - j;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const pi = at(pk);
    const pj = pi - pk;
    while (i > (down ? pi : pi + 1) && j > (down ? pj + 1 : pj)) (ops.push(' '), i--, j--);
    if (down) (ops.push('+'), j--);
    else (ops.push('-'), i--);
  }
  while (i > 0 && j > 0) (ops.push(' '), i--, j--);
  return ops.reverse();
}
