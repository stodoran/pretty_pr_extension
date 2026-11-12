import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readableJsonDiff, type JsonHunk } from './diff';
import { diffLineOps } from './myers';
import { describePath, prettyJson } from './pretty';

const doc = (desc: string, extra = '') =>
  JSON.stringify({
    field_groups: Array.from({ length: 30 }, (_, g) => ({
      field_group_id: `g${g}`,
      name: `Group ${g}`,
      fields: Array.from({ length: 5 }, (_, f) => ({
        field_id: `f${g}-${f}`,
        name: `Field ${f}`,
        description: g === 12 && f === 2 ? desc : `About field ${f}`,
        spans: [{ page: 0, vertices: [[0.8475540386803185, 0.1], [0.9, 0.1], [0.9, 0.2], [0.8475540386803185, 0.2]] }],
      })),
    })),
    ...(extra ? { extra } : {}),
  });

const show = (h: JsonHunk) => h.lines.filter((l) => l.kind !== ' ').map((l) => `${l.kind}${l.text.trim()}`);

describe('prettyJson', () => {
  it('formats like JSON.stringify(…, 2), short containers on one line, each token as written', () => {
    expect(prettyJson('{"n":1.0,"big":12345678901234567890,"e":"x\\u00e9","a":[],"o":{}}')!.lines).toEqual([
      '{"n": 1.0, "big": 12345678901234567890, "e": "x\\u00e9", "a": [], "o": {}}',
    ]);
    const long = `"${'x'.repeat(100)}"`;
    expect(prettyJson(`{"poly":[[0.25,0.5],[1,2]],"note":${long},"nested":{"a":[1,2,3],"b":{"c":${long}}}}`)!.lines).toEqual([
      '{',
      '  "poly": [[0.25, 0.5], [1, 2]],',
      `  "note": ${long},`,
      '  "nested": {',
      '    "a": [1, 2, 3],',
      `    "b": {"c": ${long}}`,
      '  }',
      '}',
    ]);
  });

  it('rejects invalid JSON', () => {
    for (const bad of ['{"a":1,}', '{"a":1} x', '[1 2]', "{'a':1}", '', '{"a":"\n"}']) expect(prettyJson(bad)).toBeNull();
  });

  it('records paths and labels', () => {
    const pad = `"${'p'.repeat(120)}"`;
    const p = prettyJson(`{"groups":[{"id":"g1","name":"Income","fields":[{"name":"Client Name","x":1,"p":${pad}}]}],"we ird":{"k":2,"p":${pad}}}`)!;
    const x = p.lines.findIndex((l) => l.trim() === '"x": 1,');
    expect(p.paths[x]).toBe('groups[0].fields[0].x');
    expect(describePath(p.paths[x]!, p.labels)).toBe('groups[0] “Income” › fields[0] “Client Name” › x');
    const k = p.lines.findIndex((l) => l.trim() === '"k": 2,');
    expect(describePath(p.paths[k]!, p.labels)).toBe('["we ird"] › k');
  });
});

describe('diffLineOps', () => {
  it('matches a plain LCS on small inputs', () => {
    const a = 'a b c d e f'.split(' ');
    const b = 'a x c d f g'.split(' ');
    const ops = diffLineOps(a, b);
    expect(ops.filter((o) => o === ' ')).toHaveLength(4);
    expect(ops.filter((o) => o !== '+')).toHaveLength(a.length);
    expect(ops.filter((o) => o !== '-')).toHaveLength(b.length);
  });

  it('is fast on long texts with few edits', () => {
    const a = Array.from({ length: 50_000 }, (_, i) => `line ${i % 997}`);
    const b = [...a];
    b.splice(100, 1, 'changed');
    b.splice(30_000, 0, 'inserted');
    const t = performance.now();
    const ops = diffLineOps(a, b);
    expect(performance.now() - t).toBeLessThan(500);
    expect(ops.filter((o) => o !== ' ')).toEqual(['-', '+', '+']);
  });
});

describe('readableJsonDiff', () => {
  it('leaves already-readable JSON to GitHub', () => {
    const pretty = (s: string) => JSON.stringify(JSON.parse(s), null, 2);
    expect(readableJsonDiff(pretty(doc('a')), pretty(doc('b'))).status).toBe('readable');
    // Several lines, one of them very long: GitHub's line diff still works.
    const long = `{\n  "a": "${'x'.repeat(800)}",\n  "b": 1\n}`;
    expect(readableJsonDiff(long, long.replace('"b": 1', '"b": 2')).status).toBe('readable');
  });

  it('shows a minified change as a few lines, located and word-marked', () => {
    const r = readableJsonDiff(doc('The account holder’s full name'), doc('The account holder’s legal name'));
    if (r.status !== 'diff') throw new Error(r.status);
    expect(r.hunks).toHaveLength(1);
    expect(r.hunks[0]!.location).toBe('field_groups[12] “Group 12” › fields[2] “Field 2” › description');
    expect(show(r.hunks[0]!)).toEqual(['-"description": "The account holder’s full name",', '+"description": "The account holder’s legal name",']);
    const [minus, plus] = r.hunks[0]!.lines.filter((l) => l.kind !== ' ');
    expect(minus!.text.slice(...minus!.mark!)).toBe('full');
    expect(plus!.text.slice(...plus!.mark!)).toBe('legal');
    expect(r.hunks[0]!.lines.filter((l) => l.kind === ' ')).toHaveLength(6);
    expect([r.added, r.removed]).toEqual([1, 1]);
  });

  it('separates distant changes and merges near ones', () => {
    const r = readableJsonDiff(doc('a'), doc('b', 'tail'));
    if (r.status !== 'diff') throw new Error(r.status);
    expect(r.hunks.map((h) => h.location)).toEqual(['field_groups[12] “Group 12” › fields[2] “Field 2” › description', 'extra']);
    expect(show(r.hunks[1]!)).toEqual(['-]', '+],', '+"extra": "tail"']);
  });

  it('formatting only, and invalid', () => {
    const min = doc('a');
    const reordered = JSON.stringify(JSON.parse(min), null, 1).replace(/\n/g, '\n'.padEnd(600, ' '));
    expect(readableJsonDiff(min, reordered).status).toBe('formatting');
    expect(readableJsonDiff(min, `${min.slice(0, -1)},}`).status).toBe('invalid');
  });
});

describe('demo PR JSON files', () => {
  const read = (side: string, name: string) => readFileSync(`demo/typescript/${side}/${name}`, 'utf8');
  it('leaves the indented one to GitHub and formats the minified one', () => {
    expect(readableJsonDiff(read('toys', 'settings.json'), read('after', 'settings.json')).status).toBe('readable');
    const r = readableJsonDiff(read('toys', 'fields.json'), read('after', 'fields.json'));
    if (r.status !== 'diff') throw new Error(r.status);
    expect(r.hunks.map((h) => h.location)).toEqual([
      'field_groups[1] “Account Holder” › fields[0] “Client Name” › description',
      'field_groups[1] “Account Holder” › fields[1] “Address” › spans[0]',
      'field_groups[3] “Co Account Holder” › field_group_id',
    ]);
  });
});
