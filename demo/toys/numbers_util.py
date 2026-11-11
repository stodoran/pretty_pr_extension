"""Toy number helpers (demo fixture): `gcd` moved here unchanged."""


def gcd(a, b):
    while b:
        a, b = b, a % b
    return a
