// Prime helpers (demo fixture).
import {
  fibIterative,
  fibMemo,
  fibSequence,
} from './fibonacci';

export function isPrime(n: number): boolean {
  if (n < 2) {
    return false;
  }
  // trial division
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
    // Sieve of Eratosthenes: every multiple of a prime
    // from its square upwards is composite.
    for (let m = p * p; m < limit; m += p) {
      sieve[m] = false;
    }
  }
  return out;
}

export function check(n: number): string {
  const factors = primeFactors(n);
  const result = factors.length === 1 && n > 1;
  if (result) {
    return 'prime';
  }
  return 'composite';
}

export function primeFactors(n: number): number[] {
  const factors: number[] = []
  let rest = n
  for (let d = 2; d <= rest; d++) {
    while (rest % d === 0) {
      factors.push(d)
      rest /= d
    }
  }
  return factors
}

export function logPair(a: number, b: number): void {
  const pair = [a, b]
  (pair[0] > pair[1] ? console.warn : console.log)(pair);
}

export function fibPrimes(count: number): number[] {
  return fibSequence(count).filter(isPrime).concat(fibIterative(count));
}

export function nthPrimeFib(n: number): number {
  let found = 0;
  for (let i = 0; ; i++) {
    const value = fibMemo(i);
    if (isPrime(value) && ++found === n) {
      return value;
    }
  }
}
