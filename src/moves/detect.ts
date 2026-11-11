import { extractFunctions, type PyFunction } from './python/functions';
import { normalizeFunction } from './python/normalize';
import { tokenize } from './python/tokenize';
import { mapOldToNew, type DiffFile } from './unified-diff';

/**
 * Moved-function detection. Pure (no browser APIs) so it is unit-testable.
 *
 * 1. Parse base and head versions of every changed Python file.
 * 2. A base function is "removed" if most of its lines are deleted in the diff;
 *    a head function is "added" if most of its lines are new.
 * 3. Normalize (rename locals, drop comments/docstrings/formatting) and pair
 *    removed↔added functions: identical normalized bodies first, then by
 *    token-level similarity (shingle Jaccard prefilter → LCS ratio).
 * 4. Pairs that are the same function edited in place are excluded, as are
 *    nested functions already covered by a matched parent.
 */

export interface FileVersions {
  diff: DiffFile;
  base: string | null; // null when the file was added
  head: string | null; // null when the file was deleted
}

export interface FunctionLocation {
  /** Path of the file in the diff UI (new path, or old path for deleted files). */
  displayPath: string;
  /** Path of the file on this side (old path for `from`, new path for `to`). */
  path: string;
  qualname: string;
  startLine: number;
  endLine: number;
  text: string;
}

export type MoveKind = 'moved' | 'moved-modified';

export interface MovedFunction {
  id: string;
  kind: MoveKind;
  /** What moved: a function/method or a whole class. */
  defKind: 'def' | 'class';
  renamed: boolean;
  /** 1 for identical normalized bodies; otherwise LCS-based token similarity. */
  similarity: number;
  from: FunctionLocation;
  to: FunctionLocation;
}

export interface DetectOptions {
  minSimilarity: number;
  /** Functions smaller than this (normalized tokens) are ignored: getters etc. would be noise. */
  minTokens: number;
  /** Same for classes; lower so small enums and dataclasses still count. */
  minClassTokens: number;
  /** Fraction of a function's lines that must be removed/added for it to count. */
  minChangedFraction: number;
}

export const DEFAULT_DETECT_OPTIONS: DetectOptions = { minSimilarity: 0.65, minTokens: 25, minClassTokens: 15, minChangedFraction: 0.6 };

interface Candidate {
  fn: PyFunction;
  file: DiffFile;
  side: 'from' | 'to';
  norm: string[];
  key: string;
  shingles: Set<string>;
  source: string;
}

const SHINGLE = 4;
const MAX_LCS_CELLS = 25_000_000;

function shingles(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + SHINGLE <= tokens.length; i++) s.add(tokens.slice(i, i + SHINGLE).join('\u0001'));
  if (!s.size && tokens.length) s.add(tokens.join('\u0001'));
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 2·LCS / (|a|+|b|) over token sequences; O(n·m) time, O(m) memory. */
export function lcsSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    [prev, cur] = [cur, prev];
  }
  return (2 * prev[b.length]!) / (a.length + b.length);
}

function changedLines(file: DiffFile, side: 'old' | 'new'): Set<number> {
  const s = new Set<number>();
  for (const h of file.hunks)
    for (const l of h.lines) {
      if (side === 'old' && l.kind === '-') s.add(l.oldNo!);
      if (side === 'new' && l.kind === '+') s.add(l.newNo!);
    }
  return s;
}

function candidates(fv: FileVersions, side: 'from' | 'to', opts: DetectOptions): Candidate[] {
  const source = side === 'from' ? fv.base : fv.head;
  if (source === null) return [];
  const whole = side === 'from' ? fv.diff.status === 'deleted' : fv.diff.status === 'added';
  const changed = changedLines(fv.diff, side === 'from' ? 'old' : 'new');
  const lines = source.split('\n');
  const out: Candidate[] = [];
  const defs = extractFunctions(tokenize(source), { includeClasses: true });
  for (const fn of defs) {
    if (!whole) {
      let total = 0;
      let hit = 0;
      for (let l = fn.startLine; l <= fn.endLine; l++) {
        if (!lines[l - 1]?.trim()) continue; // blank lines don't count either way
        total++;
        if (changed.has(l)) hit++;
      }
      if (!total || hit / total < opts.minChangedFraction) continue;
    }
    const norm = normalizeFunction(fn, defs);
    if (norm.length < (fn.kind === 'class' ? opts.minClassTokens : opts.minTokens)) continue;
    out.push({
      fn,
      file: fv.diff,
      side,
      norm,
      key: norm.join(' '),
      shingles: shingles(norm),
      source: lines.slice(fn.startLine - 1, fn.endLine).join('\n'),
    });
  }
  return out;
}

/** Same file, and the added function sits where the removed one was: an in-place rewrite, not a move. */
function isInPlace(r: Candidate, a: Candidate): boolean {
  if (r.file !== a.file) return false;
  const start = mapOldToNew(r.file, r.fn.startLine);
  const end = mapOldToNew(r.file, r.fn.endLine);
  return start <= a.fn.endLine && a.fn.startLine <= end;
}

function location(c: Candidate): FunctionLocation {
  const path = (c.side === 'from' ? c.file.oldPath : c.file.newPath)!;
  return {
    displayPath: (c.file.newPath ?? c.file.oldPath)!,
    path,
    qualname: c.fn.qualname,
    startLine: c.fn.startLine,
    endLine: c.fn.endLine,
    text: c.source,
  };
}

export function detectMoves(files: FileVersions[], options: Partial<DetectOptions> = {}): MovedFunction[] {
  const opts = { ...DEFAULT_DETECT_OPTIONS, ...options };
  const removed = files.flatMap((f) => candidates(f, 'from', opts));
  const added = files.flatMap((f) => candidates(f, 'to', opts));

  const pairs: { r: Candidate; a: Candidate; score: number }[] = [];
  for (const r of removed) {
    for (const a of added) {
      if (r.fn.kind !== a.fn.kind || isInPlace(r, a)) continue;
      if (r.key === a.key) {
        pairs.push({ r, a, score: 1 });
        continue;
      }
      const sizeRatio = Math.min(r.norm.length, a.norm.length) / Math.max(r.norm.length, a.norm.length);
      if (sizeRatio < opts.minSimilarity * 0.75) continue;
      const j = jaccard(r.shingles, a.shingles);
      if (j < 0.2) continue;
      // Bound the O(n·m) LCS for huge classes; shingle overlap is a fair stand-in there.
      const score = r.norm.length * a.norm.length > MAX_LCS_CELLS ? Math.min(j, 0.99) : lcsSimilarity(r.norm, a.norm); // approximate: never 'unchanged'
      if (score >= opts.minSimilarity) pairs.push({ r, a, score });
    }
  }

  // Greedy one-to-one assignment, best score first; same name breaks ties.
  pairs.sort((x, y) => y.score - x.score || Number(y.r.fn.name === y.a.fn.name) - Number(x.r.fn.name === x.a.fn.name));
  const usedR = new Set<Candidate>();
  const usedA = new Set<Candidate>();
  const chosen: typeof pairs = [];
  for (const p of pairs) {
    if (usedR.has(p.r) || usedA.has(p.a)) continue;
    usedR.add(p.r);
    usedA.add(p.a);
    chosen.push(p);
  }

  // Methods/nested functions that moved along with a matched parent (class or function) are implied; drop them.
  const within = (inner: Candidate, outer: Candidate) =>
    inner !== outer && inner.file === outer.file && inner.fn.startLine >= outer.fn.startLine && inner.fn.endLine <= outer.fn.endLine;
  const result = chosen.filter((p) => !chosen.some((q) => within(p.r, q.r) && within(p.a, q.a)));

  return result.map((p, i) => ({
    id: `m${i}`,
    kind: p.score === 1 ? 'moved' : 'moved-modified',
    defKind: p.r.fn.kind,
    renamed: p.r.fn.name !== p.a.fn.name,
    similarity: Math.round(p.score * 100) / 100,
    from: location(p.r),
    to: location(p.a),
  }));
}
