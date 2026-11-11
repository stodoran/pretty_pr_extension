/**
 * Names *defined* on a line of Python: `def`/`async def`/`class` names and
 * imported names (plus the module for `from x import …`). References are
 * deliberately ignored — the search affordance only appears at definitions.
 */
const DEF = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/;
const CLASS = /^\s*class\s+([A-Za-z_]\w*)/;
const FROM = /^\s*from\s+(\.*[\w.]*)\s+import\s+(.*)$/;
const IMPORT = /^\s*import\s+(.+)$/;
const IDENT = /^[A-Za-z_]\w*$/;
const DOTTED = /^[A-Za-z_][\w.]*$/;
const MAX_TERMS = 5;

/** `a as b, c` → [a, c] (search the real name, not the alias). */
const importedNames = (list: string, valid: RegExp) =>
  list
    .replace(/[()\\]/g, '')
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/)[0]!.trim())
    .filter((name) => valid.test(name));

export function definitionTerms(line: string): string[] {
  const code = line.replace(/\s#.*$/, '');
  let m = DEF.exec(code) ?? CLASS.exec(code);
  if (m) return [m[1]!];

  m = FROM.exec(code);
  if (m) {
    const module = m[1]!.replace(/^\.+/, ''); // relative imports: search the module name itself
    return [...new Set([...importedNames(m[2]!, IDENT), ...(module ? [module] : [])])].slice(0, MAX_TERMS);
  }
  m = IMPORT.exec(code);
  if (m) return [...new Set(importedNames(m[1]!, DOTTED))].slice(0, MAX_TERMS);
  return [];
}

export function repoSearchUrl(owner: string, repo: string, term: string): string {
  return `https://github.com/search?q=${encodeURIComponent(`repo:${owner}/${repo} ${term}`)}&type=code`;
}

/** One rendered row of a file's diff, on one side: a hunk header or a numbered code line. */
export type DiffRow = { kind: 'hunk'; text: string } | { kind: 'code'; line: number; text: string };

const DEF_OR_CLASS = /^\s*(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/;
/** Hunk headers carry git's function context: `@@ -1,2 +1,3 @@ def foo(…`. */
const HUNK_CONTEXT = /^@@[^@]*@@\s*(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/;
const MAX_ENCLOSING = 3;

const indentOf = (text: string) => /^[ \t]*/.exec(text)![0].length;
const isBlank = (text: string) => !text.replace(/#.*$/, '').trim();

export interface EnclosingDefinition {
  name: string;
  /** Row of its `def`/`class` line, or of the hunk header naming it when that line isn't shown. */
  row: number;
}

/**
 * The functions/classes enclosing row `index` (innermost first), including the
 * row's own definition if it is a `def`/`class` line. Found by walking up the
 * visible rows by indentation; where the diff skips lines (a hunk boundary),
 * the hunk header's function context stands in for the rest.
 */
export function enclosingDefinitions(rows: DiffRow[], index: number): EnclosingDefinition[] {
  const start = rows[index];
  if (start?.kind !== 'code' || isBlank(start.text)) return [];
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
      const name = header?.kind === 'hunk' ? HUNK_CONTEXT.exec(header.text)?.[1] : undefined;
      if (name && !found.some((f) => f.name === name)) found.push({ name, row: h });
      break;
    }
    prevLine = row.line;
    const text = row.text;
    if (isBlank(text) || /^\s*[)\]}]/.test(text)) continue; // blank or closing a multi-line expression
    const indent = indentOf(text);
    if (indent >= limit) continue;
    limit = indent;
    const name = DEF_OR_CLASS.exec(text)?.[1];
    if (name) found.push({ name, row: i });
  }
  return found;
}
