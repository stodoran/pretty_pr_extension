import { tokenView } from '../../lang/definitions';
import type { Language } from '../../lang/language';
import { importEntries, matchPattern, type TokenView } from '../../lang/pattern';
import { scan } from '../../lang/scan';
import type { Token } from '../../lang/tokenize';

/**
 * Names *defined* on a line, per the language file: definition names and
 * imported names (plus the module, when it's a dotted name). References are
 * deliberately ignored — the search affordance only appears at definitions.
 */
const DOTTED = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const MAX_TERMS = 5;

/** The line's code tokens (comments dropped). */
function lineTokens(line: string, lang: Language): Token[] {
  return scan(line, lang)
    .filter((t) => t.type !== 'comment' && t.type !== 'nl')
    .map((t) => ({ type: t.type === 'name' ? 'NAME' : t.type === 'string' ? 'STRING' : 'OP', value: t.value, line: 1, endLine: 1 }) as Token);
}

/** The name a definition on this line defines, if it is one. */
export function definitionName(line: string, lang: Language): string | undefined {
  const toks = lineTokens(line, lang);
  const view = tokenView(toks);
  let j = 0;
  while (j < toks.length && toks[j]!.type === 'NAME' && lang.modifiers.has(toks[j]!.value)) j++;
  for (const d of lang.definitions) {
    const m = matchPattern(d.pattern, view, j, lang.keywords, true);
    if (m?.name === undefined) continue;
    // A method without a keyword (`name(args) {`) looks like a call unless its body opens on the line.
    if (d.inside && !toks.slice(m.end).some((t) => t.value === '{' || t.value === '=>')) continue;
    return toks[m.name]!.value;
  }
  return undefined;
}

/** Names imported on this line (real names, not aliases) and the module; null if it isn't an import. */
export function importTerms(line: string, lang: Language): string[] | null {
  const toks = lineTokens(line, lang);
  const view: TokenView = tokenView(toks);
  for (const p of lang.imports) {
    const m = matchPattern(p, view, 0, lang.keywords, true);
    if (!m) continue;
    const names = m.entries
      ? importEntries(view, m.entries).map((e) => {
          const seg = e[0] === '{}' ? e.slice(1) : e;
          const as = seg.indexOf('as');
          return (as < 0 ? seg : seg.slice(0, as)).join('');
        })
      : [];
    const module = m.module && !view.isString(m.module[0]) ? toks.slice(...m.module).map((t) => t.value).join('').replace(/^\.+/, '') : '';
    return [...new Set([...names, module].filter((n) => DOTTED.test(n)))].slice(0, MAX_TERMS);
  }
  return null;
}

export function definitionTerms(line: string, lang: Language): string[] {
  const name = definitionName(line, lang);
  if (name) return [name];
  return importTerms(line, lang) ?? [];
}

export function repoSearchUrl(owner: string, repo: string, term: string): string {
  return `https://github.com/search?q=${encodeURIComponent(`repo:${owner}/${repo} ${term}`)}&type=code`;
}

/** One rendered row of a file's diff, on one side: a hunk header or a numbered code line. */
export type DiffRow = { kind: 'hunk'; text: string } | { kind: 'code'; line: number; text: string };

const MAX_ENCLOSING = 3;

const indentOf = (text: string) => /^[ \t]*/.exec(text)![0].length;
const isBlank = (text: string, lang: Language) => !scan(text, lang).some((t) => t.type !== 'comment' && t.type !== 'nl');

export interface EnclosingDefinition {
  name: string;
  /** Row of its definition line, or of the hunk header naming it when that line isn't shown. */
  row: number;
}

/**
 * The functions/classes enclosing row `index` (innermost first), including the
 * row's own definition if it is a definition line. Found by walking up the
 * visible rows by indentation; where the diff skips lines (a hunk boundary),
 * the hunk header's function context (`@@ -1,2 +1,3 @@ def foo(…`) stands in for the rest.
 */
export function enclosingDefinitions(rows: DiffRow[], index: number, lang: Language): EnclosingDefinition[] {
  const start = rows[index];
  if (start?.kind !== 'code' || isBlank(start.text, lang)) return [];
  const found: EnclosingDefinition[] = [];
  let limit = indentOf(start.text) + 1; // the start row itself may be a definition
  let prevLine = start.line;

  for (let i = index; i >= 0 && limit > 0 && found.length < MAX_ENCLOSING; i--) {
    const row = rows[i]!;
    if (row.kind === 'hunk' || row.line !== prevLine - (i === index ? 0 : 1)) {
      // Lines above are not shown: fall back to the hunk's context, then stop.
      let h = i;
      while (h >= 0 && rows[h]!.kind !== 'hunk') h--;
      const header = rows[h];
      const context = header?.kind === 'hunk' ? /^@@[^@]*@@(.*)$/.exec(header.text)?.[1] : undefined;
      const name = context ? definitionName(context.trim(), lang) : undefined;
      if (name && !found.some((f) => f.name === name)) found.push({ name, row: h });
      break;
    }
    prevLine = row.line;
    const text = row.text;
    if (isBlank(text, lang) || /^\s*[)\]}]/.test(text)) continue; // blank or closing a multi-line expression
    const indent = indentOf(text);
    if (indent >= limit) continue;
    limit = indent;
    const name = definitionName(text, lang);
    if (name) found.push({ name, row: i });
  }
  return found;
}
