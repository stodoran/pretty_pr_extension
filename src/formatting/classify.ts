import type { DiffFile, Hunk } from '../moves/unified-diff';
import type { Language } from '../lang/language';
import { importEntries, matchPattern, type TokenView } from '../lang/pattern';
import { builtinRegistry, type Registry } from '../lang/registry';
import { END, lex, type Tok } from './lexer';

/**
 * Finds changed lines that are formatting only: whitespace, line wrapping,
 * quote style, trailing commas, optional semicolons, blank lines, and (as a
 * separate kind) reordered/regrouped imports.
 *
 * Works from the diff alone (no file fetches). Per hunk, both sides are
 * lexed into formatting-insensitive tokens and aligned (LCS); a changed line
 * is formatting-only if every token on it found a partner on the other side.
 * So a reformatted block that also has a real edit keeps the edited lines as
 * real changes and only the rest count as formatting.
 *
 * Limitation: a hunk that starts inside a multi-line string or comment is
 * lexed from the wrong state (we can't see the lines above it).
 */

export type FormatKind = 'format' | 'imports' | 'comment';

/** The formatting lines of one change (a run of consecutive changed lines), and what kind of formatting it is. */
export interface FormatBlock {
  left: number[];
  right: number[];
  kind: FormatKind;
  /** The hover label, e.g. "formatting: line wrapping, trailing commas", "imports reordered", "comment changes". */
  reason: string;
}

export interface FileFormatting {
  /** New path (old path for deletions), as GitHub shows it. */
  path: string;
  /** Formatting-only changed lines, except blank ones: old line numbers (removed) and new line numbers (added). */
  left: number[];
  right: number[];
  blocks: FormatBlock[];
  /** Changed (added + removed) lines, and how many of them are formatting (comment changes don't count). */
  changed: number;
  formatting: number;
  /** Every change in the file is formatting. */
  whole: boolean;
}

/** Above this many token pairs (after trimming the common prefix) a hunk isn't aligned. */
const MAX_LCS_CELLS = 4_000_000;

export function classifyFile(file: DiffFile, registry: Registry = builtinRegistry): FileFormatting | null {
  const path = file.newPath ?? file.oldPath;
  if (!path || file.binary || !file.hunks.length) return null;
  const lang = registry.forPath(path);
  if (!lang?.formatting.enabled) return null;

  const out: FileFormatting = { path, left: [], right: [], blocks: [], changed: 0, formatting: 0, whole: false };
  let unsure = false;
  for (const h of file.hunks) if (classifyHunk(h, out, lang)) unsure = true;
  // `whole` auto-views the file, so only when nothing else could hide in it:
  // no rename or mode change, and no hunk that needed the docstring guess.
  out.whole = file.status === 'modified' && !file.modeChange && !unsure && out.changed > 0 && out.formatting === out.changed;
  return out;
}

interface Side {
  lines: { text: string; no: number; changed: boolean }[];
  toks: Tok[];
  /** Line indexes that changed for real (see `markLines`). */
  real: Set<number>;
  /** Line indexes whose only change is their indentation. */
  reindent: Set<number>;
  /** Line indexes whose only change is in comments. */
  comment: Set<number>;
  /** Line index → the other side's lines its tokens matched. */
  partners: Map<number, number[]>;
  imports: Set<number>;
}

function side(h: Hunk, which: '-' | '+'): Side {
  const lines = h.lines
    .filter((l) => l.kind !== (which === '-' ? '+' : '-'))
    .map((l) => ({ text: l.text, no: (which === '-' ? l.oldNo : l.newNo)!, changed: l.kind === which }));
  return { lines, toks: [], real: new Set(), reindent: new Set(), comment: new Set(), partners: new Map(), imports: new Set() };
}

/** A string token that reached the end of the input without its closing quote. */
const isUnclosed = (t: Tok) => t.key.startsWith('\u0002') && t.key.slice(1, t.key.indexOf('\u0002', 1)).endsWith('…');

/**
 * Lexes and aligns both sides. A hunk often starts inside a docstring
 * (its opening quotes are above the hunk), which shows up as a string left
 * open at the end, but a hunk can just as well *end* inside a docstring. So
 * when a string is left open, also lex as if one were open at the start, and
 * keep whichever reading aligns best (fewest unmatched tokens).
 */
function lexAndAlign(old: Side, neu: Side, lang: Language): { a: Int32Array; b: Int32Array; guessed: boolean } {
  const run = (s: Side, open: string | null) => {
    const texts = s.lines.map((l) => l.text);
    if (!open) return lex(texts, lang);
    return lex([open, ...texts], lang).map((t) => ({ ...t, line: Math.max(0, t.line - 1), endLine: Math.max(0, t.endLine - 1) }));
  };
  const attempt = (open: string | null) => {
    const toks = { old: run(old, open), neu: run(neu, open) };
    old.toks = toks.old;
    neu.toks = toks.neu;
    const p = alignHunk(old, neu);
    return { toks, p, unmatched: [...p.a, ...p.b].filter((x) => x < 0).length };
  };
  const plain = attempt(null);
  let best = plain;
  // Only when the open string swallows the changes: one left open after the
  // last change is just a hunk ending inside a docstring.
  const swallows = (s: Side, toks: Tok[]) => {
    const first = s.lines.findIndex((l) => l.changed);
    return first >= 0 && toks.some((t) => isUnclosed(t) && t.line <= first);
  };
  if (lang.multiline.size && (swallows(old, plain.toks.old) || swallows(neu, plain.toks.neu))) {
    for (const open of lang.multiline) {
      const r = attempt(open);
      if (r.unmatched < best.unmatched) best = r;
    }
  }
  old.toks = best.toks.old;
  neu.toks = best.toks.neu;
  return { ...best.p, guessed: best !== plain };
}

/**
 * Hunk fragments the lexer may read differently from Python, so the file
 * mustn't be auto-viewed on their account:
 *  - a multi-line string (or docstring) covering a changed line that starts or
 *    ends on a context line: that quote may really close a string opened above
 *    the hunk (unless the hunk starts at the top of the file), turning code
 *    into "string" and back;
 *  - a changed line with a form feed or a carriage return before its end
 *    (Python reads a lone `\r` as a line break; the diff doesn't).
 */
function ambiguous(s: Side): boolean {
  const unchanged = (l: number) => !s.lines[l]?.changed;
  // From the top of the file nothing can be open above the hunk.
  for (const t of s.lines[0]?.no === 1 ? [] : s.toks) {
    if (t.endLine === t.line || !(t.key.startsWith('\u0002') || t.key.startsWith('\u0003'))) continue;
    let covers = false;
    for (let l = t.line; l <= t.endLine; l++) if (s.lines[l]?.changed) covers = true;
    if (covers && (unchanged(t.line) || unchanged(t.endLine))) return true;
  }
  return s.lines.some((l) => l.changed && (l.text.includes('\f') || /\r(?!$)/.test(l.text)));
}

/** Returns true if the hunk needed the "starts inside a docstring" guess. */
function classifyHunk(h: Hunk, out: FileFormatting, lang: Language): boolean {
  const old = side(h, '-');
  const neu = side(h, '+');
  const partners = lexAndAlign(old, neu, lang);
  markLines(old, partners.a, neu, partners.b);
  markLines(neu, partners.b, old, partners.a);
  wholeStatements(old, partners.a, neu, lang);
  matchImports(old, neu, lang);

  // Re-indented lines (code moved in/out of a block) look like formatting next
  // to the real change that caused them (a removed `try:`); on their own, a
  // dedent can be the logic change itself, so they stay real.
  const realLine = (s: Side) => s.lines.some((l, i) => l.changed && s.real.has(i) && !s.imports.has(i) && !s.reindent.has(i));
  const reindentOk = realLine(old) || realLine(neu);

  // Described against the lines they matched on the other side too (a group
  // may only hold one side's lines, e.g. a re-indented block's old version).
  const describeGroup = (left: number[], right: number[]) => {
    const texts = (s: Side, own: number[], theirs: number[]) => {
      const idx = new Set(own);
      for (const i of theirs) for (const p of (s === old ? neu : old).partners.get(i) ?? []) idx.add(p);
      return [...idx].sort((x, y) => x - y).map((i) => s.lines[i]!.text);
    };
    return describeFormatting(texts(old, left, right), texts(neu, right, left));
  };
  const kindOf = (s: Side, idx: number): FormatKind | null => {
    if (s.imports.has(idx)) return 'imports';
    if (s.reindent.has(idx)) return reindentOk ? 'format' : null;
    if (s.real.has(idx)) return null;
    return s.comment.has(idx) ? 'comment' : 'format';
  };
  const index = { '-': new Map<number, number>(), '+': new Map<number, number>() };
  old.lines.forEach((l, i) => index['-'].set(l.no, i));
  neu.lines.forEach((l, i) => index['+'].set(l.no, i));

  // Groups (one hover highlight + label each): on each side, consecutive
  // dimmed lines of one kind with no visible changed line between them; a
  // left and a right group are joined when their lines matched each other
  // (the old and new version of the same code). Blank lines never split.
  type Group = { side: 'left' | 'right'; kind: FormatKind; run: number; idx: number[]; lines: number[]; joined?: Group };
  const groups: Group[] = [];
  const open: Record<'left' | 'right', Group | null> = { left: null, right: null };
  const byLine = { left: new Map<number, Group>(), right: new Map<number, Group>() };
  // Unchanged lines split groups, except inside a multi-line string or comment (a docstring's blank line).
  const insideToken = new Set<number>();
  for (const t of old.toks) for (let l = t.line + 1; l < t.endLine; l++) insideToken.add(l);
  let run = 0;
  for (const l of h.lines) {
    if (l.kind === ' ') {
      if (!insideToken.has(index['-'].get(l.oldNo!)!)) {
        open.left = open.right = null;
        run++;
      }
      continue;
    }
    const sideName = l.kind === '-' ? 'left' : 'right';
    const s = l.kind === '-' ? old : neu;
    const no = (l.kind === '-' ? l.oldNo : l.newNo)!;
    const idx = index[l.kind].get(no)!;
    const kind = kindOf(s, idx);
    out.changed++;
    if (kind && kind !== 'comment') out.formatting++;
    // Blank lines count as formatting (for `whole`) but aren't marked: they're invisible anyway.
    if (!l.text.trim()) continue;
    if (!kind) {
      open[sideName] = null;
      continue;
    }
    let g = open[sideName];
    if (!g || g.kind !== kind) {
      g = { side: sideName, kind, run, idx: [], lines: [] };
      groups.push(g);
      open[sideName] = g;
    }
    g.idx.push(idx);
    g.lines.push(no);
    byLine[sideName].set(idx, g);
  }
  // Join left groups with the right groups they matched (union-find on `joined`).
  const root = (g: Group): Group => (g.joined ? (g.joined = root(g.joined)) : g);
  for (const g of groups) {
    if (g.side !== 'left') continue;
    for (const i of g.idx)
      for (const p of old.partners.get(i) ?? []) {
        const other = byLine.right.get(p);
        if (other && other.kind === g.kind && root(other) !== root(g)) root(other).joined = root(g);
      }
  }
  // Unmatched counterparts (changed comments have no token partners): the
  // k-th lone left group of a kind pairs with the k-th lone right group in the
  // same stretch, if their numbers agree.
  const lone = (g: Group, side: 'left' | 'right') => !groups.some((o) => o.side !== side && root(o) === root(g));
  const runs = new Map<string, { left: Group[]; right: Group[] }>();
  for (const g of groups) {
    if (!lone(g, g.side)) continue;
    const key = `${g.run}:${g.kind}`;
    const r = runs.get(key) ?? { left: [], right: [] };
    r[g.side].push(g);
    runs.set(key, r);
  }
  for (const { left, right } of runs.values()) {
    if (left.length === right.length) left.forEach((g, i) => (root(right[i]!).joined = root(g)));
  }
  const sets = new Map<Group, Group[]>();
  for (const g of groups) sets.set(root(g), [...(sets.get(root(g)) ?? []), g]);
  for (const [r, members] of sets) {
    const left = members.filter((g) => g.side === 'left');
    const right = members.filter((g) => g.side === 'right');
    const leftLines = left.flatMap((g) => g.lines);
    const rightLines = right.flatMap((g) => g.lines);
    // A single changed comment line isn't worth dimming.
    if (r.kind === 'comment' && Math.max(leftLines.length, rightLines.length) <= 1) continue;
    const reason =
      r.kind === 'imports'
        ? 'imports reordered'
        : r.kind === 'comment'
          ? 'comment changes'
          : `formatting: ${describeGroup(left.flatMap((g) => g.idx), right.flatMap((g) => g.idx))}`;
    out.left.push(...leftLines);
    out.right.push(...rightLines);
    out.blocks.push({ left: leftLines, right: rightLines, kind: r.kind, reason });
  }
  return partners.guessed || ambiguous(old) || ambiguous(neu);
}

/**
 * Token alignment anchored on git's own context lines: each context line's
 * tokens pair with its twin, and changed tokens only align within the same
 * stretch between two context lines. Without anchors, LCS happily pairs a
 * block that moved past unchanged code with its old copy ("formatting").
 */
function alignHunk(old: Side, neu: Side): { a: Int32Array; b: Int32Array } {
  const a = new Int32Array(old.toks.length).fill(-1);
  const b = new Int32Array(neu.toks.length).fill(-1);
  // Context lines come in the same order on both sides; key tokens by
  // ("c", n) for the n-th context line, or ("s", n) for changed tokens after it.
  const buckets = (s: Side) => {
    const ctxBefore: number[] = [];
    let n = 0;
    s.lines.forEach((l, i) => {
      ctxBefore[i] = n;
      if (!l.changed) n++;
    });
    const m = new Map<string, number[]>();
    s.toks.forEach((t, k) => {
      const key = s.lines[t.line]!.changed ? `s${ctxBefore[t.line]}` : `c${ctxBefore[t.line]}`;
      m.set(key, [...(m.get(key) ?? []), k]);
    });
    return m;
  };
  const bo = buckets(old);
  const bn = buckets(neu);
  for (const [key, ko] of bo) {
    const kn = bn.get(key);
    if (!kn) continue;
    const r = align(ko.map((k) => old.toks[k]!.key), kn.map((k) => neu.toks[k]!.key));
    r.a.forEach((j, i) => {
      if (j < 0) return;
      a[ko[i]!] = kn[j]!;
      b[kn[j]!] = ko[i]!;
    });
  }
  return { a, b };
}

/**
 * A short human description of what changed between two versions of some
 * formatting-only lines, for the hover label. Heuristic (character counts),
 * since the lines are already known to be equivalent.
 */
export function describeFormatting(before: string[], after: string[]): string {
  const a = before.filter((l) => l.trim());
  const b = after.filter((l) => l.trim());
  const sa = a.join('').replace(/\s+/g, '');
  const sb = b.join('').replace(/\s+/g, '');
  const differs = (re: RegExp) => (sa.match(re) ?? []).length !== (sb.match(re) ?? []).length;

  const reasons: string[] = [];
  if (a.length !== b.length) reasons.push('line wrapping');
  if (differs(/["'][rbuf]{0,2}["']/gi)) reasons.push('joined strings');
  else if (differs(/'/g)) reasons.push('quote style');
  if (differs(/,(?=[)\]}])/g)) reasons.push('trailing commas');
  if (differs(/\(/g)) reasons.push('parentheses');
  if (differs(/;/g)) reasons.push('semicolons');
  if (sa === sb && a.length === b.length) {
    if (a.every((l, i) => l.trimEnd() === b[i]!.trimEnd())) reasons.push('trailing whitespace');
    else if (a.every((l, i) => l.trim() === b[i]!.trim())) reasons.push('indentation');
    else reasons.push('spacing');
  }
  return reasons.join(', ') || 'whitespace';
}

const isIndent = (t: Tok) => t.key.startsWith('\u0001indent');
const isCommentTok = (t: Tok) => t.key.startsWith('\u0003');
/** Python NEWLINE/indent tokens: all alike, so LCS may pair them with another line's. */
const isLayoutTok = (t: Tok) => t.key.startsWith('\u0001');

/**
 * A changed line is formatting only if every token on it has a partner on the
 * other side *and* those partners are contiguous there. Otherwise tokens were
 * removed from the middle of it: `if a and b:` → `if b:` leaves the new line
 * fully matched, but `a and` is missing between its partners.
 *
 * Python indentation is judged by comparing each line's indentation with its
 * partner line's: a line whose only difference is its indentation goes to
 * `reindent`. (Indentation tokens themselves are ignored for matching: LCS
 * pairs them up arbitrarily, since they all look alike.)
 */
function markLines(s: Side, mine: Int32Array, other: Side, theirs: Int32Array) {
  const byLine = new Map<number, number[]>();
  const indentOf = (side: Side) => new Map(side.toks.filter(isIndent).map((t) => [t.line, t.key]));
  const myIndent = indentOf(s);
  const theirIndent = indentOf(other);
  s.toks.forEach((t, k) => {
    if (isIndent(t)) return;
    for (let l = t.line; l <= t.endLine; l++) byLine.set(l, [...(byLine.get(l) ?? []), k]);
  });
  for (const [line, ks] of byLine) {
    if (ks.some((k) => mine[k]! < 0 && !isLayoutTok(s.toks[k]!) && !isCommentTok(s.toks[k]!))) {
      s.real.add(line);
      continue;
    }
    const ps = ks.filter((k) => mine[k]! >= 0 && !isLayoutTok(s.toks[k]!)).map((k) => mine[k]!);
    if (ps.length) {
      const lo = Math.min(...ps);
      let gap = false;
      for (let q = lo; q <= Math.max(...ps); q++) {
        const t = other.toks[q]!;
        if (theirs[q]! < 0 && !isLayoutTok(t) && !isCommentTok(t)) gap = true;
      }
      if (gap) {
        s.real.add(line);
        continue;
      }
    }
    if (ks.some((k) => mine[k]! < 0 && isCommentTok(s.toks[k]!))) s.comment.add(line);
    if (!ps.length) continue;
    const lo = Math.min(...ps);
    // Same text as the changed line it matched: that line moved (git couldn't
    // align it), which isn't formatting.
    const partnerLines = new Set(ps.map((q) => other.toks[q]!.line));
    s.partners.set(line, [...partnerLines]);
    const twin = partnerLines.size === 1 ? other.lines[other.toks[lo]!.line] : undefined;
    // (Except the last line of both sides: that's "\ No newline at end of file".)
    const lastPair = line === s.lines.length - 1 && other.toks[lo]!.line === other.lines.length - 1;
    if (s.lines[line]!.changed && twin?.changed && twin.text === s.lines[line]!.text && !lastPair) {
      s.real.add(line);
      s.comment.delete(line);
      continue;
    }
    const mineI = myIndent.get(line);
    const theirsI = theirIndent.get(other.toks[lo]!.line);
    if (mineI !== undefined && theirsI !== undefined && mineI !== theirsI) {
      s.real.add(line);
      s.reindent.add(line);
    }
  }
}

/**
 * Lines of one statement go together: if any line of a statement changed for
 * real, all of its changed lines are real (re-wrapped arguments of a call
 * whose target changed aren't "just formatting"). Likewise for the statements
 * on the other side its tokens were matched with, transitively.
 *
 * A statement is a logical line in indentation languages; in brace languages,
 * lines joined by an open `(` or `[`. Comment-only lines belong to no
 * statement. Imports are exempt: each imported name is independent, so a
 * rewrapped import with one new name only shows that name.
 */
function wholeStatements(old: Side, a: Int32Array, neu: Side, lang: Language) {
  const imports = [new Set<number>(), new Set<number>()];
  const groupsOf = (s: Side, i: number) => {
    const g = new Int32Array(s.lines.length).fill(-1);
    const importLines = new Set<number>();
    for (const st of importStatements(s.toks, lang)) importLines.add(st.first);
    const seen = new Set<number>();
    let id = 0;
    let depth = 0;
    let lastLine = -1;
    for (const t of s.toks) {
      if (lang.indentBlocks) {
        if (t.key === END) {
          id++;
          continue;
        }
      } else if (depth === 0 && t.line > lastLine) id++;
      if (!isLayoutTok(t) && !isCommentTok(t)) {
        if (!seen.has(id)) {
          seen.add(id);
          if (importLines.has(t.line)) imports[i]!.add(id);
        }
        for (let l = t.line; l <= t.endLine; l++) if (g[l] === -1) g[l] = id;
        lastLine = t.endLine;
      }
      if (!lang.indentBlocks) {
        if (t.key === '(' || t.key === '[') depth++;
        else if ((t.key === ')' || t.key === ']') && depth > 0) depth--;
      }
    }
    return g;
  };
  const gs = [groupsOf(old, 0), groupsOf(neu, 1)] as const;
  const sides = [old, neu] as const;
  const real = [new Set<number>(), new Set<number>()] as const;
  sides.forEach((s, i) => {
    const g = gs[i]!;
    for (const l of s.real) if (!s.reindent.has(l) && g[l]! >= 0 && !imports[i]!.has(g[l]!)) real[i]!.add(g[l]!);
  });
  for (let changed = true; changed; ) {
    changed = false;
    old.toks.forEach((t, k) => {
      const p = a[k]!;
      if (p < 0 || isLayoutTok(t)) return;
      const go = gs[0][t.line]!;
      const gn = gs[1][neu.toks[p]!.line]!;
      if (go < 0 || gn < 0 || imports[0]!.has(go) || imports[1]!.has(gn) || real[0].has(go) === real[1].has(gn)) return;
      real[0].add(go);
      real[1].add(gn);
      changed = true;
    });
  }
  sides.forEach((s, i) => {
    s.lines.forEach((_, l) => {
      if (!real[i]!.has(gs[i]![l]!)) return;
      s.real.add(l);
      s.reindent.delete(l);
      s.comment.delete(l);
    });
  });
}

/** LCS alignment of two key sequences; returns each position's partner index on the other side, or -1. */
export function align(a: string[], b: string[]): { a: Int32Array; b: Int32Array } {
  const ma = new Int32Array(a.length).fill(-1);
  const mb = new Int32Array(b.length).fill(-1);
  const pair = (i: number, j: number) => {
    ma[i] = j;
    mb[j] = i;
  };
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) pair(p, p++);
  // No common-suffix trim: it would pair a block's last `)` with the last `)`
  // of the hunk. The forward walk below prefers the earliest partner instead.
  const n = a.length - p;
  const m = b.length - p;
  if (!n || !m || n * m > MAX_LCS_CELLS) return { a: ma, b: mb }; // too big: the middle stays unmatched
  // Weighted: pairing a name, number or string beats pairing punctuation, so
  // `import a` → `import b, a` keeps `a` rather than some other line's `,`.
  const weight = (k: string) => (/^[\w\u0002\u0003]/.test(k) ? 4 : 1);
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[p + i] === b[p + j] ? dp[i + 1]![j + 1]! + weight(a[p + i]!) : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[p + i] === b[p + j] && dp[i]![j] === dp[i + 1]![j + 1]! + weight(a[p + i]!)) pair(p + i++, p + j++);
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return { a: ma, b: mb };
}

// ---- imports ----------------------------------------------------------------

interface ImportStmt {
  first: number;
  last: number;
  entries: string[];
  topLevel: boolean;
}


/**
 * Import statements (per the language's import patterns) as sets of entries
 * (`from os import (path, sep)` ≡ `from os import sep` + `from os import
 * path`), so sorting, regrouping and rewrapping imports compare equal.
 */
export function importStatements(toks: Tok[], lang: Language): ImportStmt[] {
  if (!lang.imports.length) return [];
  const stmts: ImportStmt[] = [];
  const firstWords = new Set(lang.imports.flatMap((p) => [...(p.els[0] as { values: Set<string> }).values]));
  const record = (code: Tok[], from: number, whole: boolean, topLevel: boolean, head: Tok) => {
    const view: TokenView = {
      length: code.length,
      key: (i) => code[i]!.key,
      isName: (i) => lang.nameStart.test(code[i]!.key),
      isString: (i) => code[i]!.key.startsWith('\u0002'),
    };
    for (let p = 0; p < lang.imports.length; p++) {
      const m = matchPattern(lang.imports[p]!, view, from, lang.keywords);
      if (!m || (whole && m.end !== code.length)) continue;
      const module = m.module ? code.slice(...m.module).map((t) => t.key).join('') : '';
      const entries = m.entries ? importEntries(view, m.entries).map((e) => `${p}|${module}|${e.join(' ')}`) : [];
      if (!entries.length) entries.push(`${p}|${module}|(side effect)`);
      stmts.push({ first: head.line, last: code[m.end - 1]!.endLine, entries, topLevel });
      return m.end;
    }
    return -1;
  };
  if (lang.indentBlocks) {
    // One logical line each, matched as a whole.
    let start = 0;
    for (let k = 0; k <= toks.length; k++) {
      if (k < toks.length && toks[k]!.key !== END) continue;
      const line = toks.slice(start, k + 1);
      start = k + 1;
      const code = line.filter((t) => !isCommentTok(t) && !isLayoutTok(t));
      if (!code.length || !firstWords.has(code[0]!.key)) continue;
      const head = line.find((t) => t.key.startsWith('\u0001indent')) ?? line[0]!;
      record(code, 0, true, head.topLevel === true, head);
    }
    return stmts;
  }
  // Brace languages: wherever an import word starts a match, outside brackets.
  const code = toks.filter((t) => !isCommentTok(t) && !isLayoutTok(t));
  let depth = 0;
  for (let k = 0; k < code.length; k++) {
    const key = code[k]!.key;
    if (key === '(' || key === '[' || key === '{') depth++;
    else if ((key === ')' || key === ']' || key === '}') && depth > 0) depth--;
    // Not `x.import`, `import(…)` or `import.meta`.
    if (depth || !firstWords.has(key) || code[k - 1]?.key === '.' || ['(', '.'].includes(code[k + 1]?.key ?? '')) continue;
    const end = record(code, k, false, true, code[k]!);
    if (end > 0) k = end - 1;
  }
  return stmts;
}

/**
 * Changed import statements whose entries are the same on both sides (at
 * module level) are imports being sorted/regrouped: their remaining real
 * lines become the "imports" kind.
 */
function matchImports(old: Side, neu: Side, lang: Language) {
  const touched = (s: Side) =>
    importStatements(s.toks, lang).filter((st) => {
      for (let l = st.first; l <= st.last; l++) if (s.lines[l]?.changed) return true;
      return false;
    });
  const a = touched(old);
  const b = touched(neu);
  if (!a.length || !b.length || ![...a, ...b].every((st) => st.topLevel)) return;
  const key = (sts: ImportStmt[]) => sts.flatMap((st) => st.entries).sort().join('\n');
  if (key(a) !== key(b)) return;
  for (const [s, sts] of [[old, a], [neu, b]] as const)
    for (const st of sts) for (let l = st.first; l <= st.last; l++) if (s.real.has(l)) s.imports.add(l);
}
