import { COLORS } from '../../core/ui/colors';
import type { Feature } from '../../core/feature';
import { createTestFileMatcher } from '../../core/test-files';
import { isFilesTab, prKey } from '../../github/pr';
import { loadPathSet, savePathSet } from './memory';

/**
 * On the Files changed tab, clicks GitHub's own "Viewed" toggle for each file
 * matching the auto-view patterns (tests + markdown by default) as it renders
 * (the list is virtualized, so files appear while scrolling). GitHub persists
 * the state itself — no token or API needed.
 *
 * Files the extension marked get an "auto" tag on their Viewed toggle (also on
 * later visits) until the user clicks that toggle themselves. If the user
 * un-views such a file, we remember that per PR and leave it alone.
 */

const AUTO_ATTR = 'data-prh-auto-viewed';
const AUTO_TITLE = 'Automatically marked as viewed by Pretty PR Review';

const CSS = `
button[${AUTO_ATTR}]::after {
  content: "auto";
  margin-left: 6px; padding: 0 5px; border-radius: 6px;
  font: 600 10px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #fff; background: ${COLORS.autoViewed};
}
`;

export const autoViewTests: Feature = {
  id: 'autoViewTests',
  appliesTo: isFilesTab,

  async run({ page, settings, dom, status, signal, reportError }) {
    const matcher = createTestFileMatcher(settings.testPatterns, page.owner, page.repo);
    const testCache = new Map<string, boolean>();
    const isTest = (path: string) => {
      let v = testCache.get(path);
      if (v === undefined) testCache.set(path, (v = matcher(path).isTest));
      return v;
    };

    const key = prKey(page);
    const [userUnviewed, autoViewed] = await Promise.all([loadPathSet('userUnviewed', key), loadPathSet('autoViewed', key)]);
    if (signal.aborted) return;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    signal.addEventListener('abort', () => style.remove(), { once: true });

    const marked = new Set<string>(); // auto-marked during this visit
    const clicked = new Set<string>(); // never auto-click a file twice per visit (avoids toggle races)
    const pendingUndo = new Set<string>();
    const skipped = new Set<string>(); // rendered, unviewed, but previously un-viewed by the user
    let paused = false;

    const save = (kind: 'userUnviewed' | 'autoViewed') =>
      savePathSet(kind, key, kind === 'userUnviewed' ? userUnviewed : autoViewed).catch(reportError);

    const tagAuto = (el: HTMLElement, on: boolean) => {
      const toggle = dom.viewedToggle(el);
      if (!toggle || toggle.hasAttribute(AUTO_ATTR) === on) return;
      if (on) {
        toggle.setAttribute(AUTO_ATTR, '');
        toggle.title = AUTO_TITLE;
      } else {
        toggle.removeAttribute(AUTO_ATTR);
        if (toggle.title === AUTO_TITLE) toggle.removeAttribute('title');
      }
    };

    const plural = (n: number) => (n === 1 ? '' : 's');
    const showStatus = () => {
      const parts: string[] = [];
      if (marked.size) parts.push(`Marked ${marked.size} test/docs file${plural(marked.size)} as viewed`);
      if (skipped.size) parts.push(`${skipped.size} skipped because you unmarked ${skipped.size === 1 ? 'it' : 'them'}`);
      if (!parts.length) return;
      status.set({
        text: `🧪 ${parts.join(' · ')}`,
        actions: [
          ...(marked.size ? [{ label: 'Undo', onClick: () => undo().catch(reportError) }] : []),
          ...(skipped.size ? [{ label: 'Mark skipped', onClick: () => markSkipped().catch(reportError) }] : []),
        ],
      });
    };

    const process = (els: HTMLElement[]) => {
      let changed = false;
      let autoChanged = false;
      for (const el of els) {
        const path = dom.filePath(el);
        if (!path || !isTest(path)) continue;
        const viewed = dom.isViewed(el);
        if (viewed === null) continue; // header not rendered yet; observer will revisit

        if (pendingUndo.has(path)) {
          if (viewed) dom.toggleViewed(el);
          tagAuto(el, false);
          pendingUndo.delete(path);
          continue;
        }
        if (viewed) {
          tagAuto(el, autoViewed.has(path)); // re-tag after re-renders and on later visits
          continue;
        }
        tagAuto(el, false);
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
          tagAuto(el, true);
          changed = autoChanged = true;
        }
      }
      if (autoChanged) save('autoViewed');
      if (changed) showStatus();
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
      status.set({ text: `Unmarked ${marked.size} file(s). Auto-marking is paused on this PR until you reload.` });
    }

    /** Forget the user's manual un-views for this PR and mark those files too. */
    async function markSkipped() {
      userUnviewed.clear();
      skipped.clear();
      clicked.clear();
      paused = false;
      await save('userUnviewed');
      process(dom.fileElements()); // the rest get marked as they render
      showStatus();
    }

    // The user's own clicks on test-file toggles: un-viewing is remembered, and
    // either way the file is now the user's call, so it loses the "auto" tag.
    // Programmatic .click() calls (ours) have isTrusted === false.
    const onClick = (e: MouseEvent) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      const fileEl = dom.fileElementOf(e.target);
      if (!fileEl) return;
      const toggle = dom.viewedToggle(fileEl);
      if (!toggle?.contains(e.target)) return;
      const path = dom.filePath(fileEl);
      if (!path || !isTest(path)) return;
      // Capture phase: aria-pressed still holds the pre-click state.
      if (dom.isViewed(fileEl)) userUnviewed.add(path);
      else userUnviewed.delete(path);
      autoViewed.delete(path);
      tagAuto(fileEl, false);
      save('userUnviewed');
      save('autoViewed');
    };
    document.addEventListener('click', onClick, { capture: true, signal });

    const unsubscribe = dom.observeFiles(process);
    signal.addEventListener('abort', unsubscribe, { once: true });
    process(dom.fileElements());
  },
};
