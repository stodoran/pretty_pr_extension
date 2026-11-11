/**
 * Token patterns from language files (definitions, imports). See the header
 * of languages/python.jsonc for the syntax.
 */

export type PatternEl =
  | { kind: 'lit'; values: Set<string>; optional: boolean }
  | { kind: 'name' }
  | { kind: 'params'; optional: boolean }
  | { kind: 'generics' }
  | { kind: 'entries' }
  | { kind: 'skip' }
  | { kind: 'module' };

export interface Pattern {
  source: string;
  els: PatternEl[];
}

export function compilePattern(source: string): Pattern {
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error('empty pattern');
  const els = parts.map((p): PatternEl => {
    if (p === '$name') return { kind: 'name' };
    if (p === '$params' || p === '$params?') return { kind: 'params', optional: p.endsWith('?') };
    if (p === '$generics') return { kind: 'generics' };
    if (p === '$entries') return { kind: 'entries' };
    if (p === '$skip') return { kind: 'skip' };
    if (p === '$module') return { kind: 'module' };
    if (p.startsWith('$')) throw new Error(`unknown placeholder ${p}`);
    const optional = p.length > 1 && p.endsWith('?');
    const values = (optional ? p.slice(0, -1) : p).split('|').filter(Boolean);
    if (!values.length) throw new Error(`bad token "${p}"`);
    return { kind: 'lit', values: new Set(values), optional };
  });
  return { source, els };
}

/** The tokens a pattern is matched against. */
export interface TokenView {
  length: number;
  key(i: number): string;
  isName(i: number): boolean;
  isString(i: number): boolean;
}

export interface PatternMatch {
  start: number;
  /** Index after the last matched token. */
  end: number;
  name?: number;
  params?: [number, number];
  entries?: [number, number];
  module?: [number, number];
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** Index after the bracket group opening at `i` (or the end, if it never closes). */
export function skipGroup(v: TokenView, i: number, open = OPEN, close = CLOSE): number {
  let depth = 0;
  for (let k = i; k < v.length; k++) {
    const key = v.key(k);
    if (open.has(key)) depth++;
    else if (close.has(key) && --depth === 0) return k + 1;
  }
  return v.length;
}

const ANGLE_OPEN = new Set(['<']);
const ANGLE_CLOSE = new Set(['>']);

/**
 * Matches `p` at token `start`. `keywords` can't be `$name`s. `lenient` lets an
 * unclosed parameter list or a pattern cut off by the end of the tokens match
 * (for a single line of a diff).
 */
export function matchPattern(p: Pattern, v: TokenView, start: number, keywords: Set<string>, lenient = false): PatternMatch | null {
  const m: PatternMatch = { start, end: start };
  let i = start;
  for (let e = 0; e < p.els.length; e++) {
    const el = p.els[e]!;
    if (i >= v.length) {
      if (lenient && e > 0 && p.els.slice(e).every((x) => x.kind !== 'name')) break;
      if ((el.kind === 'lit' && el.optional) || el.kind === 'generics' || (el.kind === 'params' && el.optional)) continue;
      return null;
    }
    const key = v.key(i);
    switch (el.kind) {
      case 'lit':
        if (el.values.has(key)) i++;
        else if (!el.optional) return null;
        break;
      case 'name':
        if (!v.isName(i) || keywords.has(key)) return null;
        m.name = i++;
        break;
      case 'params':
        if (key === '(') {
          const end = skipGroup(v, i);
          if (end === v.length && !lenient && !CLOSE.has(v.key(end - 1))) return null;
          m.params = [i, end];
          i = end;
        } else if (v.isName(i) && !keywords.has(key)) {
          m.params = [i, i + 1];
          i++;
        } else if (!el.optional) return null;
        break;
      case 'generics':
        if (key === '<') i = skipGroup(v, i, ANGLE_OPEN, ANGLE_CLOSE);
        break;
      case 'skip': {
        // Anything (brackets balanced) up to the next word of the pattern, within the statement.
        const next = p.els.slice(e + 1).find((x) => x.kind === 'lit') as Extract<PatternEl, { kind: 'lit' }> | undefined;
        if (!next) return null;
        let depth = 0;
        for (; i < v.length; i++) {
          const k = v.key(i);
          if (depth === 0 && next.values.has(k)) break;
          if (depth === 0 && (k === ';' || k === '')) return null;
          if (OPEN.has(k)) depth++;
          else if (CLOSE.has(k) && --depth < 0) return null;
        }
        if (i >= v.length && !lenient) return null;
        break;
      }
      case 'entries': {
        const next = p.els.slice(e + 1).find((x) => x.kind === 'lit') as Extract<PatternEl, { kind: 'lit' }> | undefined;
        const from = i;
        let depth = 0;
        for (; i < v.length; i++) {
          const k = v.key(i);
          if (depth === 0 && (k === ';' || next?.values.has(k))) break;
          if (OPEN.has(k)) depth++;
          else if (CLOSE.has(k)) depth--;
        }
        if (i === from) return null;
        m.entries = [from, i];
        break;
      }
      case 'module': {
        const from = i;
        if (v.isString(i)) i++;
        else {
          while (i < v.length && v.key(i) === '.') i++;
          if (i < v.length && v.isName(i) && !keywords.has(v.key(i))) {
            i++;
            while (i + 1 < v.length && v.key(i) === '.' && v.isName(i + 1) && !keywords.has(v.key(i + 1))) i += 2;
          }
        }
        if (i === from) return null;
        m.module = [from, i];
        break;
      }
    }
  }
  m.end = i;
  return m;
}

/**
 * Import entries: the comma-separated names, brackets dropped; names inside
 * `{}` are marked (named vs default imports in JavaScript).
 */
export function importEntries(v: TokenView, [from, to]: [number, number]): string[][] {
  const out: string[][] = [];
  let braces = false;
  let seg: string[] = [];
  const flush = () => {
    if (seg.length) out.push(braces ? ['{}', ...seg] : seg);
    seg = [];
  };
  for (let i = from; i < to; i++) {
    const k = v.key(i);
    if (k === '(' || k === ')') continue;
    if (k === '{') (flush(), (braces = true));
    else if (k === '}') (flush(), (braces = false));
    else if (k === ',') flush();
    else seg.push(k);
  }
  flush();
  return out;
}
