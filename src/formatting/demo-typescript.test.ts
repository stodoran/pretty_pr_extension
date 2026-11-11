import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { singleRegistry } from '../lang/examples';
import { loadLanguage } from '../lang/registry';
import { detectMoves } from '../moves/detect';
import { parseUnifiedDiff, reverseApply, sideFromDiff, type DiffFile } from '../moves/unified-diff';
import { classifyFile } from './classify';

/**
 * The TypeScript demo PR (demo/typescript/toys → demo/typescript/after, see
 * demo/README.md) as a regression test, with languages/typescript.jsonc.
 */
const DEMO = resolve(__dirname, '../../demo/typescript');
const registry = singleRegistry(loadLanguage(readFileSync(resolve(__dirname, '../../languages/typescript.jsonc'), 'utf8')));
const dir = mkdtempSync(join(tmpdir(), 'prh-demo-ts-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function demoDiff(): DiffFile[] {
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  cpSync(join(DEMO, 'toys'), dir, { recursive: true });
  git('add', '-A');
  git('commit', '-qm', 'base');
  for (const f of readdirSync(join(DEMO, 'after'))) cpSync(join(DEMO, 'after', f), join(dir, f));
  git('add', '-A');
  return parseUnifiedDiff(git('diff', '--cached', '-M', '--no-color'));
}

const files = demoDiff();
const result = (path: string) => {
  const file = files.find((f) => (f.newPath ?? f.oldPath) === path);
  if (!file) throw new Error(`no diff for ${path}`);
  return { file, r: classifyFile(file, registry)! };
};

function verdict(path: string, sideKind: '-' | '+', text: string): string {
  const { file, r } = result(path);
  const dimmed = new Set(sideKind === '-' ? r.left : r.right);
  const hits = file.hunks.flatMap((h) => h.lines).filter((l) => l.kind === sideKind && l.text.trim() === text);
  if (!hits.length) throw new Error(`${path}: no ${sideKind} line "${text}"`);
  const vs = new Set(hits.map((l) => (dimmed.has((sideKind === '-' ? l.oldNo : l.newNo)!) ? 'dim' : 'real')));
  return [...vs].join('+');
}

const reasonOf = (path: string, sideKind: '-' | '+', text: string) => {
  const { file, r } = result(path);
  const l = file.hunks.flatMap((h) => h.lines).find((x) => x.kind === sideKind && x.text.trim() === text)!;
  const no = (sideKind === '-' ? l.oldNo : l.newNo)!;
  return r.blocks.find((b) => (sideKind === '-' ? b.left : b.right).includes(no))?.reason;
};

type Case = [path: string, side: '-' | '+', text: string, expected: 'dim' | 'real', reason?: string];

const CASES: Record<string, Case[]> = {
  'imports sorted, quotes switched': [
    ['fibonacci.ts', '+', 'import { cache, Cache } from "./cache";', 'dim', 'imports reordered'],
    ['fibonacci.ts', '-', "import type { Sequence } from './types';", 'dim'],
  ],
  'import rewrapped with one new name': [
    ['primes.ts', '+', 'import {', 'dim'],
    ['primes.ts', '+', 'fibSequence,', 'dim'],
    ['primes.ts', '+', 'fibMemo,', 'real'],
  ],
  'doc comment reworded': [['fibonacci.ts', '+', '* Nothing here is real code, and it is not maintained.', 'dim', 'comment changes']],
  'line wrapping, operator spacing, trailing commas': [
    ['fibonacci.ts', '+', 'return Math.round(', 'dim', 'formatting: line wrapping, trailing commas'],
    ['fibonacci.ts', '+', '(PHI**n - PSI**n) / Math.sqrt(5),', 'dim'],
  ],
  'quote style': [['fibonacci.ts', '+', 'return "fib(" + n + ") = " + formatNumber(value);', 'dim', 'formatting: quote style']],
  'object literal and signature exploded, method chain wrapped': [
    ['shapes.ts', '+', 'radius: 1,', 'dim'],
    ['shapes.ts', '+', 'includeEmpty = false,', 'dim'],
    ['shapes.ts', '+', '.filter((s) => includeEmpty || s.area() > 0)', 'dim'],
  ],
  'semicolons removed (safe)': [['primes.ts', '+', 'factors.push(d)', 'dim', 'formatting: semicolons']],
  'trailing whitespace': [['sorting.ts', '+', 'const key = out[i];', 'dim', 'formatting: trailing whitespace']],
  'comment lines added': [['primes.ts', '+', '// Sieve of Eratosthenes: every multiple of a prime', 'dim', 'comment changes']],
  'single comment line: left alone': [['primes.ts', '+', '// trial division', 'real']],
  're-indented by a removed try/catch': [
    ['primes.ts', '+', 'const factors = primeFactors(n);', 'dim', 'formatting: indentation'],
    ['primes.ts', '-', 'try {', 'real'],
    ['primes.ts', '+', 'const result = factors.length === 1 && n > 1;', 'real'],
  ],
  'real: changed condition': [['fibonacci.ts', '+', 'while (!(fibIterative(i) >= threshold)) {', 'real']],
  'real: semicolon dropped before a line starting with (': [['primes.ts', '+', 'const pair = [a, b]', 'real']],
  'real: line break after return (ASI)': [['shapes.ts', '+', 'return', 'real']],
  'real: regex and template literal': [
    ['shapes.ts', '+', 'export const VALID_NAME = /^[a-z]+  [a-z]+$/;', 'real'],
    ['shapes.ts', '+', 'return `a ${shape.name}`;', 'real'],
  ],
  'real: changed call with rewrapped arguments': [
    ['sorting.ts', '+', 'const [stats, name] = computeStats(', 'real'],
    ['sorting.ts', '+', 'algorithm.name,', 'real'],
  ],
  'moved code is not formatting': [
    ['fibonacci.ts', '+', 'export function fibMemo(n: number, memo: Cache = cache): number {', 'real'],
    ['sorting.ts', '+', 'export function sortBubble(items: number[]): number[] {', 'real'],
  ],
};

describe('TypeScript demo PR', () => {
  for (const [name, cases] of Object.entries(CASES)) {
    it(name, () => {
      for (const [path, side, text, expected, reason] of cases) {
        expect(`${path} ${side}${text}: ${verdict(path, side, text)}`).toBe(`${path} ${side}${text}: ${expected}`);
        if (reason) expect(reasonOf(path, side, text)).toBe(reason);
      }
    });
  }

  it('a file that is only reformatted is entirely formatting', () => {
    expect(result('matrix.ts').r.whole).toBe(true);
    for (const p of ['fibonacci.ts', 'primes.ts', 'shapes.ts', 'sorting.ts']) expect(result(p).r.whole).toBe(false);
  });
});

describe('TypeScript demo PR: moved code', () => {
  const moves = detectMoves(
    files.map((diff) => {
      const head = diff.status === 'deleted' ? null : readFileSync(join(DEMO, 'after', diff.newPath!), 'utf8');
      return {
        diff,
        base: diff.status === 'added' ? null : diff.status === 'deleted' ? sideFromDiff(diff, 'old') : reverseApply(head!, diff),
        head: diff.status === 'added' ? sideFromDiff(diff, 'new') : head,
      };
    }),
    {},
    registry,
  );
  it('finds each move', () => {
    expect(moves.map((m) => `${m.from.path}:${m.from.qualname} → ${m.to.path}:${m.to.qualname} (${m.kind})`).sort()).toEqual([
      'fibonacci.ts:fibMemo → fibonacci.ts:fibMemo (moved-modified)',
      'primes.ts:gcd → numbersUtil.ts:gcd (moved)',
      'primes.ts:lcm → numbersUtil.ts:lcm (moved)',
      'shapes.ts:Rectangle → rectangle.ts:Rectangle (moved-modified)',
      'sorting.ts:Stack → structures.ts:Stack (moved)',
      'sorting.ts:bubbleSort → sorting.ts:sortBubble (moved)',
    ]);
  });
});
