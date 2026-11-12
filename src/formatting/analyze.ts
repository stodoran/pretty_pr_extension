import { browser } from 'wxt/browser';
import { fetchPrDiff, sha1Hex } from '../github/fetch';
import { loadRegistry } from '../lang/storage';
import { parseUnifiedDiff } from '../moves/unified-diff';
import { classifyFile, hasMarks, type FileFormatting } from './classify';

/** Background-worker side: fetch the PR diff, classify every file, cache by diff content. */

export interface FormattingResult {
  /** Files with at least one formatting- or comment-only line. */
  files: FileFormatting[];
}

const memoryCache = new Map<string, FormattingResult>();

export async function analyzeFormatting(params: { owner: string; repo: string; number: number }): Promise<FormattingResult> {
  const { owner, repo, number } = params;
  const [diffText, registry] = await Promise.all([fetchPrDiff(owner, repo, number), loadRegistry()]);
  const cacheKey = `format:v12:${owner}/${repo}#${number}:${registry.hash}:${await sha1Hex(diffText)}`;
  const cached = memoryCache.get(cacheKey) ?? ((await browser.storage.session.get(cacheKey))[cacheKey] as FormattingResult | undefined);
  if (cached) return cached;

  const files = parseUnifiedDiff(diffText)
    .map((f) => classifyFile(f, registry))
    .filter((f): f is FileFormatting => !!f && hasMarks(f));
  const result: FormattingResult = { files };
  memoryCache.set(cacheKey, result);
  await browser.storage.session.set({ [cacheKey]: result }).catch(() => {}); // quota: memory cache still works
  return result;
}
