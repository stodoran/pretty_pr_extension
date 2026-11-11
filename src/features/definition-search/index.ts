import { COLORS } from '../../core/ui/colors';
import type { Feature } from '../../core/feature';
import { isFilesTab } from '../../github/pr';
import { definitionTerms, enclosingDefinitions, repoSearchUrl, type DiffRow } from './terms';

/**
 * Hovering any line of a Python function or class in the diff shows a small
 * "search" pill on that definition's `def`/`class` line (and on the lines of
 * the definitions enclosing it); on an import line, pills for the imported
 * names appear on that line. Each opens GitHub code search for the name in the
 * repo. GitHub code search only indexes the default branch, so that's what is
 * searched regardless of diff side.
 *
 * The pills live in an absolutely positioned overlay in our own shadow root (nothing
 * is inserted into GitHub's React-managed cells).
 */
const PYTHON = /\.pyi?$/;

/** The code itself, without GitHub's leading "+"/"-" diff marker. */
const codeOf = (cell: HTMLElement): HTMLElement => cell.querySelector<HTMLElement>('.diff-text-inner') ?? cell;
const IMPORT_LINE = /^\s*(?:from|import)\s/;

/** A row to put pills on: a definition's line (or hunk header), with the names to search. */
interface Anchor {
  el: HTMLElement;
  names: string[];
}

/** The file's rendered rows on the hovered cell's side (with their cells), plus where that cell sits among them. */
function rowsAround(region: HTMLElement, cell: HTMLElement) {
  const side = cell.dataset.diffSide;
  const rows: DiffRow[] = [];
  const cells: HTMLElement[] = [];
  let index = -1;
  const sel = `td.diff-hunk-cell, td.diff-text-cell[data-diff-side="${side}"]`;
  for (const td of region.querySelectorAll<HTMLElement>(sel)) {
    if (td.classList.contains('diff-hunk-cell')) rows.push({ kind: 'hunk', text: (td.textContent ?? '').trim() });
    else {
      if (td === cell) index = rows.length;
      rows.push({ kind: 'code', line: Number(td.dataset.lineNumber), text: codeOf(td).textContent ?? '' });
    }
    cells.push(td);
  }
  return { rows, cells, index };
}

const STYLE = `
  :host { all: initial; }
  .bar { position: absolute; z-index: 2147482000; display: flex; gap: 4px; }
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
    root.append(style);
    document.body.append(host);
    signal.addEventListener('abort', () => host.remove(), { once: true });

    let currentCell: HTMLElement | null = null;
    let current: Anchor[] = [];
    let bars: { anchor: Anchor; bar: HTMLElement }[] = [];

    const hide = () => {
      for (const b of bars) b.bar.remove();
      bars = [];
      current = [];
      currentCell = null;
    };

    const pill = (term: string) => {
      const btn = document.createElement('button');
      btn.innerHTML = ICON; // constant markup; the term itself is set as text below
      btn.append(document.createTextNode(term));
      btn.title = `Search ${page.owner}/${page.repo} (default branch) for “${term}”`;
      btn.addEventListener('click', () => window.open(repoSearchUrl(page.owner, page.repo, term), '_blank', 'noopener'));
      return btn;
    };

    /** Right after the end of the anchor row's text, vertically centered on it, staying inside the cell. */
    const place = ({ anchor, bar }: { anchor: Anchor; bar: HTMLElement }) => {
      const cellRect = anchor.el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(anchor.el.classList.contains('diff-text-cell') ? codeOf(anchor.el) : anchor.el);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width && r.height);
      const textRight = Math.max(cellRect.left, ...rects.map((r) => r.right));
      const left = Math.min(textRight + 10, cellRect.right - bar.offsetWidth - 8);
      // Document coordinates, so the browser scrolls the pills with the page (no JS lag).
      bar.style.left = `${Math.max(cellRect.left, left) + window.scrollX}px`;
      const mid = rects[0] ? rects[0].top + rects[0].height / 2 : cellRect.top + cellRect.height / 2;
      bar.style.top = `${Math.round(mid - bar.offsetHeight / 2 + window.scrollY)}px`;
    };

    const show = (anchors: Anchor[]) => {
      const same =
        anchors.length === current.length &&
        anchors.every((a, i) => a.el === current[i]!.el && a.names.join() === current[i]!.names.join());
      if (same) return;
      hide();
      current = anchors;
      bars = anchors.map((anchor) => {
        const bar = document.createElement('div');
        bar.className = 'bar on';
        bar.append(...anchor.names.map(pill));
        root.append(bar);
        return { anchor, bar };
      });
      bars.forEach(place);
    };

    // Not cached: expanding hidden lines changes which definitions are visible.
    const anchorsFor = (cell: HTMLElement): Anchor[] => {
      const region = dom.fileElementOf(cell);
      const path = region && dom.filePath(region);
      if (!region || !path || !PYTHON.test(path)) return [];
      const text = codeOf(cell).textContent ?? '';
      if (IMPORT_LINE.test(text)) {
        const names = definitionTerms(text);
        return names.length ? [{ el: cell, names }] : [];
      }
      const { rows, cells, index } = rowsAround(region, cell);
      if (index < 0) return [];
      return enclosingDefinitions(rows, index).map((d) => ({ el: cells[d.row]!, names: [d.name] }));
    };

    document.addEventListener(
      'mousemove',
      (e) => {
        const target = e.target as Element | null;
        if (target === host) return; // over the pills
        const cell = target?.closest?.<HTMLElement>('td.diff-text-cell');
        if (!cell) {
          // Line numbers, gutters etc. of the same file keep the pills; anywhere else hides them.
          if (!currentCell || !target?.closest?.('tr.diff-line-row')) hide();
          return;
        }
        if (cell === currentCell) return;
        if (currentCell && !(codeOf(cell).textContent ?? '').trim()) return; // blank lines keep what's shown
        const anchors = anchorsFor(cell);
        if (anchors.length) {
          show(anchors);
          currentCell = cell;
        } else hide();
      },
      { passive: true, signal },
    );
    // Page scrolling moves the pills natively; this only catches layout shifts
    // (e.g. virtualized files rendering above) and inner scroll containers.
    let frame = 0;
    const reposition = () => {
      if (frame || !bars.length) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        bars = bars.filter((b) => (b.anchor.el.isConnected ? true : (b.bar.remove(), false)));
        bars.forEach(place);
      });
    };
    window.addEventListener('scroll', reposition, { passive: true, capture: true, signal });
  },
};
