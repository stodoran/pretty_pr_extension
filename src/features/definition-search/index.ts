import { COLORS } from '../../core/ui/colors';
import type { Feature } from '../../core/feature';
import { isFilesTab } from '../../github/pr';
import { definitionTerms, repoSearchUrl } from './terms';

/**
 * Hovering a Python definition line (def / class / import) in the diff shows
 * small "search" pills right after the code; each opens GitHub code search for
 * that name in the repo. GitHub code search only indexes the default branch,
 * so that's what is searched regardless of diff side.
 *
 * The pills live in a fixed-position overlay in our own shadow root (nothing
 * is inserted into GitHub's React-managed cells).
 */
const PYTHON = /\.pyi?$/;

/** The code itself, without GitHub's leading "+"/"-" diff marker. */
const codeOf = (cell: HTMLElement): HTMLElement => cell.querySelector<HTMLElement>('.diff-text-inner') ?? cell;

const STYLE = `
  :host { all: initial; }
  .bar { position: fixed; z-index: 2147482000; display: none; gap: 4px; }
  .bar.on { display: flex; }
  button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
    padding: 0 7px; height: 18px; border-radius: 9px;
    font: 600 11px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--fgColor-default, #1f2328); background: var(--bgColor-default, #fff);
    border: 1px solid var(--borderColor-default, #d1d9e0); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  button:hover { color: #fff; background: ${COLORS.search}; border-color: ${COLORS.search}; }
  svg { width: 11px; height: 11px; fill: currentColor; }
`;
const ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.68 11.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06ZM11.5 7a4.5 4.5 0 1 0-9 0 4.5 4.5 0 0 0 9 0Z"/></svg>';

export const definitionSearch: Feature = {
  id: 'definitionSearch',
  appliesTo: isFilesTab,

  async run({ page, dom, signal }) {
    const host = document.createElement('pretty-pr-review-search');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const bar = document.createElement('div');
    bar.className = 'bar';
    root.append(style, bar);
    document.body.append(host);
    signal.addEventListener('abort', () => host.remove(), { once: true });

    const termsCache = new WeakMap<HTMLElement, string[]>();
    let currentCell: HTMLElement | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const hide = () => {
      clearTimeout(hideTimer);
      bar.classList.remove('on');
      currentCell = null;
    };

    const show = (cell: HTMLElement, terms: string[]) => {
      clearTimeout(hideTimer);
      currentCell = cell;
      bar.replaceChildren(
        ...terms.map((term) => {
          const btn = document.createElement('button');
          btn.innerHTML = ICON; // constant markup; the term itself is set as text below
          btn.append(document.createTextNode(term));
          btn.title = `Search ${page.owner}/${page.repo} (default branch) for “${term}”`;
          btn.addEventListener('click', () => window.open(repoSearchUrl(page.owner, page.repo, term), '_blank', 'noopener'));
          return btn;
        }),
      );
      bar.classList.add('on');
      // Place right after the end of the code text, staying inside the cell.
      const cellRect = cell.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(codeOf(cell));
      const textRight = Math.max(cellRect.left, ...Array.from(range.getClientRects(), (r) => (r.width ? r.right : 0)));
      const left = Math.min(textRight + 10, cellRect.right - bar.offsetWidth - 8);
      bar.style.left = `${Math.max(cellRect.left, left)}px`;
      // Center on the first line of code (not the cell, which may have padding or wrapped lines).
      const line = Array.from(range.getClientRects()).find((r) => r.width && r.height);
      const mid = line ? line.top + line.height / 2 : cellRect.top + cellRect.height / 2;
      bar.style.top = `${Math.round(mid - bar.offsetHeight / 2)}px`;
    };

    const termsFor = (cell: HTMLElement): string[] => {
      let terms = termsCache.get(cell);
      if (!terms) {
        const region = dom.fileElementOf(cell);
        const path = region && dom.filePath(region);
        terms = path && PYTHON.test(path) ? definitionTerms(codeOf(cell).textContent ?? '') : [];
        termsCache.set(cell, terms);
      }
      return terms;
    };

    document.addEventListener(
      'mousemove',
      (e) => {
        if (e.target === host) return clearTimeout(hideTimer); // over the pills
        const cell = (e.target as Element | null)?.closest?.<HTMLElement>('td.diff-text-cell');
        if (cell === currentCell) return;
        const terms = cell ? termsFor(cell) : [];
        if (cell && terms.length) show(cell, terms);
        else {
          clearTimeout(hideTimer);
          hideTimer = setTimeout(hide, 150); // grace period to move onto the pills
        }
      },
      { passive: true, signal },
    );
    window.addEventListener('scroll', hide, { passive: true, capture: true, signal });
  },
};
