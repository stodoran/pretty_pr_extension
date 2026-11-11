/** Line-level LCS diff for the "Compare" view (functions are small, O(n·m) is fine). */
export interface DiffOp {
  kind: ' ' | '-' | '+';
  text: string;
}

/** Removes common leading indentation, so a method and a top-level function compare cleanly. */
export function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

export function diffLines(a: string, b: string): DiffOp[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const key = (s: string) => s.trimEnd();
  const dp = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i]![j] = key(x[i]!) === key(y[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (key(x[i]!) === key(y[j]!)) {
      ops.push({ kind: ' ', text: y[j]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) ops.push({ kind: '-', text: x[i++]! });
    else ops.push({ kind: '+', text: y[j++]! });
  }
  while (i < x.length) ops.push({ kind: '-', text: x[i++]! });
  while (j < y.length) ops.push({ kind: '+', text: y[j++]! });
  return ops;
}
