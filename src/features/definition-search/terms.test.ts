import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '../../lang/registry';
import { enclosingDefinitions as enclosingWith, type DiffRow, definitionTerms as termsWith, repoSearchUrl } from './terms';

const python = builtinRegistry.byId('python')!;
const definitionTerms = (line: string) => termsWith(line, python);
const enclosingDefinitions = (rows: DiffRow[], index: number) => enclosingWith(rows, index, python);

describe('definitionTerms', () => {
  it.each([
    ['def parse_records(path, limit=None):', ['parse_records']],
    ['    async def fetch(self) -> bytes:', ['fetch']],
    ['class TokenParser(Base, metaclass=Meta):', ['TokenParser']],
    ['import os', ['os']],
    ['import numpy as np, os.path', ['numpy', 'os.path']],
    ['from finetunable.common import generation_tokens, logprobs as lp', ['generation_tokens', 'logprobs', 'finetunable.common']],
    ['from .utils import (helper,', ['helper', 'utils']],
    ['from . import sibling', ['sibling']],
    ['from x import *', ['x']],
    ['def f():  # comment with def g()', ['f']],
  ])('%s', (line, terms) => expect(definitionTerms(line)).toEqual(terms));

  it.each(['result = parse_records(path)', 'return TokenParser()', '    x = 1', '"def not_a_def"', 'defaults = {}'])(
    'ignores references and non-definitions: %s',
    (line) => expect(definitionTerms(line)).toEqual([]),
  );
});

it('builds a repo-scoped code search URL', () => {
  expect(repoSearchUrl('UiPath', 'idp-workflows', 'generation_tokens')).toBe(
    'https://github.com/search?q=repo%3AUiPath%2Fidp-workflows%20generation_tokens&type=code',
  );
});

describe('enclosingDefinitions', () => {
  const code = (start: number, src: string): DiffRow[] => src.split('\n').map((text, i) => ({ kind: 'code', line: start + i, text }));
  const src = `class Store:
    def load(
        self,
        path,
    ) -> None:
        if path:
            self.rows = read(path)

        def helper(x):
            return x
    x = 1
def top():
    pass`;
  const rows = code(10, src);
  const find = (needle: string) => rows.findIndex((r) => r.kind === 'code' && r.text.includes(needle));
  const at = (needle: string) => enclosingDefinitions(rows, find(needle)).map((d) => d.name);

  it('finds the enclosing function and class from any line', () => {
    expect(at('self.rows')).toEqual(['load', 'Store']);
    expect(at('if path')).toEqual(['load', 'Store']);
    expect(at('return x')).toEqual(['helper', 'load', 'Store']);
    expect(at('x = 1')).toEqual(['Store']);
    expect(at('pass')).toEqual(['top']);
  });
  it('points at the definition lines', () => {
    expect(enclosingDefinitions(rows, find('return x'))).toEqual([
      { name: 'helper', row: find('def helper') },
      { name: 'load', row: find('def load') },
      { name: 'Store', row: find('class Store') },
    ]);
  });
  it('includes the definition on its own line, and handles multi-line signatures', () => {
    expect(at('def load')).toEqual(['load', 'Store']);
    expect(at('path,')).toEqual(['load', 'Store']);
    expect(at('class Store')).toEqual(['Store']);
  });
  it('shows nothing on blank lines', () => {
    expect(enclosingDefinitions(rows, 7)).toEqual([]);
  });
  it('falls back to the hunk header when the definition is not shown', () => {
    const hunk: DiffRow[] = [
      { kind: 'hunk', text: '@@ -40,3 +40,4 @@ def process(items):' },
      ...code(40, '    for item in items:\n        handle(item)'),
    ];
    expect(enclosingDefinitions(hunk, 2)).toEqual([{ name: 'process', row: 0 }]);
    // Gap in line numbers inside the visible rows also stops the walk.
    const gap: DiffRow[] = [...code(1, 'def a():\n    pass'), { kind: 'hunk', text: '@@ -9 +9 @@ class B:' }, ...code(9, '    y = 2')];
    expect(enclosingDefinitions(gap, 3)).toEqual([{ name: 'B', row: 2 }]);
  });
});
