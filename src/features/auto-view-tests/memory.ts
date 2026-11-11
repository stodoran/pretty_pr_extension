import { browser } from 'wxt/browser';

/**
 * Per-PR path sets kept in storage.local:
 *  - userUnviewed: files the user deliberately un-viewed (toggle or "Undo");
 *    never auto-marked again on that PR.
 *  - autoViewed: files the extension marked as viewed (and the user hasn't
 *    touched since), so they can be tagged "auto" on later visits too.
 */
export type PathSetKind = 'userUnviewed' | 'autoViewed';

const KINDS: PathSetKind[] = ['userUnviewed', 'autoViewed'];
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

interface Entry {
  paths: string[];
  updatedAt: number;
}

const storageKey = (kind: PathSetKind, prKey: string) => `${kind}:${prKey}`;

export async function loadPathSet(kind: PathSetKind, prKey: string): Promise<Set<string>> {
  const key = storageKey(kind, prKey);
  const res = await browser.storage.local.get(key);
  return new Set((res[key] as Entry | undefined)?.paths ?? []);
}

export async function savePathSet(kind: PathSetKind, prKey: string, paths: Set<string>): Promise<void> {
  const key = storageKey(kind, prKey);
  if (!paths.size) return browser.storage.local.remove(key);
  const entry: Entry = { paths: [...paths], updatedAt: Date.now() };
  await browser.storage.local.set({ [key]: entry });
}

export async function pruneAutoViewMemory(): Promise<void> {
  const all = await browser.storage.local.get(null);
  const cutoff = Date.now() - MAX_AGE_MS;
  const stale = Object.entries(all)
    .filter(([k, v]) => KINDS.some((kind) => k.startsWith(`${kind}:`)) && (v as Entry).updatedAt < cutoff)
    .map(([k]) => k);
  if (stale.length) await browser.storage.local.remove(stale);
}
