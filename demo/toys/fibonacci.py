"""Toy Fibonacci helpers.

Used only as a fixture for Pretty PR Review's demo pull request; none of
this is real code, and it is not maintained.
"""
import math
import sys
from functools import lru_cache
from typing import Iterator, List, Optional


def fib_iterative(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


def fib_sequence(limit: int) -> Iterator[int]:
    a, b = 0, 1
    while a < limit:
        yield a
        a, b = b, a + b


def fib_closed_form(n):
    phi = (1 + math.sqrt(5)) / 2
    psi = (1 - math.sqrt(5)) / 2
    return round(
        (phi**n - psi**n) / math.sqrt(5)
    )


def describe(n, verbose=False):
    value = fib_iterative(n)
    if verbose and n > 0:
        print("fib(%d) = %d" % (n, value), file=sys.stderr)
    return {"n": n, "value": value, "even": value % 2 == 0}


def first_over(threshold: Optional[int] = None) -> List[int]:
    found = []
    for x in fib_sequence(threshold or 1000):
        if x >= (threshold or 100):
            found.append(x)
    return found


@lru_cache(maxsize=None)
def fib_memo(n):
    """Memoized recursive Fibonacci."""
    if n <= 1:
        return n
    return fib_memo(n - 1) + fib_memo(n - 2)
