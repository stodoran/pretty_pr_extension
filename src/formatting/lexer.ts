/**
 * Python lexer for formatting-only detection. Produces token *keys* that
 * ignore whitespace and other formatting choices, so two versions of a code
 * fragment that only differ in formatting produce equal key sequences. Each
 * token also records the lines (indexes into the input) it covers.
 *
 * Not a validating parser: it only needs to be precise about what's *not*
 * formatting (string contents, operators, identifiers, and the indentation
 * of each logical line).
 */

const PYTHON = /\.pyi?$/;

export const isPython = (path: string) => PYTHON.test(path);

export interface Tok {
  key: string;
  /** First and last input line index the token covers. */
  line: number;
  endLine: number;
  /** First token of a logical line at column 0. */
  topLevel?: boolean;
}

// Longest first (maximal munch), so `a ** b` and `a * * b` don't compare equal.
const OPERATORS = [
  '...', '**=', '//=', '>>=', '<<=', '->', ':=', '**', '//', '==', '!=', '<=', '>=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', '<<', '>>',
];
const NAME = /[A-Za-z_À-￿][\wÀ-￿]*/y;
const NUMBER = /(?:0[xXoObB][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)[jJlLnNuUfFdD]*/y;
const PY_PREFIX = /[rRbBuUfF]{1,2}(?=['"])/y;

/** `#foo` and `# foo` are the same comment, as are any whitespace runs inside. */
const COMMENT = '\u0003';
const commentKey = (text: string) => `${COMMENT}${text.replace(/\s+/g, ' ').trim()}`;

export function lex(lines: string[]): Tok[] {
  const src = lines.join('\n');
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;
  let line = 0;
  let depth = 0;
  let atLineStart = true;
  let lineHasTokens = false; // current logical line

  const push = (key: string, startLine: number) => {
    toks.push({ key, line: startLine, endLine: line });
    lineHasTokens = true;
  };

  while (i < n) {
    if (atLineStart && depth === 0) {
      atLineStart = false;
      let col = 0;
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) {
        col = src[j] === '\t' ? (Math.floor(col / 8) + 1) * 8 : col + 1;
        j++;
      }
      i = j;
      // Blank and comment-only lines don't start a logical line.
      if (j < n && src[j] !== '\n' && src[j] !== '#') {
        toks.push({ key: `\u0001indent:${col}`, line, endLine: line, topLevel: col === 0 });
      }
      continue;
    }
    const c = src[i]!;
    if (c === '\n') {
      if (depth === 0 && lineHasTokens) {
        toks.push({ key: '\u0001newline', line, endLine: line });
        lineHasTokens = false;
      }
      line++;
      i++;
      atLineStart = true;
      continue;
    }
    if (c === '\\' && src[i + 1] === '\n') {
      // Line continuation: wrapping, not a new logical line.
      line++;
      i += 2;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    atLineStart = false; // a line inside brackets started; its closing bracket mustn't look like an indent

    if (c === '#') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      // Not a "token" for logical-line tracking.
      toks.push({ key: commentKey(src.slice(i + 1, j)), line, endLine: line });
      i = j;
      continue;
    }

    // Strings
    PY_PREFIX.lastIndex = i;
    const prefix = PY_PREFIX.exec(src)?.[0] ?? '';
    const q = src[i + prefix.length];
    if (q === "'" || q === '"') {
      const triple = src.startsWith(q.repeat(3), i + prefix.length);
      const quote = triple ? q.repeat(3) : q;
      const start = line;
      let j = i + prefix.length + quote.length;
      const bodyStart = j;
      let closed = false;
      while (j < n) {
        const ch = src[j]!;
        if (ch === '\\') {
          if (src[j + 1] === '\n') line++;
          j += 2;
          continue;
        }
        if (src.startsWith(quote, j)) {
          closed = true;
          break;
        }
        if (ch === '\n') {
          if (!triple) break; // unterminated: stop at end of line
          line++;
        }
        j++;
      }
      const body = src.slice(bodyStart, Math.min(j, n));
      const p = prefix.toLowerCase().replace('u', '');
      const raw = p.includes('r');
      // Quote style is formatting: ' and " are equivalent ('\'' ≡ "'").
      const kind = triple ? 'Q3' : 'Q';
      let text = raw ? body : body.replace(/\\(['"])/g, '$1');
      if (p.includes('f')) text = fstringQuotes(text);
      push(`\u0002${p}${kind}${closed ? '' : '…'}\u0002${text}`, start);
      i = closed ? j + quote.length : j;
      continue;
    }

    if (/[\d.]/.test(c)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      if (m && m[0] !== '.' && m[0].length) {
        push(m[0].toLowerCase(), line); // 0XAB ≡ 0xab, 1E5 ≡ 1e5
        i += m[0].length;
        continue;
      }
    }
    NAME.lastIndex = i;
    const name = NAME.exec(src);
    if (name) {
      push(name[0], line);
      i += name[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i)) ?? c;
    if (op === '(' || op === '[' || op === '{') depth++;
    else if ((op === ')' || op === ']' || op === '}') && depth > 0) depth--;
    push(op, line);
    i += op.length;
  }
  if (lineHasTokens) toks.push({ key: '\u0001newline', line, endLine: line });
  return docstringsAsComments(dropWrappingParens(joinStrings(normalize(toks))));
}

/**
 * A Python statement that is only a string (a docstring, or a string used as
 * a block comment) is documentation: compared like a comment, so rewrapping
 * its text is formatting and changing it is a comment change.
 */
function docstringsAsComments(toks: Tok[]): Tok[] {
  let start = 0;
  for (let k = 0; k <= toks.length; k++) {
    if (k < toks.length && toks[k]!.key !== '\u0001newline') continue;
    const code = toks.slice(start, k).filter((t) => !t.key.startsWith('\u0001') && !t.key.startsWith(COMMENT));
    const isDoc = code.length > 0 && code.every((t) => t.key.startsWith('\u0002') && !header(t.key).includes('…'));
    if (isDoc) for (const t of code) t.key = commentKey(t.key.slice(header(t.key).length));
    start = k + 1;
  }
  return toks;
}

const header = (key: string) => key.slice(0, key.indexOf('\u0002', 1) + 1);

/** Quotes inside an f-string's `{…}` fields: `f"{d['k']}"` ≡ `f'{d["k"]}'`. */
function fstringQuotes(text: string): string {
  let depth = 0;
  let out = '';
  for (let k = 0; k < text.length; k++) {
    const ch = text[k]!;
    if ((ch === '{' || ch === '}') && text[k + 1] === ch && depth === 0) {
      out += ch + ch; // escaped brace
      k++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && depth > 0) depth--;
    out += depth > 0 && ch === '"' ? "'" : ch;
  }
  return out;
}

/**
 * Implicit concatenation: `'a ' 'b'` ≡ `'a b'` (formatters join and
 * split long strings). Only pieces with the same prefix and quoting merge.
 */
function joinStrings(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  const header = (k: string) => (k.startsWith('\u0002') ? k.slice(0, k.indexOf('\u0002', 1) + 1) : null);
  for (const t of toks) {
    const prev = out.at(-1);
    const h = header(t.key);
    const ph = prev && header(prev.key);
    if (prev && h && ph && !h.includes('…') && !ph.includes('…')) {
      const body = t.key.slice(h.length);
      const prevBody = prev.key.slice(ph.length);
      // An f-string and a plain string join into an f-string, if the plain one has no braces to reinterpret.
      const fOf = (x: string) => x.replace('f', '');
      const merged =
        ph === h ? h
        : fOf(ph) === fOf(h) && ph.includes('f') && !/[{}]/.test(body) ? ph
        : fOf(ph) === fOf(h) && h.includes('f') && !/[{}]/.test(prevBody) ? h
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

const WRAP_AFTER = new Set(['=', 'return', 'assert', 'if', 'elif', 'while', 'in', 'del', ':', ',', ':=', '+=', '-=', '*=', '/=', '//=', '%=', '|=', '&=', '**=']);
/** `x = (a, b)` ≡ `x = a, b` and `return (a, b)` ≡ `return a, b`: a tuple either way. */
const TUPLE_OK = new Set(['=', 'return']);
const WRAP_BEFORE = new Set(['\u0001newline', ':', ',']);

/**
 * Parentheses formatters add or remove to wrap a long line: around a whole
 * right-hand side, return value, assert or condition (`x = (\n  a + b\n)` ≡
 * `x = a + b`). Only when the group spans the whole expression and isn't a
 * tuple, generator or yield.
 */
function dropWrappingParens(toks: Tok[]): Tok[] {
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
      const before = toks[g.at - 1]?.key ?? '';
      const after = toks[k + 1]?.key ?? '\u0001newline';
      // `from m import (a, b,)` ≡ `from m import a, b`
      if (before === 'import') {
        drop.add(g.at).add(k);
        if (toks[k - 1]?.key === ',') drop.add(k - 1);
        continue;
      }
      if (g.commas && !(TUPLE_OK.has(before) && after === '\u0001newline')) continue;
      if (WRAP_AFTER.has(before) && WRAP_BEFORE.has(after)) drop.add(g.at).add(k);
    }
  }
  return drop.size ? toks.filter((_, k) => !drop.has(k)) : toks;
}

const isComment = (t: Tok) => t.key.startsWith(COMMENT);
/** Keywords a `(` can follow without being a call (`print`/`exec`: Python 2 statements). */
const KEYWORDS = new Set([
  'if', 'elif', 'while', 'for', 'in', 'not', 'and', 'or', 'return', 'yield', 'await', 'assert', 'del', 'lambda',
  'with', 'except', 'is', 'else', 'case', 'match', 'from', 'raise', 'async', 'global', 'nonlocal', 'import',
  'print', 'exec',
]);
const isName = (key: string) => /^[A-Za-z_À-￿]/.test(key);

/**
 * Drops trailing commas where they can't change meaning: before `}`; before
 * `)` of a call; before `)`/`]` when the group already has another comma
 * (`(a,)` is a tuple, `x[a,]` a tuple index — those stay).
 */
function normalize(toks: Tok[]): Tok[] {
  const drop = new Set<number>();
  const stack: { open: string; commas: number; call: boolean }[] = [];
  let prev: Tok | undefined; // previous non-comment, non-layout token
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    if (isComment(t) || t.key.startsWith('\u0001')) continue;
    if (t.key === '(' || t.key === '[' || t.key === '{') {
      const p = prev?.key ?? '';
      const call = t.key === '(' && ((isName(p) && !KEYWORDS.has(p)) || p === ')' || p === ']');
      stack.push({ open: t.key, commas: 0, call });
    } else if (t.key === ',') {
      if (stack.length) stack.at(-1)!.commas++;
    } else if (t.key === ')' || t.key === ']' || t.key === '}') {
      const group = stack.pop();
      // No group: its opening bracket is above the hunk (only `}` is safe to judge then).
      if (prev?.key === ',' && (group || t.key === '}')) {
        const ok = t.key === '}' || (t.key === ')' && group!.call) || group!.commas >= 2;
        if (ok) drop.add(toks.lastIndexOf(prev, k));
      }
    }
    prev = t;
  }
  return drop.size ? toks.filter((_, k) => !drop.has(k)) : toks;
}
