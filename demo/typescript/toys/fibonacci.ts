/**
 * Fibonacci helpers (demo fixture).
 * Toy code for the Pretty PR Review demo; nothing here is real.
 */
import { formatNumber } from './format';
import { cache, Cache } from './cache';
import type { Sequence } from './types';

const PHI = (1 + Math.sqrt(5)) / 2;
const PSI = (1 - Math.sqrt(5)) / 2;

export function fibIterative(n: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    [a, b] = [b, a + b];
  }
  return a;
}

export function fibMemo(n: number, memo: Cache = cache): number {
  if (n < 2) {
    return n;
  }
  const hit = memo.get(n);
  if (hit !== undefined) {
    return hit;
  }
  const value = fibMemo(n - 1, memo) + fibMemo(n - 2, memo);
  memo.set(n, value);
  return value;
}

export function fibClosedForm(n: number): number {
  return Math.round((PHI ** n - PSI ** n) / Math.sqrt(5));
}

export function fibSequence(count: number): Sequence {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(fibIterative(i));
  }
  return out;
}

export function describe(n: number): string {
  const value = fibIterative(n);
  return 'fib(' + n + ') = ' + formatNumber(value);
}

export function firstOver(threshold: number): number {
  let i = 0;
  while (!(fibIterative(i) > threshold)) {
    i++;
  }
  return i;
}
