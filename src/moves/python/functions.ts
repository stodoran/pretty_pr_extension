import type { Token } from './tokenize';

export interface PyFunction {
  kind: 'def' | 'class';
  name: string;
  /** Dotted path through enclosing classes/functions, e.g. `Parser.parse`. */
  qualname: string;
  /** First decorator line, or the `def` line. */
  startLine: number;
  endLine: number;
  /** Tokens from the first decorator through the end of the body, comments removed. */
  tokens: Token[];
  /** Index of the `def` / `class` keyword within `tokens`. */
  defIndex: number;
  params: string[];
}

const isStartOfLogicalLine = (prev: Token | undefined) =>
  !prev || prev.type === 'NEWLINE' || prev.type === 'INDENT' || prev.type === 'DEDENT';

/**
 * Finds every `def` / `async def` (top-level, methods and nested functions),
 * plus `class` definitions when `includeClasses` is set. Results share token
 * objects, so a class's `tokens` contain its methods' tokens by identity.
 */
export function extractFunctions(allTokens: Token[], { includeClasses = false } = {}): PyFunction[] {
  const tokens = allTokens.filter((t) => t.type !== 'COMMENT');
  const out: PyFunction[] = [];
  const scopes: { name: string; bodyLevel: number }[] = [];
  let level = 0;
  let pendingDecorator: number | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.type === 'INDENT') {
      level++;
      continue;
    }
    if (tok.type === 'DEDENT') {
      level--;
      while (scopes.length && scopes.at(-1)!.bodyLevel > level) scopes.pop();
      continue;
    }
    if (!isStartOfLogicalLine(tokens[i - 1])) continue;

    if (tok.type === 'OP' && tok.value === '@') {
      pendingDecorator ??= i;
      continue;
    }
    const isAsyncDef = tok.value === 'async' && tokens[i + 1]?.value === 'def';
    const kwIndex = isAsyncDef ? i + 1 : i;
    const kw = tokens[kwIndex]!;
    if (kw.type !== 'NAME' || (kw.value !== 'def' && kw.value !== 'class') || tokens[kwIndex + 1]?.type !== 'NAME') {
      pendingDecorator = undefined;
      continue;
    }

    const name = tokens[kwIndex + 1]!.value;
    let headerEnd = kwIndex;
    while (headerEnd < tokens.length && tokens[headerEnd]!.type !== 'NEWLINE') headerEnd++;

    let end: number; // exclusive
    const hasBlock = tokens[headerEnd + 1]?.type === 'INDENT';
    if (hasBlock) {
      let depth = 0;
      end = headerEnd + 1;
      for (; end < tokens.length; end++) {
        const t = tokens[end]!;
        if (t.type === 'INDENT') depth++;
        else if (t.type === 'DEDENT' && --depth === 0) break;
      }
    } else {
      end = headerEnd + 1; // one-liner: `def f(): return 1`
    }

    const start = pendingDecorator ?? i;
    pendingDecorator = undefined;

    if (kw.value === 'def' || includeClasses) {
      const range = tokens.slice(start, end);
      const last = [...range].reverse().find((t) => t.type !== 'NEWLINE' && t.type !== 'INDENT' && t.type !== 'DEDENT');
      out.push({
        kind: kw.value === 'def' ? 'def' : 'class',
        name,
        qualname: [...scopes.map((s) => s.name), name].join('.'),
        startLine: tokens[start]!.line,
        endLine: last?.endLine ?? tok.line,
        tokens: range,
        defIndex: kwIndex - start,
        params: kw.value === 'def' ? parseParams(tokens, kwIndex + 2) : [],
      });
    }
    if (hasBlock) scopes.push({ name, bodyLevel: level + 1 });
  }
  return out;
}

/** Parameter names from a `(`…`)` signature starting at `openIndex` (annotations/defaults skipped). */
function parseParams(tokens: Token[], openIndex: number): string[] {
  if (tokens[openIndex]?.value !== '(') return [];
  const params: string[] = [];
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'OP' && '([{'.includes(t.value)) depth++;
    else if (t.type === 'OP' && ')]}'.includes(t.value)) {
      if (--depth === 0) break;
    } else if (depth === 1 && t.type === 'NAME') {
      const prev = tokens[i - 1]!.value;
      if (prev === '(' || prev === ',' || prev === '*' || prev === '**') params.push(t.value);
    }
  }
  return params;
}
