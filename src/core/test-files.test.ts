import { describe, expect, it } from 'vitest';
import { BUILTIN_TEST_PATTERNS, createTestFileMatcher, type TestPatternConfig } from './test-files';

const base: TestPatternConfig = { defaults: [...BUILTIN_TEST_PATTERNS], overrides: [] };
const isTest = (cfg: TestPatternConfig, path: string, owner = 'acme', repo = 'app') =>
  createTestFileMatcher(cfg, owner, repo)(path).isTest;

describe('builtin patterns', () => {
  it.each([
    'src/foo.test.ts',
    'src/components/Button.spec.tsx',
    'pkg/__tests__/util.js',
    'src/__snapshots__/x.snap',
    'src/test/java/com/acme/FooTest.java',
    'tests/test_api.py',
    'test_api.py',
    'conftest.py',
    'internal/server_test.go',
    'Acme.Core.Tests/ParserTests.cs',
    'spec/models/user_spec.rb',
    'README.md',
    'docs/guide/setup.mdx',
  ])('matches %s', (p) => expect(isTest(base, p)).toBe(true));

  it.each(['src/foo.ts', 'src/testing.ts', 'src/contest/a.ts', 'src/latest/x.ts', 'docs/diagram.svg'])(
    'does not match %s',
    (p) => expect(isTest(base, p)).toBe(false),
  );
});

describe('overrides', () => {
  it('negation wins when it comes later', () => {
    const cfg = { ...base, overrides: [{ scope: 'acme/*', mode: 'extend' as const, patterns: ['!**/test/fixtures/**'] }] };
    expect(isTest(cfg, 'src/test/fixtures/data.ts')).toBe(false);
    expect(isTest(cfg, 'src/test/foo.ts')).toBe(true);
  });

  it('applies org then repo, and replace discards inherited rules', () => {
    const cfg: TestPatternConfig = {
      ...base,
      overrides: [
        { scope: 'acme/app', mode: 'replace', patterns: ['e2e/**'] },
        { scope: 'acme/*', mode: 'extend', patterns: ['**/*.stories.tsx'] },
      ],
    };
    expect(isTest(cfg, 'e2e/login.ts')).toBe(true);
    expect(isTest(cfg, 'src/foo.test.ts')).toBe(false); // replaced at repo level
    expect(isTest(cfg, 'src/foo.test.ts', 'acme', 'other')).toBe(true);
    expect(isTest(cfg, 'src/Button.stories.tsx', 'acme', 'other')).toBe(true);
  });

  it('scopes are case-insensitive and do not leak across owners', () => {
    const cfg = { ...base, overrides: [{ scope: 'ACME/App', mode: 'extend' as const, patterns: ['qa/**'] }] };
    expect(isTest(cfg, 'qa/x.ts')).toBe(true);
    expect(isTest(cfg, 'qa/x.ts', 'other', 'app')).toBe(false);
  });
});
