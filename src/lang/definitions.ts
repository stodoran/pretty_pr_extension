import type { Language } from './language';
import { matchPattern, skipGroup, type PatternMatch, type TokenView } from './pattern';
import type { Token } from './tokenize';

export interface Definition {
  kind: 'def' | 'class';
  name: string;
  /** Dotted path through enclosing classes/functions, e.g. `Parser.parse`. */
  qualname: string;
  /** First decorator line, or the definition's first line. */
  startLine: number;
  endLine: number;
  /** Tokens from the first decorator through the end of the body, comments removed. */
  tokens: Token[];
  /** Index of the definition's first token (after decorators and modifiers) within `tokens`. */
  defIndex: number;
  /** Index within `tokens` where the body starts. */
  bodyIndex: number;
  params: string[];
}

export const tokenView = (tokens: Token[]): TokenView => ({
  length: tokens.length,
  key: (i) => tokens[i]!.value,
  isName: (i) => tokens[i]!.type === 'NAME',
  isString: (i) => tokens[i]!.type === 'STRING',
});

const LAYOUT = new Set(['NEWLINE', 'INDENT', 'DEDENT']);

interface Scope {
  name: string;
  kind: 'def' | 'class';
}

/** Tries each definition pattern at `i` (after modifiers). */
function matchDefinition(lang: Language, view: TokenView, tokens: Token[], i: number, inClassBody: boolean) {
  let j = i;
  while (j < tokens.length && tokens[j]!.type === 'NAME' && lang.modifiers.has(tokens[j]!.value)) j++;
  for (const d of lang.definitions) {
    if (d.inside === 'class' && !inClassBody) continue;
    const m = matchPattern(d.pattern, view, j, lang.keywords);
    if (m && m.name !== undefined) return { d, m, at: j };
  }
  return null;
}

/**
 * Every function and class definition (top-level, methods and nested). With
 * `includeClasses` unset only functions are returned. Results share token
 * objects, so a class's `tokens` contain its methods' tokens by identity.
 */
export function extractDefinitions(allTokens: Token[], lang: Language, { includeClasses = false } = {}): Definition[] {
  const tokens = allTokens.filter((t) => t.type !== 'COMMENT');
  return lang.indentBlocks ? indented(tokens, lang, includeClasses) : braced(tokens, lang, includeClasses);
}

function build(
  tokens: Token[],
  lang: Language,
  kind: 'def' | 'class',
  m: PatternMatch,
  at: number,
  start: number,
  end: number,
  bodyAt: number,
  scopes: Scope[],
): Definition {
  const range = tokens.slice(start, end);
  const last = [...range].reverse().find((t) => !LAYOUT.has(t.type));
  const name = tokens[m.name!]!.value;
  return {
    kind,
    name,
    qualname: [...scopes.map((s) => s.name), name].join('.'),
    startLine: tokens[start]!.line,
    endLine: last?.endLine ?? tokens[at]!.line,
    tokens: range,
    defIndex: at - start,
    bodyIndex: bodyAt - start,
    params: kind === 'def' && m.params ? parseParams(tokens, m.params, lang) : [],
  };
}

function indented(tokens: Token[], lang: Language, includeClasses: boolean): Definition[] {
  const view = tokenView(tokens);
  const out: Definition[] = [];
  const scopes: (Scope & { bodyLevel: number })[] = [];
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
    const prev = tokens[i - 1];
    if (prev && !LAYOUT.has(prev.type)) continue; // not the start of a logical line

    if (lang.decorator && tok.type === 'OP' && tok.value === lang.decorator) {
      pendingDecorator ??= i;
      continue;
    }
    const top = scopes.at(-1);
    const hit = matchDefinition(lang, view, tokens, i, top?.kind === 'class' && top.bodyLevel === level);
    if (!hit) {
      pendingDecorator = undefined;
      continue;
    }

    let headerEnd = hit.at;
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
    if (hit.d.kind === 'def' || includeClasses) out.push(build(tokens, lang, hit.d.kind, hit.m, hit.at, start, end, headerEnd + 1, scopes));
    if (hasBlock) scopes.push({ name: tokens[hit.m.name!]!.value, kind: hit.d.kind, bodyLevel: level + 1 });
  }
  return out;
}

function braced(tokens: Token[], lang: Language, includeClasses: boolean): Definition[] {
  const view = tokenView(tokens);
  const out: Definition[] = [];
  // Brace depth before each token.
  const depthAt = new Int32Array(tokens.length + 1);
  for (let k = 0, d = 0; k < tokens.length; k++) {
    depthAt[k] = d;
    const v = tokens[k]!.type === 'OP' ? tokens[k]!.value : '';
    if (v === '{') d++;
    else if (v === '}' && d > 0) d--;
  }
  const scopes: (Scope & { end: number; bodyDepth: number })[] = [];
  let pendingDecorator: number | undefined;
  let afterDecorator = false;

  for (let i = 0; i < tokens.length; i++) {
    while (scopes.length && i >= scopes.at(-1)!.end) scopes.pop();
    const tok = tokens[i]!;
    if (tok.type === 'NEWLINE') continue;
    const prev = tokens[i - 1];
    const atStart = afterDecorator || !prev || prev.type === 'NEWLINE' || (prev.type === 'OP' && (prev.value === ';' || prev.value === '{' || prev.value === '}'));
    afterDecorator = false;
    if (!atStart) continue;

    if (lang.decorator && tok.type === 'OP' && tok.value === lang.decorator && tokens[i + 1]?.type === 'NAME') {
      let k = i + 2;
      while (tokens[k]?.value === '.' && tokens[k + 1]?.type === 'NAME') k += 2;
      if (tokens[k]?.value === '(') k = skipGroup(view, k);
      while (tokens[k]?.type === 'NEWLINE') k++;
      pendingDecorator ??= i;
      afterDecorator = true;
      i = k - 1;
      continue;
    }
    const top = scopes.at(-1);
    const hit = matchDefinition(lang, view, tokens, i, top?.kind === 'class' && depthAt[i] === top.bodyDepth);
    if (!hit) {
      pendingDecorator = undefined;
      continue;
    }

    // The body: the next `{ … }` outside parentheses; an arrow function may
    // instead have an expression body, up to the end of the statement.
    let end = -1;
    let bodyAt = -1;
    let bodyDepth = -1;
    let parens = 0;
    for (let k = hit.m.end; k < tokens.length; k++) {
      const t = tokens[k]!;
      const v = t.type === 'OP' ? t.value : '';
      if (parens === 0 && v === '{') {
        bodyAt = k + 1;
        bodyDepth = depthAt[k]! + 1;
        end = skipGroup(view, k);
        break;
      }
      if (v === '(' || v === '[') parens++;
      else if (v === ')' || v === ']') parens--;
      if (parens < 0 || (parens === 0 && (v === ';' || v === '}' || t.type === 'NEWLINE'))) {
        if (hit.d.arrow) (end = k), (bodyAt = hit.m.end);
        break;
      }
    }
    const start = pendingDecorator ?? i;
    pendingDecorator = undefined;
    if (end < 0) continue; // a declaration without a body
    if (hit.d.kind === 'def' || includeClasses) out.push(build(tokens, lang, hit.d.kind, hit.m, hit.at, start, end, bodyAt, scopes));
    if (bodyDepth >= 0) scopes.push({ name: tokens[hit.m.name!]!.value, kind: hit.d.kind, end, bodyDepth });
  }
  return out;
}

const PARAM_AFTER = new Set(['(', ',', '*', '**', '...']);

/** Parameter names from the `$params` capture (annotations and defaults skipped). */
function parseParams(tokens: Token[], [from, to]: [number, number], lang: Language): string[] {
  if (tokens[from]?.value !== '(') return tokens[from]?.type === 'NAME' ? [tokens[from]!.value] : [];
  const params: string[] = [];
  let depth = 0;
  for (let i = from; i < to; i++) {
    const t = tokens[i]!;
    if (t.type === 'OP' && '([{'.includes(t.value)) depth++;
    else if (t.type === 'OP' && ')]}'.includes(t.value)) {
      if (--depth === 0) break;
    } else if (depth === 1 && t.type === 'NAME' && !lang.modifiers.has(t.value)) {
      let k = i - 1;
      while (k > from && tokens[k]!.type === 'NAME' && lang.modifiers.has(tokens[k]!.value)) k--;
      if (PARAM_AFTER.has(tokens[k]!.value)) params.push(t.value);
    }
  }
  return params;
}
