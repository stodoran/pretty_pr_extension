import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectMoves } from '../moves/detect';
import { parseUnifiedDiff, reverseApply, sideFromDiff, type DiffFile } from '../moves/unified-diff';
import { readFileSync } from 'node:fs';
import { classifyFile, hasMarks } from './classify';

/**
 * The demo PR (demo/toys → demo/after, see demo/README.md) as a regression
 * test: every case in it, with what the formatting detector should say.
 */
const DEMO = resolve(__dirname, '../../demo');
const dir = mkdtempSync(join(tmpdir(), 'prh-demo-'));
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
  return { file, r: classifyFile(file)! };
};

/** "dim" or "real" for the changed line(s) with this exact (trimmed) text on that side. */
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
  'imports sorted and regrouped': [
    ['fibonacci.py', '+', 'import sys', 'dim', 'imports reordered'],
    ['fibonacci.py', '-', 'from functools import lru_cache', 'dim'],
    ['fibonacci.py', '+', 'from typing import Iterator, List, Optional', 'dim'],
  ],
  'import rewrapped with one new name': [
    ['primes.py', '+', 'from fibonacci import (', 'dim'],
    ['primes.py', '+', 'fib_sequence,', 'dim'],
    ['primes.py', '+', 'fib_iterative,', 'real'],
  ],
  'line wrapping, operator spacing, wrapping parentheses': [
    ['fibonacci.py', '+', 'return round(', 'dim'],
    ['fibonacci.py', '+', '(phi**n - psi**n) / math.sqrt(5)', 'dim'],
    ['shapes.py', '+', 'return Rectangle(', 'dim'],
  ],
  'quote style': [['fibonacci.py', '+', 'print("fib(%d) = %d" % (n, value), file=sys.stderr)', 'dim', 'formatting: quote style']],
  'magic trailing comma': [
    ['shapes.py', '+', 'def largest(', 'dim'],
    ['shapes.py', '+', 'include_zero_area=False,', 'dim'],
  ],
  'joined strings': [
    ['primes.py', '+', 'message = "Found %d primes in %s; the largest checked was %d" % (', 'dim'],
    ['primes.py', '+', 'count,', 'dim'],
  ],
  'trailing whitespace': [['sorting.py', '+', 'key = items[i]', 'dim', 'formatting: trailing whitespace']],
  'docstring rewrap': [['shapes.py', '+', '"""A circle given by its centre', 'dim']],
  'docstring text change': [['fibonacci.py', '+', 'this is real code, and it is not maintained.', 'dim', 'comment changes']],
  'one-line docstring rewritten over two lines (the only change in its file)': [
    ['epochs.py', '+', '"""Advance the counter up to and including ``epoch``. An earlier epoch is ignored: on a resume,', 'dim', 'comment changes'],
  ],
  'comment lines added': [['primes.py', '+', '# Classic sieve of Eratosthenes: every multiple of a prime', 'dim', 'comment changes']],
  'single comment line: left alone': [['primes.py', '+', '# trial division', 'real']],
  're-indented by a removed try/except': [
    ['primes.py', '+', 'factors = [d for d in range(2, n) if n % d == 0]', 'dim', 'formatting: indentation'],
    ['primes.py', '-', 'try:', 'real'],
    ['primes.py', '+', 'if result and n > 2:', 'real'],
  ],
  'real: changed condition': [['fibonacci.py', '+', 'if x >= (threshold or 100):', 'real']],
  'real: dedent only': [['sorting.py', '+', 'print("done")', 'real']],
  'real: changed call with rewrapped arguments': [
    ['sorting.py', '+', 'stats, name = compute_stats(', 'real'],
    ['sorting.py', '+', 'algorithm.__name__,', 'real'],
  ],
  'real: tuple trailing comma, whitespace in a string': [
    ['shapes.py', '+', 'kind = (name)', 'real'],
    ['shapes.py', '+', 'label = "a " + name.lower()', 'real'],
  ],
  'moved code is not formatting': [
    ['fibonacci.py', '+', 'def fib_memo(n):', 'real'],
    ['fibonacci.py', '+', 'if n <= 1:', 'real'],
    ['shapes.py', '+', 'class Rectangle:', 'real'],
    ['sorting.py', '+', 'def sort_bubble(items):', 'real'],
    ['primes.py', '-', 'def gcd(a, b):', 'real'],
  ],
  'real: test change': [['test_fibonacci.py', '+', 'from fibonacci import fib_closed_form, fib_iterative, fib_memo', 'real']],
};

describe('demo PR', () => {
  for (const [name, cases] of Object.entries(CASES)) {
    it(name, () => {
      for (const [path, side, text, expected, reason] of cases) {
        expect(`${path} ${side}${text}: ${verdict(path, side, text)}`).toBe(`${path} ${side}${text}: ${expected}`);
        if (reason) expect(reasonOf(path, side, text)).toBe(reason);
      }
    });
  }

  it('a file that is only reformatted is entirely formatting', () => {
    expect(result('matrix.py').r.whole).toBe(true);
    for (const p of ['fibonacci.py', 'primes.py', 'shapes.py', 'sorting.py', 'epochs.py']) expect(result(p).r.whole).toBe(false);
    // Only comment changes: no formatting lines, but still shown.
    expect(result('epochs.py').r.formatting).toBe(0);
    expect(hasMarks(result('epochs.py').r)).toBe(true);
  });
});

describe('demo PR: moved code', () => {
  // What the background worker does: head from the PR, base rebuilt from the diff.
  const moves = detectMoves(
    files.map((diff) => {
      const head = diff.status === 'deleted' ? null : readFileSync(join(DEMO, 'after', diff.newPath!), 'utf8');
      return {
        diff,
        base: diff.status === 'added' ? null : diff.status === 'deleted' ? sideFromDiff(diff, 'old') : reverseApply(head!, diff),
        head: diff.status === 'added' ? sideFromDiff(diff, 'new') : head,
      };
    }),
  );
  const found = moves.map((m) => `${m.from.path}:${m.from.qualname} → ${m.to.path}:${m.to.qualname} (${m.kind})`).sort();

  it('finds each move', () => {
    expect(found).toEqual([
      'fibonacci.py:fib_memo → fibonacci.py:fib_memo (moved-modified)',
      'primes.py:gcd → numbers_util.py:gcd (moved)',
      'shapes.py:Rectangle → shapes.py:Rectangle (moved-modified)',
      'sorting.py:Stack → structures.py:Stack (moved)',
      'sorting.py:bubble_sort → sorting.py:sort_bubble (moved)',
    ]);
  });
});
