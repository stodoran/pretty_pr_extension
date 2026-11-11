import { describe, expect, it } from 'vitest';
import { definitionTerms, repoSearchUrl } from './terms';

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
