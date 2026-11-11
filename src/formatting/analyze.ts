import { browser } from 'wxt/browser';
import { fetchPrDiff, sha1Hex } from '../github/fetch';
import { parseUnifiedDiff } from '../moves/unified-diff';
import { classifyFile, type FileFormatting } from './classify';

/** Background-worker side: fetch the PR diff, classify every file, cache by diff content. */

export interface FormattingResult {
  /** Files with at least one formatting-only line. */
  files: FileFormatting[];
}

const memoryCache = new Map<string, FormattingResult>();

export async function analyzeFormatting(params: { owner: string; repo: string; number: number }): Promise<FormattingResult> {
  const { owner, repo, number } = params;
  const diffText = await fetchPrDiff(owner, repo, number);
  const cacheKey = `format:v7:${owner}/${repo}#${number}:${await sha1Hex(diffText)}`;
  const cached = memoryCache.get(cacheKey) ?? ((await browser.storage.session.get(cacheKey))[cacheKey] as FormattingResult | undefined);
  if (cached) return cached;

  const files = parseUnifiedDiff(diffText)
    .map(classifyFile)
    .filter((f): f is FileFormatting => !!f && f.formatting > 0);
  const result: FormattingResult = { files };
  memoryCache.set(cacheKey, result);
  await browser.storage.session.set({ [cacheKey]: result }).catch(() => {}); // quota: memory cache still works
  return result;
}
