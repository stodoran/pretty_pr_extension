/**
 * All knowledge of GitHub's diff markup lives behind this interface so
 * features (and future ones that decorate diff lines) don't break when
 * GitHub ships UI changes — only an adapter does.
 */
export interface DiffDomAdapter {
  /** File diff containers currently rendered (the new UI virtualizes long PRs). */
  fileElements(root?: ParentNode): HTMLElement[];
  /** The file container that `node` is inside of, if any. */
  fileElementOf(node: Element): HTMLElement | null;
  /** Repo-relative path of the file (the new path for renames), or null if not rendered yet. */
  filePath(fileEl: HTMLElement): string | null;
  /** The file's Viewed toggle, or null if its header isn't rendered yet. */
  viewedToggle(fileEl: HTMLElement): HTMLElement | null;
  /** true/false if the Viewed toggle is found, null otherwise. */
  isViewed(fileEl: HTMLElement): boolean | null;
  /** Clicks the Viewed toggle (GitHub persists the state itself). Returns false if not found. */
  toggleViewed(fileEl: HTMLElement): boolean;
  /** Cells (line number + code) for one line on one side of a rendered file diff. */
  lineCells(fileEl: HTMLElement, side: 'left' | 'right', line: number): HTMLElement[];
  /** Calls `cb` with file containers that were added or re-rendered. Returns an unsubscribe fn. */
  observeFiles(cb: (fileEls: HTMLElement[]) => void): () => void;
}

/** GitHub anchors each file's diff at `#diff-<hex sha256 of the path>`. */
export async function diffAnchorId(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `diff-${hex}`;
}
