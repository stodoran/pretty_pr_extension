import { describe, expect, it } from 'vitest';
import { highlight } from './highlight';
import { builtinRegistry } from './registry';

const python = builtinRegistry.byId('python')!;
const highlightPython = (lines: string[]) => highlight(lines, python);

const cls = (line: string, i = 0) => highlightPython([line])[0]!.filter((s) => s.cls).map((s) => `${s.cls}:${s.text}`);

describe('highlightPython', () => {
  it('colors keywords, names, strings, numbers and comments', () => {
    expect(cls('def foo(x=1):  # hi')).toEqual(['k:def', 'en:foo', 'c1:1', 'c:# hi']);
    expect(cls('return f"a{b}" if x is None else \'q\'')).toEqual(['k:return', 's:f"a{b}"', 'k:if', 'k:is', 'c1:None', 'k:else', "s:'q'"]);
    expect(cls('@dataclass(frozen=True)')).toEqual(['en:@dataclass', 'c1:True']);
  });
  it('keeps escaped quotes inside strings', () => {
    expect(cls('x = "a\\"b" + 2')).toEqual(['s:"a\\"b"', 'c1:2']);
  });
  it('carries triple-quoted strings across lines', () => {
    const out = highlightPython(['    """Doc', '    with # no comment', '    end""" + x']);
    expect(out[0]!.map((s) => s.cls)).toEqual([undefined, 's']);
    expect(out[1]).toEqual([{ text: '    with # no comment', cls: 's' }]);
    expect(out[2]!.map((s) => `${s.cls ?? '-'}:${s.text}`)).toEqual(['s:    end"""', '-: + x']);
  });
});
