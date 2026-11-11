# Demo PR fixtures

Toy Python code (nothing real) for trying Pretty PR Review on a pull request where every case is known.

- `toys/` is the base version, on `main`.
- `after/` is what the demo PR changes `toys/` into. The PR branch is `main` with `after/*` copied over `toys/`.
- `src/formatting/demo.test.ts` runs the same diff through the formatting and moved-code detectors and checks every case below.

To change the demo, edit `toys/` or `after/`, run `npm test`, then rebuild the PR branch the same way.

## What the PR contains

| File | Change | Expected |
| --- | --- | --- |
| `fibonacci.py` | imports sorted and regrouped | dimmed, "imports reordered" |
| `fibonacci.py` | module docstring reworded | dimmed, "comment changes" |
| `fibonacci.py` | `return round(...)` wrapped, `phi ** n` → `phi**n` | dimmed, formatting |
| `fibonacci.py` | `'…'` → `"…"` in `describe` | dimmed, "formatting: quote style" |
| `fibonacci.py` | `>` → `>=` in `first_over` | real |
| `fibonacci.py` | `fib_memo` moved to the end with `n < 2` → `n <= 1` | moved, modified |
| `primes.py` | `gcd` moved to `numbers_util.py` unchanged | moved |
| `primes.py` | import rewrapped with one new name | only `fib_iterative,` real |
| `primes.py` | one comment line added (`# trial division`) | real (single comment lines aren't dimmed) |
| `primes.py` | two comment lines added in `primes_below` | dimmed, "comment changes" |
| `primes.py` | `try`/`except` removed, condition changed in `check` | `try`/`except`/`if` real; the re-indented body dimmed, "formatting: indentation" |
| `primes.py` | implicit string concatenation joined, call wrapped with trailing commas | dimmed |
| `primes.py` | new function `nth_prime_fib` | real |
| `shapes.py` | class docstring rewrapped | dimmed |
| `shapes.py` | `bounding_box` return wrapped; `largest` signature exploded with a trailing comma | dimmed |
| `shapes.py` | `(name,)` → `(name)`, `"a  "` → `"a "` | real |
| `shapes.py` | `Rectangle` moved to the end, `perimeter` changed | moved, modified |
| `sorting.py` | `bubble_sort` renamed `sort_bubble` and moved to the end | moved (renamed) |
| `sorting.py` | `Stack` moved to `structures.py` unchanged | moved |
| `sorting.py` | trailing whitespace removed; an extra blank line removed | dimmed / invisible |
| `sorting.py` | `print("done")` dedented out of the `if` (nothing else in that hunk) | real |
| `sorting.py` | `sort_report`: call restructured, arguments re-wrapped | real |
| `matrix.py` | only reformatted (quotes, wrapping, trailing commas) | whole file auto-viewed, tagged "format" |
| `test_fibonacci.py` | new test | auto-viewed, tagged "auto" |
