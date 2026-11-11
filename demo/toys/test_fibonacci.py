from fibonacci import fib_iterative, fib_memo


def test_small_values():
    assert [fib_iterative(n) for n in range(8)] == [0, 1, 1, 2, 3, 5, 8, 13]


def test_memo_matches_iterative():
    for n in range(20):
        assert fib_memo(n) == fib_iterative(n)
