"""Toy prime-number helpers (demo fixture)."""
from fibonacci import fib_sequence


def gcd(a, b):
    while b:
        a, b = b, a % b
    return a


def is_prime(n):
    if n < 2:
        return False
    for d in range(2, int(n ** 0.5) + 1):
        if n % d == 0:
            return False
    return True


def primes_below(limit):
    sieve = [True] * limit
    sieve[0:2] = [False, False]
    for i in range(2, int(limit ** 0.5) + 1):
        if sieve[i]:
            for j in range(i * i, limit, i):
                sieve[j] = False
    return [i for i, ok in enumerate(sieve) if ok]


def prime_fibs(limit):
    return [x for x in fib_sequence(limit) if is_prime(x)]


def check(n):
    result = is_prime(n)
    if result:
        try:
            factors = [d for d in range(2, n) if n % d == 0]
            assert not factors
            print("checked", n)
        except AssertionError as exc:
            print("inconsistent", exc)
    return result


def report(numbers, label):
    count = len([n for n in numbers if is_prime(n)])
    message = "Found %d primes in %s; " "the largest checked was %d" % (count, label, max(numbers))
    return message
