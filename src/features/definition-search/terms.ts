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
