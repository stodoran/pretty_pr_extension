import type { Language } from './language';
import { scan, type ScanTok } from './scan';

/**
 * Statement-level token stream for whole files (moved code, definitions),
 * modelled on CPython's `tokenize`: logical NEWLINEs, and for indentation
 * languages INDENT/DEDENT. In brace languages a NEWLINE marks a statement
 * boundary: after `;`, `{` and `}`, and at a line break outside parentheses
 * where neither side continues the expression (a heuristic).
 */
export type TokenType = 'NAME' | 'NUMBER' | 'STRING' | 'OP' | 'COMMENT' | 'NEWLINE' | 'INDENT' | 'DEDENT';

export interface Token {
  type: TokenType;
  value: string;
  /** 1-based line where the token starts / ends (differs for multi-line strings). */
  line: number;
  endLine: number;
}

const TYPE: Record<Exclude<ScanTok['type'], 'nl'>, TokenType> = {
  name: 'NAME',
  number: 'NUMBER',
  string: 'STRING',
  regex: 'STRING',
  op: 'OP',
  comment: 'COMMENT',
};

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
/** Operators that end an expression, so a line break after them can end the statement. */
const ENDS_EXPR = new Set([')', ']', '}', '++', '--', ';']);
/** Operators that can start a statement, so a line starting with them doesn't continue the previous one. */
const STARTS_STMT = new Set(['(', '[', '{', '}', '!', '~', '++', '--', '-', '+', '@', '#', '<', '*']);

export function tokenize(src: string, lang: Language): Token[] {
  const raw = scan(src, lang);
  const lastLine = src.split('\n').length;
  return lang.indentBlocks ? indented(raw, lastLine) : braced(raw, lastLine);
}

const tok = (t: ScanTok): Token => ({ type: TYPE[t.type as Exclude<ScanTok['type'], 'nl'>], value: t.value, line: t.line + 1, endLine: t.endLine + 1 });

function indented(raw: ScanTok[], lastLine: number): Token[] {
  const out: Token[] = [];
  const indents = [0];
  let depth = 0;
  let logicalHasTokens = false;
  for (const t of raw) {
    const line = t.line + 1;
    if (t.type === 'nl') {
      if (depth === 0 && logicalHasTokens) out.push({ type: 'NEWLINE', value: '', line, endLine: line });
      if (depth === 0) logicalHasTokens = false;
      continue;
    }
    if (t.lineStart && depth === 0 && t.type !== 'comment') {
      const col = t.col ?? 0;
      if (col > indents.at(-1)!) {
        indents.push(col);
        out.push({ type: 'INDENT', value: '', line, endLine: line });
      } else {
        while (col < indents.at(-1)!) {
          indents.pop();
          out.push({ type: 'DEDENT', value: '', line, endLine: line });
        }
      }
    }
    out.push(tok(t));
    if (t.type === 'comment') continue;
    logicalHasTokens = true;
    if (t.type === 'op' && OPEN.has(t.value)) depth++;
    else if (t.type === 'op' && CLOSE.has(t.value) && depth > 0) depth--;
  }
  if (logicalHasTokens) out.push({ type: 'NEWLINE', value: '', line: lastLine, endLine: lastLine });
  while (indents.length > 1) {
    indents.pop();
    out.push({ type: 'DEDENT', value: '', line: lastLine, endLine: lastLine });
  }
  return out;
}

function braced(raw: ScanTok[], lastLine: number): Token[] {
  const out: Token[] = [];
  let parens = 0;
  let prev: ScanTok | undefined; // last code token
  const newline = (line: number) => {
    let last: Token | undefined;
    for (let k = out.length - 1; k >= 0 && !last; k--) if (out[k]!.type !== 'COMMENT') last = out[k];
    if (last && last.type !== 'NEWLINE') out.push({ type: 'NEWLINE', value: '', line, endLine: line });
  };
  for (let k = 0; k < raw.length; k++) {
    const t = raw[k]!;
    if (t.type === 'nl') {
      if (parens > 0 || !prev) continue;
      const next = raw.slice(k + 1).find((x) => x.type !== 'nl' && x.type !== 'comment');
      const prevContinues = prev.type === 'op' && !ENDS_EXPR.has(prev.value);
      const nextContinues = next?.type === 'op' && !STARTS_STMT.has(next.value);
      if (!prevContinues && !nextContinues) newline(t.line + 1);
      continue;
    }
    if (t.type === 'op' && t.value === '}') newline(t.line + 1);
    out.push(tok(t));
    if (t.type === 'comment') continue;
    prev = t;
    if (t.type !== 'op') continue;
    if (t.value === '(' || t.value === '[') parens++;
    else if ((t.value === ')' || t.value === ']') && parens > 0) parens--;
    if (t.value === ';' || t.value === '{' || t.value === '}') newline(t.endLine + 1);
  }
  newline(lastLine);
  return out;
}
