/**
 * Small Python tokenizer, modelled on CPython's `tokenize`: emits logical
 * NEWLINEs and INDENT/DEDENT tokens, ignores newlines inside brackets and
 * after backslash continuations, and handles (triple-quoted, prefixed)
 * strings and comments. Precise enough to find function boundaries and
 * identifiers; not a validating parser.
 */
export type TokenType = 'NAME' | 'NUMBER' | 'STRING' | 'OP' | 'COMMENT' | 'NEWLINE' | 'INDENT' | 'DEDENT';

export interface Token {
  type: TokenType;
  value: string;
  /** 1-based line where the token starts / ends (differs for multi-line strings). */
  line: number;
  endLine: number;
}

const STRING_START = /([rRbBuUfF]{0,2})('''|"""|'|")/y;
const NUMBER = /(?:0[xXoObB][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[jJ]?)/y;
const NAME = /[A-Za-z_\u00C0-\uFFFF][\w\u00C0-\uFFFF]*/y;
const OPERATORS = [
  '**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '>>', '<<', '<=', '>=', '==', '!=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=',
  '(', ')', '[', ']', '{', '}', ':', ',', ';', '.', '+', '-', '*', '/', '%', '&', '|', '^', '~', '<', '>', '=', '@', '!',
];

function matchAt(re: RegExp, src: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(src);
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const indents = [0];
  const n = src.length;
  let i = 0;
  let line = 1;
  let depth = 0; // bracket nesting
  let atLineStart = true;
  let logicalHasTokens = false;

  const push = (type: TokenType, value: string, startLine: number) => {
    tokens.push({ type, value, line: startLine, endLine: line });
    if (type !== 'COMMENT') logicalHasTokens = true;
  };

  while (i < n) {
    if (atLineStart && depth === 0) {
      atLineStart = false;
      let col = 0;
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\f')) {
        col = src[j] === '\t' ? (Math.floor(col / 8) + 1) * 8 : src[j] === ' ' ? col + 1 : 0;
        j++;
      }
      i = j;
      const c = src[j];
      // Blank and comment-only lines don't affect indentation.
      if (j >= n || c === '\n' || c === '\r' || c === '#') continue;
      if (col > indents.at(-1)!) {
        indents.push(col);
        tokens.push({ type: 'INDENT', value: '', line, endLine: line });
      } else {
        while (col < indents.at(-1)!) {
          indents.pop();
          tokens.push({ type: 'DEDENT', value: '', line, endLine: line });
        }
      }
      continue;
    }

    const c = src[i]!;
    if (c === '\n') {
      if (depth === 0 && logicalHasTokens) tokens.push({ type: 'NEWLINE', value: '', line, endLine: line });
      if (depth === 0) logicalHasTokens = false;
      line++;
      i++;
      atLineStart = true;
      continue;
    }
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
      i += src[i + 1] === '\n' ? 2 : 3;
      line++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      push('COMMENT', src.slice(i, j).replace(/\r$/, ''), line);
      i = j;
      continue;
    }

    const str = matchAt(STRING_START, src, i);
    if (str && (str[1] === '' || /^[rRbBuUfF]+$/.test(str[1]!))) {
      const quote = str[2]!;
      const triple = quote.length === 3;
      const startLine = line;
      let j = i + str[0].length;
      while (j < n) {
        const ch = src[j]!;
        if (ch === '\\') {
          if (src[j + 1] === '\n') line++;
          j += 2;
          continue;
        }
        if (src.startsWith(quote, j)) {
          j += quote.length;
          break;
        }
        if (ch === '\n') {
          if (!triple) break; // unterminated single-quoted string: stop at EOL
          line++;
        }
        j++;
      }
      push('STRING', src.slice(i, j), startLine);
      i = j;
      continue;
    }

    const num = /[\d.]/.test(c) ? matchAt(NUMBER, src, i) : null;
    if (num && num[0] !== '.' && num[0].length) {
      push('NUMBER', num[0], line);
      i += num[0].length;
      continue;
    }
    const name = matchAt(NAME, src, i);
    if (name) {
      push('NAME', name[0], line);
      i += name[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i)) ?? c;
    if (op === '(' || op === '[' || op === '{') depth++;
    else if ((op === ')' || op === ']' || op === '}') && depth > 0) depth--;
    push('OP', op, line);
    i += op.length;
  }

  if (logicalHasTokens) tokens.push({ type: 'NEWLINE', value: '', line, endLine: line });
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ type: 'DEDENT', value: '', line, endLine: line });
  }
  return tokens;
}
