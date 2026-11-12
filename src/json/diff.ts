import { diffLineOps } from './myers';
import { describePath, prettyJson } from './pretty';

/**
 * A readable diff of two versions of a JSON file: both sides pretty-printed
 * the same way, then line-diffed. Meant for files GitHub's diff is useless
 * on (minified, or with very long lines).
 */

export interface JsonLine {
  kind: ' ' | '-' | '+';
  /** Line numbers in the formatted old/new text. */
  old?: number;
  new?: number;
  text: string;
  /** The changed part of the line [start, end), when it's paired with a similar line on the other side. */
  mark?: [number, number];
}

export interface JsonHunk {
  /** Where in the document the hunk's first change is (`fields[2] “Client Name” › description`). */
  location: string;
  lines: JsonLine[];
}

export type ReadableJson =
  /** GitHub's own diff already reads fine (neither side is minified onto one line). */
  | { status: 'readable' }
  /** Not JSON on one side. */
  | { status: 'invalid' }
  /** Formatting only: the same JSON once formatted. */
  | { status: 'formatting' }
  | { status: 'diff'; hunks: JsonHunk[]; added: number; removed: number; truncated: boolean };

/** A one-line file at least this long is minified: GitHub shows it as one huge changed line. */
export const MINIFIED = 500;
const CONTEXT = 3;
const MAX_SHOWN = 3000;

const isMinified = (text: string) => {
  const t = text.trim();
  return t.length >= MINIFIED && !t.includes('\n');
};

export function readableJsonDiff(before: string, after: string, opts: { force?: boolean } = {}): ReadableJson {
  if (!opts.force && !isMinified(before) && !isMinified(after)) return { status: 'readable' };
  const a = prettyJson(before);
  const b = prettyJson(after);
  if (!a || !b) return { status: 'invalid' };
  const ops = diffLineOps(a.lines, b.lines);
  if (ops.every((o) => o === ' ')) return { status: 'formatting' };

  // Every line, numbered, then cut into hunks with context.
  const all: JsonLine[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === ' ') all.push({ kind: ' ', old: ++i, new: ++j, text: b.lines[j - 1]! });
    else if (op === '-') all.push({ kind: '-', old: ++i, text: a.lines[i - 1]! });
    else all.push({ kind: '+', new: ++j, text: b.lines[j - 1]! });
  }
  markWords(all);

  const changed: number[] = [];
  all.forEach((l, k) => l.kind !== ' ' && changed.push(k));
  const hunks: JsonHunk[] = [];
  let shown = 0;
  let truncated = false;
  let added = 0;
  let removed = 0;
  for (let c = 0; c < changed.length; ) {
    const first = changed[c]!;
    let last = first;
    // Changes close enough that their context would touch share a hunk.
    while (c + 1 < changed.length && changed[c + 1]! - last <= 2 * CONTEXT + 1) last = changed[++c]!;
    c++;
    const lines = all.slice(Math.max(0, first - CONTEXT), Math.min(all.length, last + CONTEXT + 1));
    for (const l of lines) if (l.kind === '+') added++;
    else if (l.kind === '-') removed++;
    if (shown >= MAX_SHOWN) {
      truncated = true;
      continue;
    }
    // Located by its first changed line with content (not a lone `},`).
    let firstReal = first;
    while (firstReal < last && (all[firstReal]!.kind === ' ' || /^\s*[\]{}[,]*\s*$/.test(all[firstReal]!.text))) firstReal++;
    const at = all[all[firstReal]!.kind === ' ' ? first : firstReal]!;
    const side = at.kind === '-' ? a : b;
    const path = side.paths[(at.kind === '-' ? at.old! : at.new!) - 1]!;
    hunks.push({ location: describePath(path, side.labels), lines });
    shown += lines.length;
  }
  return { status: 'diff', hunks, added, removed, truncated };
}

/** Pairs the i-th removed and i-th added line of each change block and marks what differs between them. */
function markWords(lines: JsonLine[]) {
  for (let k = 0; k < lines.length; ) {
    if (lines[k]!.kind === ' ') {
      k++;
      continue;
    }
    const minus: JsonLine[] = [];
    const plus: JsonLine[] = [];
    while (k < lines.length && lines[k]!.kind !== ' ') (lines[k]!.kind === '-' ? minus : plus).push(lines[k++]!);
    for (let p = 0; p < Math.min(minus.length, plus.length); p++) {
      const x = minus[p]!.text;
      const y = plus[p]!.text;
      let pre = 0;
      while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
      let suf = 0;
      while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
      // Only worth marking when most of the line is shared.
      if (pre + suf < Math.min(x.length, y.length) / 3) continue;
      // Widen to word boundaries so a marked word isn't cut in half.
      while (pre > 0 && /\w/.test(x[pre - 1]!) && /\w/.test(x[pre] ?? '')) pre--;
      while (suf > 0 && /\w/.test(x[x.length - suf]!) && /\w/.test(x[x.length - suf - 1] ?? '')) suf--;
      minus[p]!.mark = [pre, x.length - suf];
      plus[p]!.mark = [pre, y.length - suf];
    }
  }
}
