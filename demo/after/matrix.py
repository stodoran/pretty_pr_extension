"""Toy matrix helpers (demo fixture). The PR only reformats this file."""
from typing import List

Matrix = List[List[float]]


def identity(n: int) -> Matrix:
    return [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]


def transpose(m: Matrix) -> Matrix:
    return [list(row) for row in zip(*m)]


def multiply(a: Matrix, b: Matrix) -> Matrix:
    assert len(a[0]) == len(b), "inner dimensions must match: %d vs %d" % (
        len(a[0]),
        len(b),
    )
    return [
        [sum(x * y for x, y in zip(row, col)) for col in transpose(b)]
        for row in a
    ]


def scale(
    m: Matrix, factor: float, round_to: int = 6, keep_integers: bool = False
) -> Matrix:
    result = [[round(x * factor, round_to) for x in row] for row in m]
    if keep_integers:
        result = [
            [int(x) if float(x).is_integer() else x for x in row] for row in result
        ]
    return result


def describe(m: Matrix) -> dict:
    rows, cols = len(m), len(m[0]) if m else 0
    return {"rows": rows, "cols": cols, "square": rows == cols}
