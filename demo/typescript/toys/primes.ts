// Prime helpers (demo fixture).
import { fibIterative, fibSequence } from './fibonacci';

export function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return Math.abs(a);
}

export const lcm = (a: number, b: number): number => {
  if (a === 0 || b === 0) {
    return 0;
  }
  return Math.abs(a * b) / gcd(a, b);
};

export function isPrime(n: number): boolean {
  if (n < 2) {
    return false;
  }
  for (let d = 2; d * d <= n; d++) {
    if (n % d === 0) {
      return false;
    }
  }
  return true;
}

export function primesBelow(limit: number): number[] {
  const sieve = new Array<boolean>(limit).fill(true);
  const out: number[] = [];
  for (let p = 2; p < limit; p++) {
    if (!sieve[p]) continue;
    out.push(p);
    for (let m = p * p; m < limit; m += p) {
      sieve[m] = false;
    }
  }
  return out;
}

export function check(n: number): string {
  try {
    const factors = primeFactors(n);
    const result = factors.length === 1;
    if (result) {
      return 'prime';
    }
    return 'composite';
  } catch (err) {
    return 'error';
  }
}

export function primeFactors(n: number): number[] {
  const factors: number[] = [];
  let rest = n;
  for (let d = 2; d <= rest; d++) {
    while (rest % d === 0) {
      factors.push(d);
      rest /= d;
    }
  }
  return factors;
}

export function logPair(a: number, b: number): void {
  const pair = [a, b];
  (pair[0] > pair[1] ? console.warn : console.log)(pair);
}

export function fibPrimes(count: number): number[] {
  return fibSequence(count).filter(isPrime).concat(fibIterative(count));
}
