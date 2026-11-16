"""Toy prime-number helpers (demo fixture)."""
from fibonacci import (
    fib_iterative,
    fib_sequence,
)


def is_prime(n):
    if n < 2:
        return False
    # trial division
    for d in range(2, int(n ** 0.5) + 1):
        if n % d == 0:
            return False
    return True


def primes_below(limit):
    sieve = [True] * limit
    sieve[0:2] = [False, False]
    # Classic sieve of Eratosthenes: every multiple of a prime
    # is crossed out, starting from the prime's square.
    for i in range(2, int(limit ** 0.5) + 1):
        if sieve[i]:
            for j in range(i * i, limit, i):
                sieve[j] = False
    return [i for i, ok in enumerate(sieve) if ok]


def prime_fibs(limit):
    return [x for x in fib_sequence(limit) if is_prime(x)]


def check(n):
    result = is_prime(n)
    if result and n > 2:
        factors = [d for d in range(2, n) if n % d == 0]
        assert not factors
        print("checked", n)
    return result


def report(numbers, label):
    count = len([n for n in numbers if is_prime(n)])
    message = "Found %d primes in %s; the largest checked was %d" % (
        count,
        label,
        max(numbers),
    )
    return message


def nth_prime_fib(n):
    return prime_fibs(fib_iterative(n * 4))[n]
