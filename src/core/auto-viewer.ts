import type { DiffDomAdapter } from '../github/dom/adapter';
import { loadPathSet, savePathSet, type PathSetKind } from './auto-view-memory';
import type { StatusAction } from './ui/status-dock';

/**
 * Clicks GitHub's own "Viewed" toggle for candidate files as they render (the
 * list is virtualized, so files appear while scrolling). GitHub persists the
 * state itself — no token or API needed.
 *
 * Files marked this way get a tag on their Viewed toggle (also on later
 * visits) until the user clicks that toggle themselves. If the user un-views
 * such a file, that's remembered per PR and the file is left alone.
 *
 * Shared by the test/docs and formatting-only features; each has its own tag
 * attribute and memory, so they never undo each other's tags.
 */
export interface AutoViewerOptions {
  dom: DiffDomAdapter;
  signal: AbortSignal;
  reportError: (err: unknown) => void;
  prKey: string;
  memory: { userUnviewed: PathSetKind; autoViewed: PathSetKind };
  /** Attribute set on the Viewed toggle of files this viewer marked. */
  attr: string;
  /** Text of the tag shown on that toggle. */
  tag: string;
  color: string;
  title: string;
  /** "test/docs file" → "Marked 3 test/docs files as viewed". */
  noun: string;
  isCandidate(path: string): boolean;
  /** The status summary changed; read it with `summary()`. */
  onChange(): void;
}

export interface AutoViewer {
  summary(): { parts: string[]; actions: StatusAction[] };
}

export async function startAutoViewer(o: AutoViewerOptions): Promise<AutoViewer | null> {
  const { dom, signal, reportError } = o;
  const [userUnviewed, autoViewed] = await Promise.all([
    loadPathSet(o.memory.userUnviewed, o.prKey),
    loadPathSet(o.memory.autoViewed, o.prKey),
  ]);
  if (signal.aborted) return null;

  const style = document.createElement('style');
  style.textContent = `
button[${o.attr}]::after {
  content: "${o.tag}";
  margin-left: 6px; padding: 0 5px; border-radius: 6px;
  font: 600 10px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #fff; background: ${o.color};
}`;
  document.head.append(style);
  signal.addEventListener('abort', () => style.remove(), { once: true });

  const marked = new Set<string>(); // auto-marked during this visit
  const clicked = new Set<string>(); // never auto-click a file twice per visit (avoids toggle races)
  const pendingUndo = new Set<string>();
  const skipped = new Set<string>(); // rendered, unviewed, but previously un-viewed by the user
  let paused = false;
  let undone = 0;

  const save = (which: 'userUnviewed' | 'autoViewed') =>
    savePathSet(o.memory[which], o.prKey, which === 'userUnviewed' ? userUnviewed : autoViewed).catch(reportError);

  const tag = (el: HTMLElement, on: boolean) => {
    const toggle = dom.viewedToggle(el);
    if (!toggle || toggle.hasAttribute(o.attr) === on) return;
    if (on) {
      toggle.setAttribute(o.attr, '');
      toggle.title = o.title;
    } else {
      toggle.removeAttribute(o.attr);
      if (toggle.title === o.title) toggle.removeAttribute('title');
    }
  };

  const plural = (n: number) => (n === 1 ? '' : 's');
  const summary = () => {
    if (undone) return { parts: [`Unmarked ${undone} file${plural(undone)}; auto-marking paused until reload`], actions: [] };
    const parts: string[] = [];
    if (marked.size) parts.push(`Marked ${marked.size} ${o.noun}${plural(marked.size)} as viewed`);
    if (skipped.size) parts.push(`${skipped.size} skipped because you unmarked ${skipped.size === 1 ? 'it' : 'them'}`);
    const actions: StatusAction[] = [
      ...(marked.size ? [{ label: 'Undo', onClick: () => undo().catch(reportError) }] : []),
      ...(skipped.size ? [{ label: 'Mark skipped', onClick: () => markSkipped().catch(reportError) }] : []),
    ];
    return { parts, actions };
  };

  const process = (els: HTMLElement[]) => {
    let changed = false;
    let autoChanged = false;
    for (const el of els) {
      const path = dom.filePath(el);
      if (!path || !o.isCandidate(path)) continue;
      const viewed = dom.isViewed(el);
      if (viewed === null) continue; // header not rendered yet; observer will revisit

      if (pendingUndo.has(path)) {
        if (viewed) dom.toggleViewed(el);
        tag(el, false);
        pendingUndo.delete(path);
        continue;
      }
      if (viewed) {
        tag(el, autoViewed.has(path)); // re-tag after re-renders and on later visits
        continue;
      }
      tag(el, false);
      if (paused || clicked.has(path)) continue;
      if (userUnviewed.has(path)) {
        if (!skipped.has(path)) {
          skipped.add(path);
          changed = true;
        }
        continue;
      }
      if (dom.toggleViewed(el)) {
        clicked.add(path);
        marked.add(path);
        autoViewed.add(path);
        tag(el, true);
        changed = autoChanged = true;
      }
    }
    if (autoChanged) save('autoViewed');
    if (changed) o.onChange();
  };

  async function undo() {
    paused = true;
    for (const path of marked) {
      userUnviewed.add(path);
      autoViewed.delete(path);
      pendingUndo.add(path);
    }
    process(dom.fileElements()); // rendered ones now; virtualized ones when they reappear
    await Promise.all([save('userUnviewed'), save('autoViewed')]);
    undone = marked.size;
    o.onChange();
  }

  /** Forget the user's manual un-views for this PR and mark those files too. */
  async function markSkipped() {
    userUnviewed.clear();
    skipped.clear();
    clicked.clear();
    paused = false;
    await save('userUnviewed');
    process(dom.fileElements()); // the rest get marked as they render
    o.onChange();
  }

  // The user's own clicks on candidates' toggles: un-viewing is remembered, and
  // either way the file is now the user's call, so it loses the tag.
  // Programmatic .click() calls (ours) have isTrusted === false.
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const fileEl = dom.fileElementOf(e.target);
    if (!fileEl) return;
    const toggle = dom.viewedToggle(fileEl);
    if (!toggle?.contains(e.target)) return;
    const path = dom.filePath(fileEl);
    if (!path || !o.isCandidate(path)) return;
    // Capture phase: aria-pressed still holds the pre-click state.
    if (dom.isViewed(fileEl)) userUnviewed.add(path);
    else userUnviewed.delete(path);
    autoViewed.delete(path);
    tag(fileEl, false);
    save('userUnviewed');
    save('autoViewed');
  };
  document.addEventListener('click', onClick, { capture: true, signal });

  const unsubscribe = dom.observeFiles(process);
  signal.addEventListener('abort', unsubscribe, { once: true });
  process(dom.fileElements());
  return { summary };
}
