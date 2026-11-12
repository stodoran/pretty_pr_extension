import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIFF_TIMED_OUT, DIFF_TOO_LARGE, fetchPrDiff } from './fetch';

afterEach(() => vi.unstubAllGlobals());

describe('fetchPrDiff', () => {
  it("says so when GitHub won't generate the diff", async () => {
    vi.stubGlobal('fetch', async () => new Response('error: too big or took too long to generate', { status: 403 }));
    await expect(fetchPrDiff('o', 'r', 1)).rejects.toThrow(DIFF_TOO_LARGE);
  });

  it('says so when generating the diff timed out', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 502 }));
    await expect(fetchPrDiff('o', 'r', 3)).rejects.toThrow(DIFF_TIMED_OUT);
  });

  it('reports other 403s with the status', async () => {
    vi.stubGlobal('fetch', async () => new Response('forbidden', { status: 403 }));
    await expect(fetchPrDiff('o', 'r', 2)).rejects.toThrow('GitHub returned 403');
  });
});
