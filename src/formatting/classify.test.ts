import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../moves/unified-diff';
import { classifyFile, describeFormatting, type FileFormatting } from './classify';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Classifies a real `git diff` of one file from `before` to `after`. */
function classify(path: string, before: string, after: string): FileFormatting {
  const dir = mkdtempSync(join(tmpdir(), 'prh-fmt-'));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(dir, path), before);
  git('add', '-A');
  git('commit', '-qm', 'base');
  writeFileSync(join(dir, path), after);
  git('add', '-A');
  const [file] = parseUnifiedDiff(git('diff', '--cached', '--no-color'));
  const res = file && classifyFile(file);
  if (!res) throw new Error('not classified');
  return res;
}

describe('formatting-only changes', () => {
  it('whitespace, wrapping, quotes and a magic trailing comma (Python)', () => {
    const r = classify(
      'a.py',
      `def f(a, b):\n    return g(a,b, 'x')\n\n\nx = {'k': 1}\n`,
      `def f(a, b):\n    return g(\n        a,\n        b,\n        "x",\n    )\n\n\nx = {"k": 1}\n`,
    );
    expect(r.whole).toBe(true);
    expect(r.blocks.map((b) => b.reason)).toEqual(['formatting: line wrapping, quote style, trailing commas', 'formatting: quote style']);
  });

  it('blank lines and trailing whitespace', () => {
    const r = classify('a.py', `a = 1   \nb = 2\n\n\n\nc = 3\n`, `a = 1\nb = 2\n\n\nc = 3\n`);
    expect(r.whole).toBe(true);
    // Only the visible line is marked; the removed blank line isn't.
    expect(r.left).toEqual([1]);
    expect(r.blocks.map((b) => b.reason)).toEqual(['formatting: trailing whitespace']);
  });

  it('a real edit makes its whole statement real', () => {
    const r = classify(
      'a.py',
      `result = compute(alpha, beta, gamma)\n`,
      `result = compute(\n    alpha,\n    beta,\n    delta,\n)\n`,
    );
    expect(r.formatting).toBe(0);
  });

  it('re-wrapped arguments of a changed call are real (reported case)', () => {
    const r = classify(
      'a.py',
      `def f(self):\n    m = score(\n        collect(\n            fwd,\n            self.timeout,\n            wait,\n        ),\n        self.opt,\n        self.fn,\n    )\n    return m\n`,
      `def f(self):\n    c, x = collect(\n        fwd,\n        self.timeout,\n        wait,\n    )\n    m = score(c, x, self.fn)\n    return m\n`,
    );
    expect(r.formatting).toBe(0);
  });

  it('code that moved past unchanged lines is not formatting', () => {
    const fn = `def helper(x):\n    y = x + 1\n    return y * 2\n`;
    const r = classify('a.py', `${fn}\n\nA = 1\nB = 2\nC = 3\n`, `A = 1\nB = 2\nC = 3\n\n\n${fn}`);
    expect(r.right).toEqual([]);
    expect(r.left).toEqual([]);
  });

  it('separate sections get separate groups; a single comment line is left alone', () => {
    const r = classify(
      'a.py',
      `# a1\n# a2\nx = 1\ny = 2\n# b\nz = 3\n`,
      `# A1\n# A2\nx = 10\ny = 2\n# B\nz = 3\n`,
    );
    expect(r.blocks.map((b) => [b.left, b.right, b.reason])).toEqual([[[1, 2], [1, 2], 'comment changes']]);
  });

  it('docstrings count as comments', () => {
    const r = classify('a.py', `def f():\n    """Old text.\n\n    More.\n    """\n`, `def f():\n    """New text.\n\n    More!\n    """\n`);
    expect(r.blocks.map((b) => b.reason)).toEqual(['comment changes']);
  });

  it('comment-only changes', () => {
    const r = classify('a.py', `x = 1  # old\n# note\ny = 2\n`, `x = 1  # new\ny = 2\n`);
    expect(r.left).toEqual([1, 2]);
    expect(r.right).toEqual([1]);
    expect(r.blocks.map((b) => b.reason)).toEqual(['comment changes']);
    expect(r.whole).toBe(false); // comments aren't formatting: the file isn't auto-viewed
    expect(classify('a.py', `f(a)  # old\n`, `g(a)  # new\n`).left).toEqual([]);
  });

  it('indentation is meaningful in Python', () => {
    const r = classify('a.py', `if a:\n    b()\n    c()\n`, `if a:\n    b()\nc()\n`);
    expect(r.whole).toBe(false);
    expect(r.formatting).toBe(0);
  });

  it('a line that lost tokens from its middle is a real change', () => {
    const r = classify('a.py', `if opt.enabled and fn is not None:\n    run()\n`, `if fn is not None:\n    run()\n`);
    expect(r.formatting).toBe(0);
  });

  it('re-indented lines next to the change that caused them', () => {
    const r = classify(
      'a.py',
      `def f():\n    try:\n        a = g()\n        h(a)\n    except E:\n        pass\n    return 1\n`,
      `def f():\n    a = g()\n    h(a)\n    return 1\n`,
    );
    expect(r.right).toEqual([2, 3]);
    // Old and new versions are one group (they matched), though removed lines sit between them.
    expect(r.blocks.map((b) => b.reason)).toEqual(['formatting: indentation']);
    expect(r.whole).toBe(false);
  });

  it('a removed try/except with a changed condition (reported case)', () => {
    const before = `def f(eval_opt, eval_f1_fn):
    if eval_opt.f1_enabled and eval_f1_fn is not None:
        try:
            m = eval_f1_fn(eval_opt.n)
            metrics.update(m)
            log.info(
                "  f1=%.4f",
                m[F1],
            )
        except Exception as exc:
            log.warning("failed: %s", exc)
    return metrics
`;
    const after = `def f(completions, eval_f1_fn):
    if eval_f1_fn is not None:
        m = eval_f1_fn(completions)
        metrics.update(m)
        log.info(
            "  f1=%.4f",
            m[F1],
        )
    return metrics
`;
    const r = classify('a.py', before, after);
    expect(r.right).toEqual([4, 5, 6, 7, 8]); // not the changed \`if\` (2) or call (3)
    expect(r.left).toEqual([5, 6, 7, 8, 9]);
  });

  it('whitespace inside strings is meaningful', () => {
    expect(classify('a.py', `s = "a  b"\n`, `s = "a b"\n`).formatting).toBe(0);
    expect(classify('a.py', `s = """\na  b\n"""\n`, `s = """\na b\n"""\n`).formatting).toBe(0);
  });

  it('more cases from real formatter PRs', () => {
    // Hunk starting inside a dict: trailing comma before the closing brace.
    const head = `X = {\n    "a": 1,\n    "b": 2,\n    "c": 3,\n    "d": 4,\n`;
    expect(classify('a.py', `${head}    "e": 5\n}\n`, `${head}    "e": 5,\n}\n`).whole).toBe(true);
    // Only the final newline changed.
    expect(classify('a.py', `def f():\n    return 1`, `def f():\n    return 1\n`).whole).toBe(true);
    // f-string joined with a plain string.
    expect(classify('a.py', `raise E(\n    f"bad {x} "\n    "value"\n)\n`, `raise E(f"bad {x} value")\n`).whole).toBe(true);
    expect(classify('a.py', `s = (f"{x} " "{y}")\n`, `s = f"{x} {y}"\n`).whole).toBe(false);
    // A hunk ending just after a docstring opens.
    const doc = `    """Docstring.\n\n    More.\n    """\n    return 1\n`;
    expect(classify('a.py', `def f(a, b,\n      c):\n${doc}`, `def f(a, b, c):\n${doc}`).whole).toBe(true);
  });

  it('a hunk that starts inside a docstring', () => {
    const doc = `"""Module docstring.\n\nMore text.\nEven more.\n`;
    const r = classify('a.py', `${doc}"""\nimport os\n\nx = f(a,b)\n`, `${doc}"""\n\nimport os\n\nx = f(a, b)\n`);
    expect(r.formatting).toBe(r.changed);
    expect(r.whole).toBe(false); // read with the docstring guess: dimmed, but never auto-viewed
    // A docstring is compared like a comment: its text matters, its spacing doesn't.
    const short = `"""Doc.\n`;
    expect(classify('a.py', `${short}  text\n"""\n`, `${short} text\n"""\n`).whole).toBe(true);
    expect(classify('a.py', `${short}text\n"""\n`, `${short}test\n"""\n`).whole).toBe(false);
    // Ambiguous (the hunk starts mid-docstring, the string reopens after the change): stays real.
    expect(classify('a.py', `${doc}  text\n"""\n`, `${doc} text\n"""\n`).formatting).toBe(0);
  });

  it('auto-view guards (security review)', () => {
    // Python: `from (` / `raise (` aren't calls.
    expect(classify('a.py', `raise (a,)\n`, `raise (a)\n`).whole).toBe(false);
  });

  it('renames and mode changes are never auto-viewed', () => {
    const rename = parseUnifiedDiff(
      'diff --git a/a.py b/b.py\nsimilarity index 90%\nrename from a.py\nrename to b.py\n--- a/a.py\n+++ b/b.py\n@@ -1 +1 @@\n-x=1\n+x = 1\n',
    )[0]!;
    expect(classifyFile(rename)!.whole).toBe(false);
    const mode = parseUnifiedDiff('diff --git a/a.py b/a.py\nold mode 100644\nnew mode 100755\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-x=1\n+x = 1\n')[0]!;
    expect(classifyFile(mode)!.whole).toBe(false);
  });

  it('tuple trailing commas are meaningful', () => {
    expect(classify('a.py', `x = (a,)\n`, `x = (a)\n`).whole).toBe(false);
    expect(classify('a.py', `x = d[a,]\n`, `x = d[a]\n`).whole).toBe(false);
    expect(classify('a.py', `f(a,)\n`, `f(a)\n`).whole).toBe(true); // a call: same thing
  });

  it('operators are not merged across whitespace', () => {
    expect(classify('a.py', `x = a * *b\n`, `x = a**b\n`).whole).toBe(false);
  });

  it('comments: spacing is formatting, text is not', () => {
    expect(classify('a.py', `x = 1  #note\n`, `x = 1  # note\n`).whole).toBe(true);
    expect(classify('a.py', `x = 1  # note\n`, `x = 1  # notes\n`).whole).toBe(false);
  });

  it('Python: wrapping parentheses, joined strings, f-string quotes', () => {
    expect(classify('a.py', `assert f(a) == 1\n`, `assert (\n    f(a) == 1\n)\n`).whole).toBe(true);
    expect(classify('a.py', `x = a + b\n`, `x = (\n    a + b\n)\n`).whole).toBe(true);
    expect(classify('a.py', `f('one '\n  "two")\n`, `f("one two")\n`).whole).toBe(true);
    expect(classify('a.py', `s = f"{d['k']}"\n`, `s = f'{d["k"]}'\n`).whole).toBe(true);
    expect(classify('a.py', `pick = lambda k: d.get(k) or k\n`, `pick = lambda k: (\n    d.get(k) or k\n)\n`).whole).toBe(true);
    expect(classify('a.py', `a, b = x, y\n`, `a, b = (\n    x,\n    y,\n)\n`).whole).toBe(true);
    expect(classify('a.py', `assert ok, f"bad {x}"\n`, `assert ok, (\n    f"bad {x}"\n)\n`).whole).toBe(true);
    // Not wrapping: precedence, tuples, generators, and quotes outside fields.
    expect(classify('a.py', `x = (a + b) * c\n`, `x = a + b * c\n`).whole).toBe(false);
    expect(classify('a.py', `x = (a, b)\n`, `x = a\n`).whole).toBe(false);
    expect(classify('a.py', `f((a, b))\n`, `f(a, b)\n`).whole).toBe(false);
    expect(classify('a.py', `x = (a, b)[0]\n`, `x = a, b[0]\n`).whole).toBe(false);
    expect(classify('a.py', `s = f"'{a}"\n`, `s = f'"{a}'\n`).whole).toBe(false);
    expect(classify('a.py', `f('one', 'two')\n`, `f('onetwo')\n`).whole).toBe(false);
  });

  it('only Python files', () => {
    for (const path of ['a.ts', 'a.go', 'a.yml']) expect(() => classify(path, `x = 1  \n`, `x = 1\n`)).toThrow('not classified');
  });

  it('never for markdown', () => {
    const [file] = parseUnifiedDiff(
      'diff --git a/a.md b/a.md\n--- a/a.md\n+++ b/a.md\n@@ -1 +1 @@\n-a  \n+a\n',
    );
    expect(classifyFile(file!)).toBeNull();
  });
});

describe('describeFormatting', () => {
  it('names what changed', () => {
    expect(describeFormatting(['a = 1  '], ['a = 1'])).toBe('trailing whitespace');
    expect(describeFormatting(['  a = 1'], ['    a = 1'])).toBe('indentation');
    expect(describeFormatting(['a=1'], ['a = 1'])).toBe('spacing');
    expect(describeFormatting(['f(a, b)'], ['f(', '  a,', '  b,', ')'])).toBe('line wrapping, trailing commas');
    expect(describeFormatting(["x = 'a'"], ['x = "a"'])).toBe('quote style');
    expect(describeFormatting(["f('a '", "  'b')"], ["f('a b')"])).toBe('line wrapping, joined strings');
    expect(describeFormatting(['x = a + b'], ['x = (', '    a + b', ')'])).toBe('line wrapping, parentheses');
  });
});

describe('import reordering', () => {
  it('sorted and regrouped Python imports', () => {
    const r = classify(
      'a.py',
      `import sys\nimport os\nfrom x import b\nfrom x import a\n\nprint(1)\n`,
      `import os\nimport sys\nfrom x import (\n    a,\n    b,\n)\n\nprint(1)\n`,
    );
    expect(r.whole).toBe(true);
    expect(r.blocks.some((b) => b.reason === 'imports reordered')).toBe(true);
  });

  it('a rewrapped import with a new name: only the new name is real (reported case)', () => {
    const r = classify(
      'a.py',
      `from pkg.constants import SCHEMA, TRAIN, EVAL\n`,
      `from pkg.constants import (\n    SCHEMA,\n    TRAIN,\n    VALIDATE,\n    EVAL,\n)\n`,
    );
    expect(r.right).toEqual([1, 2, 3, 5, 6]);
  });

  it('a changed import set is a real change', () => {
    const r = classify('a.py', `import sys\nimport os\n`, `import os\nimport json\n`);
    expect(r.whole).toBe(false);
  });

  it('moving an import into a function is a real change', () => {
    const r = classify(
      'a.py',
      `import os\n\n\ndef f():\n    return os.getcwd()\n`,
      `def f():\n    import os\n    return os.getcwd()\n`,
    );
    expect(r.whole).toBe(false);
  });

});
