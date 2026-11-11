import { browser } from 'wxt/browser';
import { loadSettings } from '../core/settings';
import { createTestFileMatcher } from '../core/test-files';
import { loadRegistry } from '../lang/storage';
import { fetchHeadOidFromPatch, fetchPrDiff, fetchRawFile, sha1Hex } from '../github/fetch';
import { detectMoves, type FileVersions, type MovedFunction } from './detect';
import { parseUnifiedDiff, reverseApply, sideFromDiff, type DiffFile } from './unified-diff';

/** Background-worker orchestration: fetch → reconstruct both sides → detect → cache. */

export interface MovesResult {
  moves: MovedFunction[];
  analyzedFiles: number;
  skipped: { path: string; reason: string }[];
}

const MAX_FILES = 200;
const FETCH_CONCURRENCY = 6;
const memoryCache = new Map<string, MovesResult>();

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

export async function analyzeMoves(params: {
  owner: string;
  repo: string;
  number: number;
  headOid: string | null;
}): Promise<MovesResult> {
  const { owner, repo, number } = params;
  const [diffText, settings, registry] = await Promise.all([fetchPrDiff(owner, repo, number), loadSettings(), loadRegistry()]);
  const { minSimilarity } = settings.features.movedCode;

  // Cache by diff content (+ threshold): any new push changes the diff.
  const cacheKey = `moves:v4:${owner}/${repo}#${number}:${minSimilarity}:${registry.hash}:${await sha1Hex(diffText)}`;
  const cached = memoryCache.get(cacheKey) ?? ((await browser.storage.session.get(cacheKey))[cacheKey] as MovesResult | undefined);
  if (cached) return cached;

  const isTest = createTestFileMatcher(settings.testPatterns, owner, repo);
  const skipped: MovesResult['skipped'] = [];
  const files = parseUnifiedDiff(diffText).filter((f) => {
    const path = (f.newPath ?? f.oldPath)!;
    if (f.binary || !registry.forPath(path)) return false;
    if (isTest(path).isTest) return false;
    return true;
  });
  for (const f of files.splice(MAX_FILES)) skipped.push({ path: (f.newPath ?? f.oldPath)!, reason: 'too many files' });

  // The page's head commit can be stale after in-page navigation; every fetched
  // file is verified against the diff's blob id, falling back to the .patch's last commit.
  let pageOid = params.headOid;
  let patchOid: Promise<string | null> | null = null;
  const tryOid = async (f: DiffFile, oid: string) => {
    const raw = await fetchRawFile(owner, repo, oid, f.newPath!);
    return !f.newBlob || raw.blobId.startsWith(f.newBlob) ? raw.text : null;
  };
  const loadHead = async (f: DiffFile): Promise<string | null> => {
    if (pageOid) {
      const text = await tryOid(f, pageOid);
      if (text !== null) return text;
      pageOid = null;
    }
    const oid = await (patchOid ??= fetchHeadOidFromPatch(owner, repo, number));
    return oid ? tryOid(f, oid) : null;
  };

  const versions = await pool(files, FETCH_CONCURRENCY, async (diff): Promise<FileVersions | null> => {
    const path = (diff.newPath ?? diff.oldPath)!;
    try {
      if (diff.status === 'added') return { diff, base: null, head: sideFromDiff(diff, 'new') };
      if (diff.status === 'deleted') return { diff, base: sideFromDiff(diff, 'old'), head: null };
      const head = await loadHead(diff);
      if (head === null) {
        skipped.push({ path, reason: 'could not fetch a matching head version' });
        return null;
      }
      return { diff, base: reverseApply(head, diff), head };
    } catch (err) {
      skipped.push({ path, reason: (err as Error).message });
      return null;
    }
  });

  const analyzed = versions.filter((v): v is FileVersions => v !== null);
  const result: MovesResult = { moves: detectMoves(analyzed, { minSimilarity }, registry), analyzedFiles: analyzed.length, skipped };
  memoryCache.set(cacheKey, result);
  await browser.storage.session.set({ [cacheKey]: result }).catch(() => {}); // quota: memory cache still works
  return result;
}
