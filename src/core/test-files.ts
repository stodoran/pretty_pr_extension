import picomatch from 'picomatch';

/**
 * Pure (browser-free) test-file classification so it can be unit tested and
 * reused by future features (e.g. "hide tests from moved-code analysis").
 */

export type OverrideMode = 'extend' | 'replace';

export interface PatternOverride {
  /** `owner/*` for a whole org/user, or `owner/repo` for one repository. */
  scope: string;
  /** `extend` appends to inherited patterns; `replace` discards them first. */
  mode: OverrideMode;
  patterns: string[];
}

export interface TestPatternConfig {
  defaults: string[];
  overrides: PatternOverride[];
}

export interface Rule {
  pattern: string;
  /** Where the rule came from: `defaults` or an override scope. */
  source: string;
}

export interface MatchResult {
  isTest: boolean;
  /** The rule that decided the outcome (last match wins), if any. */
  rule?: Rule;
}

export const MARKDOWN_PATTERN = '**/*.{md,mdx,markdown}';

export const BUILTIN_TEST_PATTERNS: readonly string[] = [
  '**/*.{test,spec}.*',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/__snapshots__/**',
  '**/{test,tests,spec}/**',
  '**/testdata/**',
  '**/test_*.py',
  '**/conftest.py',
  '**/*_test.{go,py,rb,exs}',
  '**/*_spec.rb',
  '**/*{Test,Tests}.{java,kt,cs,swift,scala}',
  '**/*.{Test,Tests}/**',
  // Docs: not tests, but equally skippable on first review.
  MARKDOWN_PATTERN,
];

function scopeSpecificity(scope: string, owner: string, repo: string): number {
  const [o, r] = scope.trim().toLowerCase().split('/');
  if (o !== owner.toLowerCase()) return -1;
  if (r === '*' || r === undefined || r === '') return 1;
  return r === repo.toLowerCase() ? 2 : -1;
}

/** Resolve the ordered rule list for a repo: defaults → org overrides → repo overrides. */
export function rulesForRepo(cfg: TestPatternConfig, owner: string, repo: string): Rule[] {
  let rules: Rule[] = cfg.defaults.map((pattern) => ({ pattern, source: 'defaults' }));
  const applicable = cfg.overrides
    .map((o) => ({ o, specificity: scopeSpecificity(o.scope, owner, repo) }))
    .filter((x) => x.specificity > 0)
    .sort((a, b) => a.specificity - b.specificity); // stable: config order kept within a level

  for (const { o } of applicable) {
    const added = o.patterns.map((pattern) => ({ pattern, source: o.scope }));
    rules = o.mode === 'replace' ? added : [...rules, ...added];
  }
  return rules.filter((r) => r.pattern.trim() !== '');
}

/**
 * Gitignore-like semantics: rules are evaluated in order, the last matching
 * rule wins, and a leading `!` negates (marks the file as NOT a test).
 * Patterns without a slash match against the basename.
 */
export function createTestFileMatcher(
  cfg: TestPatternConfig,
  owner: string,
  repo: string,
): (path: string) => MatchResult {
  const compiled = rulesForRepo(cfg, owner, repo).map((rule) => {
    const p = rule.pattern.trim();
    const negated = p.startsWith('!');
    const glob = negated ? p.slice(1) : p;
    return { rule, negated, test: picomatch(glob, { dot: true, basename: !glob.includes('/') }) };
  });

  return (path) => {
    let result: MatchResult = { isTest: false };
    for (const c of compiled) {
      if (c.test(path)) result = { isTest: !c.negated, rule: c.rule };
    }
    return result;
  };
}
