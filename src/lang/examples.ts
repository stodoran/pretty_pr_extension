import { definitionTerms } from '../features/definition-search/terms';
import { classifyFile } from '../formatting/classify';
import { parseUnifiedDiff } from '../moves/unified-diff';
import { languageMatches, type Language } from './language';
import type { Registry } from './registry';

/** A registry with just this language (for checking a file on its own). */
export function singleRegistry(lang: Language): Registry {
  return {
    languages: [lang],
    forPath: (path) => (languageMatches(lang, path) ? lang : null),
    byId: (id) => (id === lang.id ? lang : null),
    hash: lang.id,
    errors: {},
  };
}

const splitLines = (text: string) => {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

/** A one-hunk unified diff of two texts (exact line comparison). */
export function diffOf(path: string, before: string, after: string): string {
  const a = splitLines(before);
  const b = splitLines(after);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const body: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) (body.push(` ${a[i++]}`), j++);
    else if (j < b.length && (i >= a.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)) body.push(`+${b[j++]}`);
    else body.push(`-${a[i++]}`);
  }
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${a.length} +1,${b.length} @@\n${body.join('\n')}\n`;
}

/** Runs a language file's examples; returns a message per failing one. */
export function runExamples(lang: Language): string[] {
  const failures: string[] = [];
  const registry = singleRegistry(lang);
  const path = `example${lang.extensions[0]}`;
  (lang.spec.examples ?? []).forEach((ex, i) => {
    const where = `examples[${i}]`;
    if ('line' in ex) {
      const got = definitionTerms(ex.line, lang);
      if (got.join('\n') !== ex.defines.join('\n')) failures.push(`${where}: "${ex.line}" defines [${got.join(', ')}], expected [${ex.defines.join(', ')}]`);
      return;
    }
    const [file] = parseUnifiedDiff(diffOf(path, ex.before, ex.after));
    const r = file && classifyFile(file, registry);
    if (!r) {
      failures.push(`${where}: before and after are the same, or formatting detection is off`);
      return;
    }
    const got = r.changed > 0 && r.formatting === r.changed ? 'formatting' : 'real';
    if (got !== ex.expect) failures.push(`${where}: expected "${ex.expect}", got "${got}" (${r.formatting} of ${r.changed} changed lines are formatting)`);
  });
  return failures;
}
