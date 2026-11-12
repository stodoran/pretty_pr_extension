import type { Language } from './language';

/**
 * The one tokenizer every feature builds on, driven by a language file.
 * Produces raw tokens (with offsets, for highlighting) plus a token per line
 * break outside strings and comments. Not a validating parser.
 */
export type ScanType = 'name' | 'number' | 'string' | 'op' | 'comment' | 'regex' | 'nl';

export interface ScanTok {
  type: ScanType;
  value: string;
  /** 0-based line where the token starts / ends. */
  line: number;
  endLine: number;
  start: number;
  end: number;
  /** First token on its physical line (not after a line continuation). */
  lineStart?: boolean;
  /** For `lineStart` tokens: the indentation column (tabs to multiples of 8, form feed resets). */
  col?: number;
  str?: { prefix: string; quote: string; body: string; closed: boolean };
  /** Comment text without its markers. */
  text?: string;
}

const NUMBER = /(?:0[xXoObB][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)[jJlLnNuUfFdD]*/y;

export function scan(src: string, lang: Language): ScanTok[] {
  const toks: ScanTok[] = [];
  const n = src.length;
  let i = 0;
  let line = 0;
  let atLineStart = true;
  let lastCode: ScanTok | undefined; // last token that isn't a comment or line break

  const push = (t: Omit<ScanTok, 'line' | 'endLine'> & { line?: number }) => {
    const tok = { ...t, line: t.line ?? line, endLine: line } as ScanTok;
    if (atLineStart && tok.type !== 'nl') {
      tok.lineStart = true;
      let col = 0;
      for (let k = src.lastIndexOf('\n', tok.start - 1) + 1; k < tok.start; k++) {
        const ch = src[k];
        col = ch === '\t' ? (Math.floor(col / 8) + 1) * 8 : ch === '\f' ? 0 : col + 1;
      }
      tok.col = col;
      atLineStart = false;
    }
    toks.push(tok);
    if (tok.type !== 'comment' && tok.type !== 'nl') lastCode = tok;
  };

  while (i < n) {
    const c = src[i]!;
    if (c === '\n') {
      push({ type: 'nl', value: '\n', start: i, end: i + 1 });
      line++;
      i++;
      atLineStart = true;
      continue;
    }
    if (lang.lineContinuation && src.startsWith(lang.lineContinuation, i)) {
      const after = i + lang.lineContinuation.length;
      const nl = src[after] === '\n' ? 1 : src[after] === '\r' && src[after + 1] === '\n' ? 2 : 0;
      if (nl) {
        // Wrapping, not a new line: the next token isn't at a line start.
        i = after + nl;
        line++;
          continue;
      }
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
      continue;
    }

    const lc = lang.lineComments.find((m) => src.startsWith(m, i));
    if (lc) {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      push({ type: 'comment', value: src.slice(i, j).replace(/\r$/, ''), text: src.slice(i + lc.length, j), start: i, end: j });
      i = j;
      continue;
    }
    const bc = lang.blockComments.find(([open]) => src.startsWith(open, i));
    if (bc) {
      const startLine = line;
      const close = src.indexOf(bc[1], i + bc[0].length);
      const j = close < 0 ? n : close + bc[1].length;
      for (let k = i; k < j; k++) if (src[k] === '\n') line++;
      push({ type: 'comment', value: src.slice(i, j), text: src.slice(i + bc[0].length, close < 0 ? n : close), start: i, end: j, line: startLine });
      i = j;
      continue;
    }

    // Strings, with an optional prefix.
    let prefix = '';
    if (lang.prefixes.length) {
      const lower = src.slice(i, i + 3).toLowerCase();
      for (const p of lang.prefixes) {
        if (lower.startsWith(p) && lang.quotes.some((q) => src.startsWith(q, i + p.length))) {
          prefix = src.slice(i, i + p.length);
          break;
        }
      }
    }
    const quote = lang.quotes.find((q) => src.startsWith(q, i + prefix.length));
    if (quote) {
      const startLine = line;
      const multi = lang.multiline.has(quote);
      const bodyStart = i + prefix.length + quote.length;
      let j = bodyStart;
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
          if (!multi) break; // unterminated: stop at the end of the line
          line++;
        }
        j++;
      }
      j = Math.min(j, n);
      const end = closed ? j + quote.length : j;
      push({
        type: 'string',
        value: src.slice(i, end),
        str: { prefix, quote, body: src.slice(bodyStart, j), closed },
        start: i,
        end,
        line: startLine,
      });
      i = end;
      continue;
    }

    if (/[\d.]/.test(c)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      if (m && m[0] !== '.' && m[0].length) {
        push({ type: 'number', value: m[0], start: i, end: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    lang.ident.lastIndex = i;
    const name = lang.ident.exec(src);
    if (name) {
      push({ type: 'name', value: name[0], start: i, end: i + name[0].length });
      i += name[0].length;
      continue;
    }
    if (lang.regexAfterKeywords && c === '/' && regexAllowed(lastCode, lang)) {
      const end = regexEnd(src, i);
      if (end > 0) {
        push({ type: 'regex', value: src.slice(i, end), start: i, end });
        i = end;
        continue;
      }
    }
    const op = lang.operators.find((o) => src.startsWith(o, i)) ?? c;
    push({ type: 'op', value: op, start: i, end: i + op.length });
    i += op.length;
  }
  return toks;
}

/** A `/` starts a regex unless it follows something that ends an operand. */
function regexAllowed(prev: ScanTok | undefined, lang: Language): boolean {
  if (!prev) return true;
  if (prev.type === 'string' || prev.type === 'regex' || prev.type === 'number') return false;
  if (prev.type === 'name') return lang.regexAfterKeywords!.has(prev.value);
  return prev.value !== ')' && prev.value !== ']';
}

/** End index (after flags) of a regex literal starting at `i`, or -1 if it isn't one. */
function regexEnd(src: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j]!;
    if (ch === '\n') return -1;
    if (ch === '\\') j++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      if (j === i + 1) return -1; // `//`
      let e = j + 1;
      while (e < src.length && /[a-z]/i.test(src[e]!)) e++;
      return e;
    }
  }
  return -1;
}
