export interface PrPage {
  owner: string;
  repo: string;
  number: number;
  /** Sub-page: `changes` (new UI), `files` (legacy), `commits`, ..., or null for conversation. */
  tab: string | null;
}

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/([^/?#]+))?/;

export function parsePrUrl(url: string): PrPage | null {
  const u = new URL(url);
  if (u.hostname !== 'github.com') return null;
  const m = PR_PATH.exec(u.pathname);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]), tab: m[4] ?? null };
}

export function isFilesTab(page: PrPage): boolean {
  return page.tab === 'changes' || page.tab === 'files';
}

/** Stable storage key for a PR. */
export function prKey(page: PrPage): string {
  return `${page.owner}/${page.repo}#${page.number}`.toLowerCase();
}
