/**
 * Background-worker fetches against github.com using the user's session
 * cookies (no token). `/pull/N.diff` and `/raw/...` redirect to
 * patch-diff.githubusercontent.com / raw.githubusercontent.com, which the
 * extension's host permissions allow.
 */

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 404) throw new Error(`GitHub returned 404 for ${new URL(url).pathname} (signed out, or no access?)`);
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${new URL(url).pathname}`);
  return res;
}

const repoUrl = (owner: string, repo: string) =>
  `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/** Moved-code and formatting analysis both need the diff on page load: fetch it once. */
const DIFF_TTL_MS = 30_000;
const diffs = new Map<string, { at: number; text: Promise<string> }>();

export function fetchPrDiff(owner: string, repo: string, number: number): Promise<string> {
  const url = `${repoUrl(owner, repo)}/pull/${number}.diff`;
  const now = Date.now();
  for (const [k, v] of diffs) if (now - v.at > DIFF_TTL_MS) diffs.delete(k);
  const hit = diffs.get(url);
  if (hit) return hit.text;
  const text = get(url).then((r) => r.text());
  diffs.set(url, { at: now, text });
  text.catch(() => diffs.delete(url));
  return text;
}

/** Head commit = last commit in the PR's `.patch` (fallback when the page didn't expose it). */
export async function fetchHeadOidFromPatch(owner: string, repo: string, number: number): Promise<string | null> {
  const text = await (await get(`${repoUrl(owner, repo)}/pull/${number}.patch`)).text();
  return [...text.matchAll(/^From ([0-9a-f]{40}) /gm)].at(-1)?.[1] ?? null;
}

export interface RawFile {
  text: string;
  /** Full git blob id (sha1 of "blob <len>\0<bytes>"), to verify against the diff's `index` line. */
  blobId: string;
}

export async function fetchRawFile(owner: string, repo: string, oid: string, path: string): Promise<RawFile> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const bytes = new Uint8Array(await (await get(`${repoUrl(owner, repo)}/raw/${oid}/${encoded}`)).arrayBuffer());
  return { text: new TextDecoder().decode(bytes), blobId: await gitBlobId(bytes) };
}

export async function gitBlobId(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha1Hex(text: string): Promise<string> {
  return gitBlobId(new TextEncoder().encode(text));
}
