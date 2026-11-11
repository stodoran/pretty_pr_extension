import type { DiffDomAdapter } from './adapter';

/**
 * Adapter for GitHub's React "Files changed" UI (`/pull/N/changes`).
 * Verified Nov 2026. Deliberately avoids hashed CSS-module class names and
 * relies only on ids, ARIA and data attributes:
 *   file container:  [role=region][id^="diff-"]   (id = diff-<sha256(path)>)
 *   file path:       [data-file-path] inside it, else the heading named by aria-labelledby
 *   viewed toggle:   button[aria-pressed] labelled "Viewed" / "Not Viewed"
 *   diff line cells: td[data-diff-side=left|right][data-line-number=N]  (verified in split view)
 */
const FILE_SELECTOR = '[role="region"][id^="diff-"]';
const VIEWED_TOGGLE = 'button[aria-pressed][aria-label="Viewed"], button[aria-pressed][aria-label="Not Viewed"]';
/** Bidi/zero-width marks GitHub wraps around paths in headings. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export function createReactUiAdapter(): DiffDomAdapter {
  const viewedToggle = (el: HTMLElement) => el.querySelector<HTMLElement>(VIEWED_TOGGLE);

  return {
    fileElements(root: ParentNode = document) {
      return Array.from(root.querySelectorAll<HTMLElement>(FILE_SELECTOR));
    },
    fileElementOf: (node) => node.closest<HTMLElement>(FILE_SELECTOR),
    filePath(el) {
      const attr = el.querySelector('[data-file-path]')?.getAttribute('data-file-path');
      if (attr) return attr;
      const headingId = el.getAttribute('aria-labelledby');
      const heading = headingId ? document.getElementById(headingId) : null;
      const text = (heading?.querySelector('code') ?? heading)?.textContent?.replace(INVISIBLE, '').trim();
      if (!text) return null;
      // Renames render as "old → new" in free text; don't guess which part is the path.
      return text.includes('→') ? null : text;
    },
    viewedToggle,
    isViewed(el) {
      const btn = viewedToggle(el);
      return btn ? btn.getAttribute('aria-pressed') === 'true' : null;
    },
    lineCells(el, side, line) {
      return Array.from(el.querySelectorAll<HTMLElement>(`td[data-diff-side="${side}"][data-line-number="${line}"]`));
    },
    toggleViewed(el) {
      const btn = viewedToggle(el);
      btn?.click();
      return !!btn;
    },
    observeFiles(cb) {
      let queued = new Set<HTMLElement>();
      let scheduled = false;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches(FILE_SELECTOR)) queued.add(node);
            node.querySelectorAll<HTMLElement>(FILE_SELECTOR).forEach((el) => queued.add(el));
            // Header/toggle may render after the container itself.
            const owner = node.closest<HTMLElement>(FILE_SELECTOR);
            if (owner) queued.add(owner);
          }
        }
        if (queued.size && !scheduled) {
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            const batch = [...queued];
            queued = new Set();
            cb(batch);
          });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
  };
}
