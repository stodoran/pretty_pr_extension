import type { PyFunction } from './functions';
import type { Token } from './tokenize';

/**
 * Turns a function into a token sequence that is stable under the edits a
 * move/refactor typically brings along:
 *   - comments, docstring and formatting (incl. black's magic trailing commas) are dropped
 *   - parameters and local variables are renamed `$0, $1, …` in order of first use
 *   - the function's own name (definition and recursive calls) becomes `FN`
 *   - string quote style is unified
 * Attribute names, called globals, literals and structure are kept: those
 * carry the meaning that decides whether two functions are "the same".
 *
 * Classes: names in the class body (attributes, method names) are public API,
 * so they are kept; each method inside is normalized on its own (its locals
 * renamed) and spliced in. Pass every definition of the file in `defs` so the
 * methods can be found (by their first token).
 */
export function normalizeFunction(fn: PyFunction, defs: PyFunction[] = [], keepName = false): string[] {
  const toks = stripDocstring(fn);
  const isClass = fn.kind === 'class';
  const locals = isClass ? new Set<string>() : collectLocals(toks, fn);
  const children = new Map<Token, PyFunction>();
  if (isClass) for (const d of defs) if (d !== fn && d.tokens[0]) children.set(d.tokens[0], d);
  const rename = new Map<string, string>();
  const out: string[] = [];

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const prev = toks[i - 1];
    const child = i > fn.defIndex ? children.get(t) : undefined;
    const childEnd = child ? toks.indexOf(child.tokens.at(-1)!, i) : -1;
    if (child && childEnd >= i) {
      out.push(...normalizeFunction(child, defs, true));
      i = childEnd;
      continue;
    }
    switch (t.type) {
      case 'INDENT':
        out.push('→');
        break;
      case 'DEDENT':
        out.push('←');
        break;
      case 'NEWLINE':
        out.push('⏎');
        break;
      case 'STRING':
        out.push(normalizeString(t.value));
        break;
      case 'NAME': {
        if (prev?.value === '.') out.push(t.value); // attribute
        else if (locals.has(t.value)) {
          if (!rename.has(t.value)) rename.set(t.value, `$${rename.size}`);
          out.push(rename.get(t.value)!);
        } else if (!keepName && t.value === fn.name && (prev?.value === 'def' || prev?.value === 'class' || prev?.type !== 'NAME')) out.push('FN');
        else out.push(t.value);
        break;
      }
      case 'OP':
        if (t.value === ',' && /^[)\]}]$/.test(toks[i + 1]?.value ?? '')) break; // trailing comma
        out.push(t.value);
        break;
      default:
        out.push(t.value);
    }
  }
  return out;
}

function stripDocstring(fn: PyFunction): Token[] {
  const toks = fn.tokens;
  let h = fn.defIndex;
  while (h < toks.length && toks[h]!.type !== 'NEWLINE') h++;
  if (toks[h + 1]?.type === 'INDENT' && toks[h + 2]?.type === 'STRING' && toks[h + 3]?.type === 'NEWLINE') {
    return [...toks.slice(0, h + 2), ...toks.slice(h + 4)];
  }
  return toks;
}

function splitLogicalLines(toks: Token[]): Token[][] {
  const lines: Token[][] = [];
  let cur: Token[] = [];
  for (const t of toks) {
    if (t.type === 'NEWLINE') {
      if (cur.length) lines.push(cur);
      cur = [];
    } else if (t.type !== 'INDENT' && t.type !== 'DEDENT') cur.push(t);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

const AUG_ASSIGN = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '>>=', '<<=', '&=', '|=', '^=', '@=']);
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** Names bound inside the function: params, assignment/for/with/except targets, walrus, lambda params, nested defs. */
function collectLocals(toks: Token[], fn: PyFunction): Set<string> {
  const locals = new Set(fn.params);
  const globals = new Set<string>();
  const bodyStart = toks.findIndex((t, i) => i > fn.defIndex && t.type === 'NEWLINE');

  /** NAME tokens that are plain bindings (not `a.b`, `a[0]`, `a(...)`). */
  const addTargets = (seg: Token[]) => {
    let depth = 0;
    for (let k = 0; k < seg.length; k++) {
      const t = seg[k]!;
      if (t.type === 'OP' && OPEN.has(t.value)) depth++;
      else if (t.type === 'OP' && CLOSE.has(t.value)) depth--;
      else if (t.type === 'OP' && t.value === ':' && depth === 0) return; // annotation follows
      else if (t.type === 'NAME' && seg[k - 1]?.value !== '.' && !['.', '(', '['].includes(seg[k + 1]?.value ?? '')) {
        locals.add(t.value);
      }
    }
  };

  for (const line of splitLogicalLines(bodyStart < 0 ? [] : toks.slice(bodyStart + 1))) {
    const first = line[0]!;
    if (first.value === 'global' || first.value === 'nonlocal') {
      line.slice(1).forEach((t) => t.type === 'NAME' && globals.add(t.value));
      continue;
    }
    if ((first.value === 'def' || first.value === 'class') && line[1]?.type === 'NAME') locals.add(line[1].value);
    if (first.value === 'async' && line[1]?.value === 'def' && line[2]?.type === 'NAME') locals.add(line[2].value);

    // Top-level `=` / augmented assignment: everything left of the last one is a target.
    let depth = 0;
    let lastAssign = -1;
    for (let k = 0; k < line.length; k++) {
      const t = line[k]!;
      if (t.type !== 'OP') continue;
      if (OPEN.has(t.value)) depth++;
      else if (CLOSE.has(t.value)) depth--;
      else if (depth === 0 && (t.value === '=' || AUG_ASSIGN.has(t.value))) lastAssign = k;
    }
    if (lastAssign > 0) {
      let segStart = 0;
      for (let k = 0; k <= lastAssign; k++) {
        const v = line[k]!.value;
        if (line[k]!.type === 'OP' && (v === '=' || AUG_ASSIGN.has(v))) {
          addTargets(line.slice(segStart, k));
          segStart = k + 1;
        }
      }
    }

    for (let k = 0; k < line.length; k++) {
      const t = line[k]!;
      if (t.type === 'OP' && t.value === ':=' && line[k - 1]?.type === 'NAME') locals.add(line[k - 1]!.value);
      if (t.type === 'NAME' && t.value === 'as' && line[k + 1]?.type === 'NAME') locals.add(line[k + 1]!.value);
      if (t.type === 'NAME' && t.value === 'for') {
        const inIdx = line.findIndex((x, m) => m > k && x.type === 'NAME' && x.value === 'in');
        if (inIdx > k) addTargets(line.slice(k + 1, inIdx));
      }
      if (t.type === 'NAME' && t.value === 'lambda') {
        for (let m = k + 1; m < line.length && line[m]!.value !== ':'; m++) {
          const p = line[m - 1]!.value;
          if (line[m]!.type === 'NAME' && (m === k + 1 || p === ',' || p === '*' || p === '**')) locals.add(line[m]!.value);
        }
      }
    }
  }
  for (const g of globals) locals.delete(g);
  return locals;
}

function normalizeString(value: string): string {
  const m = /^([a-zA-Z]*)([\s\S]*)$/.exec(value)!;
  const prefix = m[1]!.toLowerCase();
  let body = m[2]!;
  if (body.startsWith("'''") && body.endsWith("'''") && !body.slice(3, -3).includes('"""')) {
    body = `"""${body.slice(3, -3)}"""`;
  } else if (body.startsWith("'") && !body.startsWith("'''") && !body.slice(1, -1).includes('"')) {
    body = `"${body.slice(1, -1)}"`;
  }
  return prefix + body;
}
