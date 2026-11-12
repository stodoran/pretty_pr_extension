import type { Language } from '../lang/language';
import { scan, type ScanTok } from '../lang/scan';

/**
 * Lexer for formatting-only detection, on top of the shared scanner and a
 * language file. Produces token *keys* that ignore whitespace and other
 * formatting choices, so two versions of a code fragment that only differ in
 * formatting produce equal key sequences. Each token also records the lines
 * (indexes into the input) it covers.
 *
 * Not a validating parser: it only needs to be precise about what's *not*
 * formatting (string contents, operators, identifiers, and in indentation
 * languages the indentation of each logical line).
 */
export interface Tok {
  key: string;
  /** First and last input line index the token covers. */
  line: number;
  endLine: number;
  /** First token of a logical line at column 0. */
  topLevel?: boolean;
  /** Strings: the opening delimiter. */
  quote?: string;
}

/** `#foo` and `# foo` are the same comment, as are any whitespace runs inside. */
const COMMENT = '\u0003';
const commentKey = (text: string) => `${COMMENT}${text.replace(/\s+/g, ' ').trim()}`;
/** A line break that ends a statement (see `lineBreakEndsStatementAfter`): a real token, not layout. */
const NEWLINE_END = '\u0004nl';
const REGEX = '\u0005';
export const END = '\u0001newline';

const isComment = (t: Tok) => t.key.startsWith(COMMENT);
const isLayout = (t: Tok) => t.key.startsWith('\u0001');

export function lex(lines: string[], lang: Language): Tok[] {
  const raw = scan(lines.join('\n'), lang);
  const toks: Tok[] = [];
  let depth = 0;
  let lineHasTokens = false; // current logical line (indentation languages)

  for (const t of raw) {
    if (t.type === 'nl') {
      if (lang.indentBlocks && depth === 0 && lineHasTokens) {
        toks.push({ key: END, line: t.line, endLine: t.line });
        lineHasTokens = false;
      }
      if (lang.formatting.lineBreakEndsAfter.size && endsStatement(toks, lang)) toks.push({ key: NEWLINE_END, line: t.line, endLine: t.line });
      continue;
    }
    if (lang.indentBlocks && t.lineStart && depth === 0 && t.type !== 'comment') {
      toks.push({ key: `\u0001indent:${t.col}`, line: t.line, endLine: t.line, topLevel: t.col === 0 });
    }
    if (t.type === 'comment') {
      toks.push({ key: commentKey(t.text ?? ''), line: t.line, endLine: t.endLine });
      continue;
    }
    lineHasTokens = true;
    const push = (key: string, extra?: Partial<Tok>) => toks.push({ key, line: t.line, endLine: t.endLine, ...extra });
    if (t.type === 'string') push(stringKey(t, lang), { quote: t.str!.quote });
    else if (t.type === 'number') push(t.value.toLowerCase()); // 0XAB ≡ 0xab, 1E5 ≡ 1e5
    else if (t.type === 'regex') push(`${REGEX}${t.value}`);
    else {
      if (t.type === 'op') {
        if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
        else if ((t.value === ')' || t.value === ']' || t.value === '}') && depth > 0) depth--;
      }
      push(t.value);
    }
  }
  if (lang.indentBlocks && lineHasTokens) {
    const line = Math.max(0, lines.length - 1);
    toks.push({ key: END, line, endLine: line });
  }
  let out = normalize(toks, lang);
  if (lang.implicitConcatenation) out = joinStrings(out, lang);
  if (lang.formatting.wrappingParens) out = dropWrappingParens(out, lang);
  if (lang.docstrings) out = docstringsAsComments(out);
  return out;
}

function stringKey(t: ScanTok, lang: Language): string {
  const { prefix, quote, body, closed } = t.str!;
  const letters = [...prefix.toLowerCase()].filter((c) => !lang.meaninglessPrefixes.has(c)).sort().join('');
  const raw = [...letters].some((c) => lang.rawPrefixes.has(c));
  const group = lang.quoteGroup.get(quote);
  // Quote style is formatting within a group of equivalent quotes ('\'' ≡ "'").
  const kind = group === undefined ? quote : `Q${group}`;
  // Only the group's own quote characters: `\`` stays two characters in Python.
  let text = group !== undefined && !raw ? body.replace(lang.escapedQuote.get(group)!, '$1') : body;
  const interp = lang.interpolation;
  if (interp && (interp.quotes.has(quote) || [...letters].some((c) => interp.prefixes.has(c)))) text = fieldQuotes(text, interp.open, interp.close);
  return `\u0002${letters}${kind}${closed ? '' : '…'}\u0002${text}`;
}

const lastCode = (toks: Tok[]) => {
  for (let k = toks.length - 1; k >= 0; k--) if (!isComment(toks[k]!)) return toks[k]!;
  return undefined;
};

/** Whether a line break here ends the statement (so it is a real token). */
function endsStatement(toks: Tok[], lang: Language): boolean {
  const t = lastCode(toks);
  if (!t || t.key === NEWLINE_END || isLayout(t)) return false;
  const set = lang.formatting.lineBreakEndsAfter;
  if (set.has(t.key)) return true;
  if (set.has('$string') && t.key.startsWith('\u0002')) return true;
  if (set.has('$number') && /^\d/.test(t.key)) return true;
  return set.has('$name') && lang.nameStart.test(t.key);
}

/**
 * A statement that is only a string (a docstring, or a string used as a block
 * comment) is documentation: compared like a comment, so rewrapping its text
 * is formatting and changing it is a comment change.
 */
function docstringsAsComments(toks: Tok[]): Tok[] {
  let start = 0;
  for (let k = 0; k <= toks.length; k++) {
    if (k < toks.length && toks[k]!.key !== END) continue;
    const code = toks.slice(start, k).filter((t) => !isLayout(t) && !isComment(t));
    const isDoc = code.length > 0 && code.every((t) => t.key.startsWith('\u0002') && !header(t.key).includes('…'));
    if (isDoc) for (const t of code) t.key = commentKey(t.key.slice(header(t.key).length));
    start = k + 1;
  }
  return toks;
}

const header = (key: string) => key.slice(0, key.indexOf('\u0002', 1) + 1);

/** Quotes inside interpolated fields: `f"{d['k']}"` ≡ `f'{d["k"]}'`. */
function fieldQuotes(text: string, open: string, close: string): string {
  let depth = 0;
  let out = '';
  for (let k = 0; k < text.length; k++) {
    const ch = text[k]!;
    if (open === '{' && (ch === '{' || ch === '}') && text[k + 1] === ch && depth === 0) {
      out += ch + ch; // escaped brace
      k++;
      continue;
    }
    if (text.startsWith(open, k)) {
      depth++;
      out += open;
      k += open.length - 1;
      continue;
    }
    if (text.startsWith(close, k) && depth > 0) depth--;
    out += depth > 0 && ch === '"' ? "'" : ch;
  }
  return out;
}

/**
 * Implicit concatenation: `'a ' 'b'` ≡ `'a b'` (formatters join and split
 * long strings). Only pieces with the same prefix and quoting merge.
 */
function joinStrings(toks: Tok[], lang: Language): Tok[] {
  const out: Tok[] = [];
  const hdr = (k: string) => (k.startsWith('\u0002') ? header(k) : null);
  const interp = lang.interpolation?.prefixes ?? new Set<string>();
  const plain = (h: string) => [...h].filter((c) => !interp.has(c)).join('');
  const isInterp = (h: string) => [...h].some((c) => interp.has(c));
  for (const t of toks) {
    const prev = out.at(-1);
    const h = hdr(t.key);
    const ph = prev && hdr(prev.key);
    if (prev && h && ph && !h.includes('…') && !ph.includes('…')) {
      const body = t.key.slice(h.length);
      const prevBody = prev.key.slice(ph.length);
      // An f-string and a plain string join into an f-string, if the plain one has no braces to reinterpret.
      const merged =
        ph === h ? h
        : plain(ph) === plain(h) && isInterp(ph) && !/[{}]/.test(body) ? ph
        : plain(ph) === plain(h) && isInterp(h) && !/[{}]/.test(prevBody) ? h
        : null;
      if (merged) {
        out[out.length - 1] = { ...prev, key: merged + prevBody + body, endLine: t.endLine };
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/**
 * Parentheses formatters add or remove to wrap a long line: around a whole
 * right-hand side, return value, assert or condition (`x = (\n  a + b\n)` ≡
 * `x = a + b`). Only when the group spans the whole expression and isn't a
 * tuple, generator or yield.
 */
function dropWrappingParens(toks: Tok[], lang: Language): Tok[] {
  const rules = lang.formatting.wrappingParens!;
  const before = (key: string) => rules.before.has(key) || (key === END && rules.before.has('$end'));
  const drop = new Set<number>();
  const stack: { at: number; commas: number; special: boolean }[] = [];
  for (let k = 0; k < toks.length; k++) {
    const key = toks[k]!.key;
    if (key === '(' || key === '[' || key === '{') stack.push({ at: k, commas: 0, special: false });
    else if (key === ',' && stack.length) stack.at(-1)!.commas++;
    else if ((key === 'for' || key === 'yield') && stack.length) stack.at(-1)!.special = true;
    else if (key === ')' || key === ']' || key === '}') {
      const g = stack.pop();
      if (key !== ')' || !g || toks[g.at]!.key !== '(' || g.special || k === g.at + 1) continue;
      const prev = toks[g.at - 1]?.key ?? '';
      const after = toks[k + 1]?.key ?? END;
      // `from m import (a, b,)` ≡ `from m import a, b`
      if (prev === 'import') {
        drop.add(g.at).add(k);
        if (toks[k - 1]?.key === ',') drop.add(k - 1);
        continue;
      }
      if (g.commas && !(rules.tupleAfter.has(prev) && after === END)) continue;
      if (rules.after.has(prev) && before(after)) drop.add(g.at).add(k);
    }
  }
  return drop.size ? toks.filter((_, k) => !drop.has(k)) : toks;
}

/**
 * Drops tokens whose presence is a formatting choice:
 *  - trailing commas, per `formatting.trailingCommas`. "safe": before `}`;
 *    before `)` of a call; before `)`/`]` when the group already has another
 *    comma (`(a,)` is a tuple, `x[a,]` a tuple index — those stay);
 *  - optional semicolons, unless the next line would continue the statement.
 */
function normalize(toks: Tok[], lang: Language): Tok[] {
  const mode = lang.formatting.trailingCommas;
  const semis = lang.formatting.optionalSemicolons;
  const notCalls = lang.formatting.notCalls;
  const drop = new Set<number>();
  const stack: { open: string; commas: number; call: boolean }[] = [];
  let prev: Tok | undefined; // previous non-comment, non-layout token
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    if (isComment(t) || isLayout(t)) continue;
    if (t.key === '(' || t.key === '[' || t.key === '{') {
      const p = prev?.key ?? '';
      const call = t.key === '(' && ((lang.nameStart.test(p) && !notCalls.has(p)) || p === ')' || p === ']');
      stack.push({ open: t.key, commas: 0, call });
    } else if (t.key === ',') {
      if (stack.length) stack.at(-1)!.commas++;
    } else if (t.key === ')' || t.key === ']' || t.key === '}') {
      const group = stack.pop();
      // No group: its opening bracket is above the hunk (only `}` is safe to judge then).
      if (prev?.key === ',' && mode !== 'never' && (group || t.key === '}' || mode === 'always')) {
        const ok = mode === 'always' || t.key === '}' || (t.key === ')' && group!.call) || group!.commas >= 2;
        if (ok) drop.add(toks.lastIndexOf(prev, k));
      }
    } else if (t.key === ';' && semis) {
      // Without it, a next line starting with one of these would continue the
      // statement, so there the `;` is meaningful.
      const next = toks.slice(k + 1).find((x) => !isComment(x));
      const continues = next && (semis.has(next.key) || (next.quote !== undefined && semis.has(next.quote)) || (next.key.startsWith(REGEX) && semis.has('$regex')));
      if (!continues) {
        drop.add(k);
        continue; // a dropped token isn't "previous"
      }
    }
    prev = t;
  }
  return drop.size ? toks.filter((_, k) => !drop.has(k)) : toks;
}
