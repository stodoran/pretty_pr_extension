# Demo PR fixtures

Toy code (nothing real) for trying Pretty PR Review on a pull request where every case is known: one demo in Python ([PR #1](https://github.com/stodoran/pretty_pr_extension/pull/1)) and one in TypeScript ([PR #2](https://github.com/stodoran/pretty_pr_extension/pull/2), see [below](#typescript)).

## Python

- `toys/` is the base version, on `main`.
- `after/` is what the demo PR changes `toys/` into. The PR branch is `main` with `after/*` copied over `toys/`.
- `src/formatting/demo.test.ts` runs the same diff through the formatting and moved-code detectors and checks every case below.

To change the demo, edit `toys/` or `after/`, run `npm test`, then rebuild the PR branch the same way.

### What the PR contains

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
| `epochs.py` | its only change: a one-line docstring rewritten over two lines | dimmed, "comment changes"; whole file auto-viewed, tagged "comments" |
| `test_fibonacci.py` | new test | auto-viewed, tagged "auto" |

## TypeScript

- `typescript/toys/` is the base version, on `main`.
- `typescript/after/` is what the demo PR changes it into. The PR branch (`demo/typescript-cases`) is `main` with `typescript/after/*` copied over `typescript/toys/`.
- `src/formatting/demo-typescript.test.ts` checks every case below, using `languages/typescript.jsonc`.

| File | Change | Expected |
| --- | --- | --- |
| `fibonacci.ts` | imports sorted, `'…'` → `"…"` in the module paths | dimmed, "imports reordered" |
| `fibonacci.ts` | `/** … */` module comment reworded | dimmed, "comment changes" |
| `fibonacci.ts` | `return Math.round(...)` wrapped with a trailing comma, `PHI ** n` → `PHI**n` | dimmed, "formatting: line wrapping, trailing commas" |
| `fibonacci.ts` | `'…'` → `"…"` in `describe` | dimmed, "formatting: quote style" |
| `fibonacci.ts` | `>` → `>=` in `firstOver` | real |
| `fibonacci.ts` | `fibMemo` moved to the end with `n < 2` → `n <= 1` | moved, modified |
| `primes.ts` | `gcd` (function) and `lcm` (arrow function) moved to `numbersUtil.ts` unchanged | moved |
| `primes.ts` | import rewrapped with one new name | only `fibMemo,` real |
| `primes.ts` | one comment line added (`// trial division`) | real (single comment lines aren't dimmed) |
| `primes.ts` | two comment lines added in `primesBelow` | dimmed, "comment changes" |
| `primes.ts` | `try`/`catch` removed, condition changed in `check` | `try`/`catch`/`result` real; the re-indented body dimmed, "formatting: indentation" |
| `primes.ts` | semicolons removed in `primeFactors` | dimmed, "formatting: semicolons" |
| `primes.ts` | semicolon removed before a line starting with `(` in `logPair` (joins the statements) | real |
| `primes.ts` | new function `nthPrimeFib` | real |
| `shapes.ts` | object literal exploded with trailing commas; `largest` signature exploded, method chain wrapped | dimmed |
| `shapes.ts` | `return x` → `return` + line break + `x` (returns `undefined`) | real |
| `shapes.ts` | `'a ' + name` → template literal; whitespace inside a regex | real |
| `shapes.ts` | `Rectangle` moved to `rectangle.ts`, `perimeter` changed | moved, modified |
| `sorting.ts` | `bubbleSort` renamed `sortBubble` and moved to the end | moved (renamed) |
| `sorting.ts` | `Stack` class moved to `structures.ts` unchanged | moved |
| `sorting.ts` | trailing whitespace removed | dimmed |
| `sorting.ts` | `sortReport`: call arguments reordered and re-wrapped | real |
| `matrix.ts` | only reformatted (semicolons, quotes, wrapping, trailing commas) | whole file auto-viewed, tagged "format" |
| `fibonacci.test.ts` | new test | auto-viewed, tagged "auto" |
| `settings.json` | indented JSON, a few values changed and an array item added | GitHub's own diff (it reads fine) |
| `fields.json` | minified JSON (one line): a description reworded, a coordinate changed, a field group added | GitHub's diff replaced by the formatted one, each change headed by its location (`field_groups[1] “Account Holder” › fields[0] “Client Name” › description`) |
