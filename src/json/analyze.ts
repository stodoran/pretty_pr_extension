import { fetchRawFile } from '../github/fetch';
import { readableJsonDiff, type ReadableJson } from './diff';

/**
 * Background-worker side: fetch both versions of one JSON file and diff them
 * formatted. Called per file as it scrolls into view (a big PR's JSON can be
 * gigabytes in total), a few at a time, cached by commit pair and path.
 */

export interface ReadableJsonParams {
  owner: string;
  repo: string;
  baseOid: string;
  headOid: string;
  path: string;
}

const CONCURRENCY = 4;
const CACHE_SIZE = 300;
const cache = new Map<string, Promise<ReadableJson>>();
let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export function analyzeReadableJson(p: ReadableJsonParams): Promise<ReadableJson> {
  const key = `${p.owner}/${p.repo}:${p.baseOid}:${p.headOid}:${p.path}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // re-insert as most recent
    cache.set(key, hit);
    return hit;
  }
  const result = limited(async () => {
    const [before, after] = await Promise.all([
      fetchRawFile(p.owner, p.repo, p.baseOid, p.path),
      fetchRawFile(p.owner, p.repo, p.headOid, p.path),
    ]);
    return readableJsonDiff(before.text, after.text);
  });
  cache.set(key, result);
  result.catch(() => cache.delete(key));
  for (const k of cache.keys()) {
    if (cache.size <= CACHE_SIZE) break;
    cache.delete(k);
  }
  return result;
}
