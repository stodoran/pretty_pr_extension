import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectMoves, type FileVersions } from './detect';
import { extractFunctions } from './python/functions';
import { normalizeFunction } from './python/normalize';
import { tokenize } from './python/tokenize';
import { parseUnifiedDiff, reverseApply, sideFromDiff } from './unified-diff';

// ---- helpers: build a real `git diff` between two trees --------------------

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

type Tree = Record<string, string>;

function gitDiff(base: Tree, head: Tree): string {
  const dir = mkdtempSync(join(tmpdir(), 'prh-moves-'));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
  const write = (tree: Tree) =>
    Object.entries(tree).forEach(([p, c]) => {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    });
  git('init', '-q');
  write(base);
  git('add', '-A');
  git('commit', '-qm', 'base', '--allow-empty');
  Object.keys(base).forEach((p) => rmSync(join(dir, p)));
  write(head);
  git('add', '-A');
  return git('diff', '--cached', '-M', '--no-color');
}

/** What the background worker does: head from "raw", base reconstructed from the diff. */
function versions(base: Tree, head: Tree): FileVersions[] {
  return parseUnifiedDiff(gitDiff(base, head)).map((diff) => ({
    diff,
    base: diff.status === 'added' ? null : diff.status === 'deleted' ? sideFromDiff(diff, 'old') : reverseApply(head[diff.newPath!]!, diff),
    head: diff.status === 'deleted' ? null : head[diff.newPath!]!,
  }));
}

const fn = (src: string, name: string) => {
  const f = extractFunctions(tokenize(src)).find((x) => x.name === name);
  if (!f) throw new Error(`no function ${name}`);
  return f;
};

// ---- fixtures --------------------------------------------------------------

const PARSE = `def parse_records(path, limit=None):
    """Parse records from a CSV file."""
    rows = []
    with open(path) as fh:
        for i, line in enumerate(fh):
            if limit is not None and i >= limit:
                break
            fields = line.rstrip("\\n").split(",")
            rows.append({"id": int(fields[0]), "name": fields[1].strip()})
    return rows
`;

const SUMMARIZE = `def summarize(rows):
    total = 0
    names = set()
    for row in rows:
        total += row["id"]
        names.add(row["name"])
    return {"total": total, "unique": len(names)}
`;

const UNRELATED = `def send_email(to, subject, body):
    client = SmtpClient(host="localhost", port=25)
    message = build_message(to=to, subject=subject, body=body)
    client.connect()
    client.send(message)
    client.close()
    return message.id
`;

// ---- tokenizer / extraction / normalization --------------------------------

describe('tokenizer', () => {
  it('emits INDENT/DEDENT and ignores newlines inside brackets and strings', () => {
    const toks = tokenize('def f(a,\n      b):\n    s = """x\ny"""\n    return a\n');
    const types = toks.map((t) => t.type).join(' ');
    expect(types).toBe('NAME NAME OP NAME OP NAME OP OP NEWLINE INDENT NAME OP STRING NEWLINE NAME NAME NEWLINE DEDENT');
    expect(toks.find((t) => t.type === 'STRING')).toMatchObject({ line: 3, endLine: 4 });
  });
});

describe('extractFunctions', () => {
  const src = `import x

class Repo:
    @property
    @cached
    def items(self):
        def helper(v):
            return v * 2
        return [helper(i) for i in self._items]

    async def fetch(self, *args, key: str = "a", **kw): return await go(*args)

TEMPLATE = """
def not_a_function():
    pass
"""

def top(a, /, b, *, c):
    pass
`;
  const fns = extractFunctions(tokenize(src));

  it('finds methods, nested, async and top-level functions with decorators', () => {
    expect(fns.map((f) => [f.qualname, f.startLine, f.endLine])).toEqual([
      ['Repo.items', 4, 9],
      ['Repo.items.helper', 7, 8],
      ['Repo.fetch', 11, 11],
      ['top', 18, 19],
    ]);
  });

  it('parses parameter names, skipping annotations and defaults', () => {
    expect(fns.find((f) => f.name === 'fetch')!.params).toEqual(['self', 'args', 'key', 'kw']);
    expect(fns.find((f) => f.name === 'top')!.params).toEqual(['a', 'b', 'c']);
  });
});

describe('normalizeFunction', () => {
  it('is insensitive to local renames, comments, docstrings, quotes and trailing commas', () => {
    const a = fn(PARSE, 'parse_records');
    const b = fn(
      `def load_rows(filename, max_rows=None):
    # moved from utils
    out = []
    with open(filename) as f:
        for n, raw in enumerate(f):
            if max_rows is not None and n >= max_rows:
                break
            parts = raw.rstrip('\\n').split(',')
            out.append({'id': int(parts[0]), 'name': parts[1].strip(),})
    return out
`,
      'load_rows',
    );
    expect(normalizeFunction(a)).toEqual(normalizeFunction(b));
  });

  it('keeps attribute names and called globals', () => {
    const a = normalizeFunction(fn('def f(x):\n    return json.dumps(x.value)\n', 'f'));
    const b = normalizeFunction(fn('def f(x):\n    return json.loads(x.value)\n', 'f'));
    expect(a).not.toEqual(b);
  });
});

describe('unified diff', () => {
  it('reverse-applies the diff to reconstruct the base file exactly', () => {
    const base = { 'a.py': `${PARSE}\n\n${SUMMARIZE}` };
    const head = { 'a.py': `import os\n\n${SUMMARIZE.replace('total = 0', 'total = 1')}\n\n${UNRELATED}` };
    const [file] = parseUnifiedDiff(gitDiff(base, head));
    expect(reverseApply(head['a.py'], file!)).toBe(base['a.py']);
  });
});

// ---- detection -------------------------------------------------------------

describe('detectMoves', () => {
  it('detects an unchanged move to another file', () => {
    const moves = detectMoves(
      versions(
        { 'pkg/utils.py': `import csv\n\n\n${PARSE}\n\n${SUMMARIZE}` },
        { 'pkg/utils.py': `import csv\n\n\n${SUMMARIZE}`, 'pkg/io/records.py': `import csv\n\n\n${PARSE}` },
      ),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      kind: 'moved',
      renamed: false,
      similarity: 1,
      from: { path: 'pkg/utils.py', qualname: 'parse_records', startLine: 4 },
      to: { path: 'pkg/io/records.py', qualname: 'parse_records', startLine: 4 },
    });
  });

  it('detects a move with renamed function, params and locals as an unchanged move', () => {
    const renamed = PARSE.replaceAll('rows', 'out').replaceAll('fh', 'f').replace('parse_records', 'load_rows');
    const moves = detectMoves(versions({ 'a.py': `${PARSE}\n\n${SUMMARIZE}` }, { 'a.py': SUMMARIZE, 'b.py': renamed }));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: 'moved', renamed: true, to: { qualname: 'load_rows' } });
  });

  it('detects a moved and modified function, with similarity below 1', () => {
    const modified = PARSE.replace('            if limit is not None and i >= limit:\n                break\n', '')
      .replace('rows.append(', 'if fields[1]:\n                rows.append(')
      .replace('    return rows', '    log.debug("parsed %d rows", len(rows))\n    return rows');
    const moves = detectMoves(versions({ 'a.py': `${PARSE}\n\n${SUMMARIZE}` }, { 'a.py': SUMMARIZE, 'b.py': modified }));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.kind).toBe('moved-modified');
    expect(moves[0]!.similarity).toBeGreaterThan(0.65);
    expect(moves[0]!.similarity).toBeLessThan(1);
  });

  it('detects a method extracted into a module-level function', () => {
    const method = `class Loader:\n    def __init__(self, path):\n        self.path = path\n\n${PARSE.replace('def parse_records(path, limit=None):', 'def parse_records(self, limit=None):').replaceAll('open(path)', 'open(self.path)').replace(/^/gm, '    ')}`;
    const moves = detectMoves(versions({ 'loader.py': method }, { 'loader.py': 'class Loader:\n    def __init__(self, path):\n        self.path = path\n', 'parsing.py': PARSE }));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: 'moved-modified', from: { qualname: 'Loader.parse_records' }, to: { qualname: 'parse_records' } });
  });

  it('detects a move within the same file', () => {
    const moves = detectMoves(
      versions({ 'a.py': `${PARSE}\n\n${SUMMARIZE}\n\n${UNRELATED}` }, { 'a.py': `${SUMMARIZE}\n\n${UNRELATED}\n\n${PARSE}` }),
    );
    expect(moves.map((m) => [m.from.qualname, m.from.startLine, m.to.startLine])).toEqual([['parse_records', 1, 19]]);
  });

  it('does not report a function rewritten in place', () => {
    const rewritten = PARSE.replace('rows = []', 'rows: list = []').replace('break', 'return rows');
    expect(detectMoves(versions({ 'a.py': `${PARSE}\n\n${SUMMARIZE}` }, { 'a.py': `${rewritten}\n\n${SUMMARIZE}` }))).toEqual([]);
  });

  it('detects a moved class as one move, hiding its methods', () => {
    const cls = `class RecordStore:
    """Holds records."""

    kind = "csv"

    def __init__(self, path):
        self.path = path
        self.rows = []

${PARSE.replace(/^/gm, '    ').replace('def parse_records(path', 'def parse_records(self, path')}
${SUMMARIZE.replace(/^/gm, '    ').replace('def summarize(rows', 'def summarize(self, rows')}`;
    const renamedLocals = cls.replaceAll('names', 'seen').replaceAll('fh', 'f');
    const moves = detectMoves(versions({ 'a.py': `import csv\n\n\n${cls}`, 'keep.py': UNRELATED }, { 'a.py': 'import csv\n', 'b.py': renamedLocals, 'keep.py': UNRELATED }));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: 'moved', defKind: 'class', from: { qualname: 'RecordStore', path: 'a.py' }, to: { qualname: 'RecordStore', path: 'b.py' } });
  });

  it('detects a small enum moved to another file', () => {
    const en = `class Color(Enum):\n    RED = "red"\n    GREEN = "green"\n    BLUE = "blue"\n`;
    const moves = detectMoves(versions({ 'a.py': `${en}\n\n${UNRELATED}` }, { 'a.py': UNRELATED, 'colors.py': en }));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: 'moved', defKind: 'class', to: { path: 'colors.py', qualname: 'Color' } });
  });

  it('does not treat class attribute renames as unchanged', () => {
    const a = `class Limits:\n    MAX_ROWS = 100\n    MAX_COLS = 20\n    TIMEOUT = 30\n    RETRIES = 3\n`;
    const b = a.replace('MAX_ROWS', 'ROW_LIMIT');
    const moves = detectMoves(versions({ 'a.py': `${a}\n\n${UNRELATED}` }, { 'a.py': UNRELATED, 'b.py': b }));
    expect(moves[0]?.kind).toBe('moved-modified');
  });

  it('does not pair unrelated functions', () => {
    expect(detectMoves(versions({ 'a.py': `${PARSE}\n\n${SUMMARIZE}` }, { 'a.py': SUMMARIZE, 'b.py': UNRELATED }))).toEqual([]);
  });

  it('works across a renamed file', () => {
    const moves = detectMoves(
      versions({ 'old_name.py': `${PARSE}\n\n${SUMMARIZE}\n\n${UNRELATED}` }, { 'new_name.py': `${SUMMARIZE}\n\n${UNRELATED}`, 'other.py': PARSE }),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]!.from).toMatchObject({ path: 'old_name.py', displayPath: 'new_name.py' });
  });
});
