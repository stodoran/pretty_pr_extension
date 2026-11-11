import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { definitionTerms, enclosingDefinitions, type DiffRow } from '../features/definition-search/terms';
import { classifyFile } from '../formatting/classify';
import { detectMoves } from '../moves/detect';
import { parseUnifiedDiff } from '../moves/unified-diff';
import { extractDefinitions } from './definitions';
import { diffOf, runExamples, singleRegistry } from './examples';
import { highlight } from './highlight';
import { normalizeDefinition } from './normalize';
import { buildRegistry, builtinRegistry, loadLanguage } from './registry';
import { parseJsonc, parseLanguageFile } from './spec';
import { tokenize } from './tokenize';

const LANGUAGES = resolve(__dirname, '../../languages');
const source = (name: string) => readFileSync(resolve(LANGUAGES, name), 'utf8');
const ts = loadLanguage(source('typescript.jsonc'));
const tsRegistry = singleRegistry(ts);

describe('language files', () => {
  it.each(['python.jsonc', 'typescript.jsonc'])('%s loads and passes its examples', (name) => {
    expect(runExamples(loadLanguage(source(name)))).toEqual([]);
  });

  it('JSONC: comments and trailing commas', () => {
    expect(parseJsonc('{\n  // c\n  "a": [1, 2,], /* x */ "b": "//not a comment",\n}')).toEqual({ a: [1, 2], b: '//not a comment' });
  });

  it('reports every problem, by path', () => {
    const bad = `{ "id": "Bad Id", "name": "x", "extensions": ["py"], "blocks": "tabs", "strngs": {}, "definitions": [{ "kind": "function" }] }`;
    expect(() => parseLanguageFile(bad)).toThrow(/blocks: expected one of "indentation", "braces"/);
    expect(() => parseLanguageFile(bad)).toThrow(/strngs: unknown key/);
    expect(() => parseLanguageFile(bad)).toThrow(/definitions\[0\]\.pattern: missing/);
    const minimal = `{ "id": "x", "name": "X", "extensions": [".x"], "blocks": "braces", "definitions": [{ "kind": "function", "pattern": "fn $nam" }] }`;
    expect(() => loadLanguage(minimal)).toThrow(/unknown placeholder \$nam/);
  });

  it('an uploaded file replaces the built-in one with its id, and can be switched off', () => {
    const custom = source('python.jsonc').replace('"name": "Python"', '"name": "My Python"');
    expect(buildRegistry({ custom: [{ id: 'python', source: custom }], disabled: [] }).forPath('a.py')!.name).toBe('My Python');
    expect(buildRegistry({ custom: [], disabled: ['python'] }).forPath('a.py')).toBeNull();
    expect(builtinRegistry.forPath('a.ts')).toBeNull(); // TypeScript isn't built in
  });
});

const classify = (path: string, before: string, after: string) => {
  const [file] = parseUnifiedDiff(diffOf(path, before, after));
  return classifyFile(file!, tsRegistry)!;
};

describe('TypeScript: formatting', () => {
  it('semicolons, quotes, trailing commas, wrapping', () => {
    const r = classify('a.ts', `const x = {a: 1, b: 'two'};\nfoo(x, y);\n`, `const x = {\n  a: 1,\n  b: "two",\n}\nfoo(\n  x,\n  y,\n)\n`);
    expect(r.whole).toBe(true);
  });
  it('ASI: line breaks after return, semicolons before ( and [', () => {
    expect(classify('a.js', `function f() {\n  return x\n}\n`, `function f() {\n  return\n  x\n}\n`).formatting).toBe(0);
    expect(classify('a.js', `const a = b;\n(c || d).run()\n`, `const a = b\n(c || d).run()\n`).whole).toBe(false);
    expect(classify('a.js', `const a = b;\nrun()\n`, `const a = b\nrun()\n`).whole).toBe(true);
  });
  it('regex literals are opaque; division is not', () => {
    expect(classify('a.js', `const r = /a b/\n`, `const r = /a  b/\n`).whole).toBe(false);
    expect(classify('a.js', `x = a / b / c\n`, `x = a/b/c\n`).whole).toBe(true);
  });
  it('operators are not merged across whitespace; template literals keep their quotes', () => {
    expect(classify('a.js', `x = a - -b\n`, `x = a--b\n`).whole).toBe(false);
    expect(classify('a.ts', 'x = `a`\n', `x = 'a'\n`).whole).toBe(false);
  });
  it('comments', () => {
    expect(classify('a.ts', `f(a) // old\n`, `g(a) // new\n`).left).toEqual([]);
    expect(classify('a.ts', `f(a) //note\n`, `f(a) // note\n`).whole).toBe(true);
  });
  it('sorted imports, named vs default kept apart', () => {
    expect(classify('a.ts', `import { b, a } from './m';\nimport z from 'z';\n`, `import z from 'z'\nimport { a, b } from "./m"\n`).whole).toBe(true);
    expect(classify('a.ts', `import { a } from './m';\n`, `import a from './m';\n`).whole).toBe(false);
  });
});

const TS_SRC = `import { readFile } from 'node:fs';

@Injectable()
export class UserService {
  private cache = new Map<string, User>();

  constructor(private readonly http: Http) {}

  async load(id: string): Promise<User> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    return this.http.get(\`/users/\${id}\`);
  }

  static create() {
    return new UserService(defaultHttp);
  }
}

export function parse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export const double = (n: number) => n * 2;

const helper = async function (a, b) {
  return a + b;
};
`;

describe('TypeScript: definitions', () => {
  const defs = extractDefinitions(tokenize(TS_SRC, ts), ts, { includeClasses: true });
  it('finds classes, methods, functions and arrow functions', () => {
    expect(defs.map((d) => [d.kind, d.qualname, d.startLine, d.endLine])).toEqual([
      ['class', 'UserService', 3, 18],
      ['def', 'UserService.constructor', 7, 7],
      ['def', 'UserService.load', 9, 13],
      ['def', 'UserService.create', 15, 17],
      ['def', 'parse', 20, 26],
      ['def', 'double', 28, 28],
      ['def', 'helper', 30, 32],
    ]);
  });
  it('parameters', () => {
    expect(defs.find((d) => d.name === 'parse')!.params).toEqual(['text', 'fallback']);
    expect(defs.find((d) => d.name === 'double')!.params).toEqual(['n']);
    expect(defs.find((d) => d.name === 'constructor')!.params).toEqual(['http']);
  });
  it('normalization ignores local names, quotes and semicolons', () => {
    const norm = (src: string) => {
      const [d] = extractDefinitions(tokenize(src, ts), ts);
      return normalizeDefinition(d!, ts);
    };
    expect(norm(`function f(a) {\n  const b = a + 'x';\n  return b;\n}`)).toEqual(norm(`function g(x) {\n  const y = x + "x"\n  return y\n}`));
    expect(norm(`function f(a) {\n  return a.foo;\n}`)).not.toEqual(norm(`function f(a) {\n  return a.bar;\n}`));
  });
  it('definition search terms', () => {
    expect(definitionTerms('  async load(id: string): Promise<User> {', ts)).toEqual(['load']);
    expect(definitionTerms('export default class Foo extends Bar {', ts)).toEqual(['Foo']);
    expect(definitionTerms('export const double = (n: number) => n * 2;', ts)).toEqual(['double']);
    expect(definitionTerms("import { a, b as c } from './x';", ts)).toEqual(['a', 'b']);
    expect(definitionTerms('foo(bar);', ts)).toEqual([]);
    expect(definitionTerms('if (x) {', ts)).toEqual([]);
    const rows: DiffRow[] = TS_SRC.split('\n').map((text, i) => ({ kind: 'code', line: i + 1, text }));
    const at = rows.findIndex((r) => r.kind === 'code' && r.text.includes('this.cache.get'));
    expect(enclosingDefinitions(rows, at, ts).map((d) => d.name)).toEqual(['load', 'UserService']);
  });
  it('highlighting', () => {
    const [line] = highlight(['export const x = /a+/g; // hi'], ts);
    expect(line!.filter((s) => s.cls).map((s) => `${s.cls}:${s.text}`)).toEqual(['k:export', 'k:const', 's:/a+/g', 'c:// hi']);
  });
});

describe('TypeScript: moved code', () => {
  const PARSE = `export function parseRows(text: string, limit: number) {
  const rows = [];
  for (const line of text.split('\\n')) {
    if (rows.length >= limit) break;
    const [id, name] = line.split(',');
    rows.push({ id: Number(id), name: name.trim() });
  }
  return rows;
}`;
  const KEEP = `export function keep(a: number) {\n  return a + 1;\n}`;
  const file = (path: string, before: string | null, after: string | null) => {
    const [diff] = parseUnifiedDiff(
      before === null
        ? diffOf(path, '', after!).replace(`--- a/${path}`, '--- /dev/null').replace(/^diff[^\n]*\n/, `diff --git a/${path} b/${path}\nnew file mode 100644\n`)
        : diffOf(path, before, after ?? ''),
    );
    return { diff: diff!, base: before, head: after };
  };
  it('finds a function moved to another file with renamed locals', () => {
    const moved = PARSE.replace('parseRows', 'readRows').replaceAll('rows', 'out').replace(/'/g, '"');
    const moves = detectMoves(
      [file('a.ts', `${KEEP}\n\n${PARSE}\n`, `${KEEP}\n`), file('b.ts', null, `${moved}\n`)],
      {},
      tsRegistry,
    );
    expect(moves.map((m) => [m.from.qualname, m.to.path, m.to.qualname, m.kind, m.lang])).toEqual([['parseRows', 'b.ts', 'readRows', 'moved', 'typescript']]);
  });
});
