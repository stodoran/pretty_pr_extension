import { tokenView, type Definition } from './definitions';
import { matchPattern } from './pattern';
import type { Language } from './language';
import type { Token } from './tokenize';

/**
 * Turns a definition into a token sequence that is stable under the edits a
 * move/refactor typically brings along:
 *   - comments, docstring and formatting (incl. magic trailing commas) are dropped
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
export function normalizeDefinition(fn: Definition, lang: Language, defs: Definition[] = [], keepName = false): string[] {
  const toks = stripDocstring(fn, lang);
  const isClass = fn.kind === 'class';
  const locals = isClass ? new Set<string>() : collectLocals(toks, fn, lang);
  const children = new Map<Token, Definition>();
  if (isClass) for (const d of defs) if (d !== fn && d.tokens[0]) children.set(d.tokens[0], d);
  const rename = new Map<string, string>();
  const out: string[] = [];
  const optionalSemicolons = !!lang.formatting.optionalSemicolons;

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const prev = toks[i - 1];
    const child = i > fn.defIndex ? children.get(t) : undefined;
    const childEnd = child ? toks.indexOf(child.tokens.at(-1)!, i) : -1;
    if (child && childEnd >= i) {
      out.push(...normalizeDefinition(child, lang, defs, true));
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
        // Brace languages: statement boundaries are a guess, and the braces carry the structure.
        if (lang.indentBlocks) out.push('⏎');
        break;
      case 'STRING':
        out.push(normalizeString(t.value, lang));
        break;
      case 'NAME': {
        if (prev && lang.memberAccess.has(prev.value)) out.push(t.value); // attribute
        else if (locals.has(t.value)) {
          if (!rename.has(t.value)) rename.set(t.value, `$${rename.size}`);
          out.push(rename.get(t.value)!);
        } else if (!keepName && t.value === fn.name && (lang.definitionKeywords.has(prev?.value ?? '') || prev?.type !== 'NAME')) out.push('FN');
        else out.push(t.value);
        break;
      }
      case 'OP': {
        let next = i + 1;
        while (toks[next]?.type === 'NEWLINE') next++;
        if (t.value === ',' && /^[)\]}]$/.test(toks[next]?.value ?? '')) break; // trailing comma
        if (t.value === ';' && optionalSemicolons) break;
        out.push(t.value);
        break;
      }
      default:
        out.push(t.value);
    }
  }
  return out;
}

function stripDocstring(fn: Definition, lang: Language): Token[] {
  const toks = fn.tokens;
  if (!lang.docstrings) return toks;
  const h = fn.bodyIndex - 1; // the header's NEWLINE
  if (toks[h]?.type === 'NEWLINE' && toks[h + 1]?.type === 'INDENT' && toks[h + 2]?.type === 'STRING' && toks[h + 3]?.type === 'NEWLINE') {
    return [...toks.slice(0, h + 2), ...toks.slice(h + 4)];
  }
  return toks;
}

function splitStatements(toks: Token[]): Token[][] {
  const lines: Token[][] = [];
  let cur: Token[] = [];
  for (const t of toks) {
    if (t.type === 'NEWLINE' || (t.type === 'OP' && (t.value === ';' || t.value === '{' || t.value === '}'))) {
      if (cur.length) lines.push(cur);
      cur = [];
    } else if (t.type !== 'INDENT' && t.type !== 'DEDENT') cur.push(t);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** Names bound inside the function, per the language's `locals` rules, plus nested definitions. */
function collectLocals(toks: Token[], fn: Definition, lang: Language): Set<string> {
  const rules = lang.locals;
  const locals = new Set(fn.params);
  const globals = new Set<string>();
  const body = toks.slice(Math.max(fn.bodyIndex, fn.defIndex + 1));

  /** NAME tokens that are plain bindings (not `a.b`, `a[0]`, `a(...)`). */
  const addTargets = (seg: Token[]) => {
    let depth = 0;
    for (let k = 0; k < seg.length; k++) {
      const t = seg[k]!;
      if (t.type === 'OP' && OPEN.has(t.value)) depth++;
      else if (t.type === 'OP' && CLOSE.has(t.value)) depth--;
      else if (t.type === 'OP' && t.value === ':' && depth === 0) return; // annotation follows
      else if (
        t.type === 'NAME' &&
        !lang.memberAccess.has(seg[k - 1]?.value ?? '') &&
        !lang.memberAccess.has(seg[k + 1]?.value ?? '') &&
        !['(', '['].includes(seg[k + 1]?.value ?? '') &&
        !lang.keywords.has(t.value)
      ) {
        locals.add(t.value);
      }
    }
  };

  for (const line of splitStatements(body)) {
    const first = line[0]!;
    // Nested definitions are local names.
    const view = tokenView(line);
    let j = 0;
    while (j < line.length && lang.modifiers.has(line[j]!.value)) j++;
    for (const d of lang.definitions) {
      const m = matchPattern(d.pattern, view, j, lang.keywords, true);
      if (m?.name !== undefined) {
        locals.add(line[m.name]!.value);
        break;
      }
    }
    if (rules.globals.has(first.value)) {
      line.slice(1).forEach((t) => t.type === 'NAME' && globals.add(t.value));
      continue;
    }

    if (rules.assignment) {
      // Top-level assignment: everything left of the last one is a target.
      let depth = 0;
      let lastAssign = -1;
      for (let k = 0; k < line.length; k++) {
        const t = line[k]!;
        if (t.type !== 'OP') continue;
        if (OPEN.has(t.value)) depth++;
        else if (CLOSE.has(t.value)) depth--;
        else if (depth === 0 && rules.assignmentOperators.has(t.value)) lastAssign = k;
      }
      if (lastAssign > 0) {
        let segStart = 0;
        for (let k = 0; k <= lastAssign; k++) {
          if (line[k]!.type === 'OP' && rules.assignmentOperators.has(line[k]!.value)) {
            addTargets(line.slice(segStart, k));
            segStart = k + 1;
          }
        }
      }
    }

    for (let k = 0; k < line.length; k++) {
      const t = line[k]!;
      if (rules.bindBefore.has(t.value) && line[k - 1]?.type === 'NAME') locals.add(line[k - 1]!.value);
      if (t.type !== 'NAME') continue;
      if (rules.bindAfter.has(t.value) && line[k + 1]?.type === 'NAME') locals.add(line[k + 1]!.value);
      if (rules.declarations.has(t.value)) {
        // `let a = …`, `const { a, b } = …`, `for (const x of …)`
        let m = k + 1;
        let depth = 0;
        for (; m < line.length; m++) {
          const v = line[m]!.value;
          if (OPEN.has(v)) depth++;
          else if (CLOSE.has(v)) {
            if (--depth < 0) break;
          } else if (depth === 0 && (v === '=' || v === 'of' || v === 'in' || v === ':')) break;
        }
        addTargets(line.slice(k + 1, m));
      }
      for (const [open, close] of rules.loops) {
        if (t.value !== open) continue;
        const end = line.findIndex((x, m) => m > k && x.type === 'NAME' && x.value === close);
        if (end > k) addTargets(line.slice(k + 1, end));
      }
      if (rules.lambda && t.value === rules.lambda[0]) {
        for (let m = k + 1; m < line.length && line[m]!.value !== rules.lambda[1]; m++) {
          const p = line[m - 1]!.value;
          if (line[m]!.type === 'NAME' && (m === k + 1 || p === ',' || p === '*' || p === '**')) locals.add(line[m]!.value);
        }
      }
    }
  }
  for (const g of globals) locals.delete(g);
  return locals;
}

/** Quote style and meaningless prefixes unified: `'a'` ≡ `"a"`, `u'a'` ≡ `'a'`. */
export function normalizeString(value: string, lang: Language): string {
  let prefix = '';
  for (const p of lang.prefixes) {
    if (value.toLowerCase().startsWith(p) && lang.quotes.some((q) => value.startsWith(q, p.length))) {
      prefix = value.slice(0, p.length);
      break;
    }
  }
  const rest = value.slice(prefix.length);
  const quote = lang.quotes.find((q) => rest.startsWith(q));
  const letters = [...prefix.toLowerCase()].filter((c) => !lang.meaninglessPrefixes.has(c)).sort().join('');
  if (!quote) return letters + rest;
  const group = lang.quoteGroup.get(quote);
  const closed = rest.length >= 2 * quote.length && rest.endsWith(quote);
  const body = rest.slice(quote.length, closed ? -quote.length : undefined);
  if (group === undefined) return `${letters}${quote}${body}${closed ? quote : ''}`;
  const raw = [...letters].some((c) => lang.rawPrefixes.has(c));
  return `${letters}Q${group}:${raw ? body : body.replace(/\\(['"`])/g, '$1')}${closed ? '' : '…'}`;
}
