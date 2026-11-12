import { startAutoViewer, type AutoViewer } from '../../core/auto-viewer';
import type { Feature } from '../../core/feature';
import { call } from '../../core/messaging';
import { createTestFileMatcher, neverAutoView } from '../../core/test-files';
import { COLORS, FORMAT_FADE_VAR } from '../../core/ui/colors';
import { diffAnchorId } from '../../github/dom/adapter';
import { isFilesTab, prKey } from '../../github/pr';
import type { FileFormatting } from '../../formatting/classify';

/**
 * Formatting-only changes (whitespace, wrapping, quotes, trailing commas,
 * reordered imports) and comment-only changes are dimmed. Hovering one highlights its
 * whole block and labels what kind of formatting it is. Files whose every
 * change is formatting can be marked as viewed, tagged "format".
 *
 * Analysis runs in the background worker on the full PR diff; the page only
 * gets data-attributes, styled by an injected stylesheet.
 */
/** Comment changes inside a moved function: the move is what matters there, so they aren't marked. */
const ON = ':not([data-prh-move][data-prh-format-kind="comment"])';

const CSS = `
td[data-prh-format-block] {
  --prh-format-color: ${COLORS.formatting};
  /* The page background laid over GitHub's red/green, so the line reads almost like an unchanged one. */
  --prh-format-fade: linear-gradient(color-mix(in srgb, var(--bgColor-default, #fff) var(${FORMAT_FADE_VAR}, 75%), transparent), color-mix(in srgb, var(--bgColor-default, #fff) var(${FORMAT_FADE_VAR}, 75%), transparent));
  --prh-format-tint: linear-gradient(color-mix(in srgb, var(--prh-format-color) 10%, transparent), color-mix(in srgb, var(--prh-format-color) 10%, transparent));
}
td[data-prh-format-dim]${ON} { background-image: var(--prh-format-fade); }
td.diff-text-cell[data-prh-format-dim]${ON} .diff-text-inner { opacity: 0.6; }
td.diff-text-cell[data-prh-format-hover]${ON} .diff-text-inner { opacity: 0.9; }
td.new-diff-line-number[data-prh-format-hover]${ON}, td.diff-text-cell[data-prh-format-hover]${ON} {
  background-image: var(--prh-format-tint);
}
td.new-diff-line-number[data-prh-format-hover][data-prh-format-dim]${ON}, td.diff-text-cell[data-prh-format-hover][data-prh-format-dim]${ON} {
  background-image: var(--prh-format-tint), var(--prh-format-fade);
}
td.diff-text-cell[data-prh-format-label]:not([data-prh-label]) { position: relative; }
td.diff-text-cell[data-prh-format-hover][data-prh-format-label]:not([data-prh-label])${ON}::after {
  content: attr(data-prh-format-label);
  position: absolute; top: 50%; transform: translateY(-50%); right: 36px; z-index: 2; /* clear of GitHub's line-hover menu */
  padding: 0 8px; border-radius: 10px;
  font: 600 11px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #fff; background: var(--prh-format-color);
  white-space: nowrap; pointer-events: none;
}
`;

export const formatting: Feature = {
  id: 'formatting',
  appliesTo: isFilesTab,

  async run({ page, settings, dom, status, signal, reportError }) {
    const opts = settings.features.formatting;
    const { files } = await call('analyzeFormatting', { owner: page.owner, repo: page.repo, number: page.number });
    if (signal.aborted || !files.some((f) => f.whole || f.left.length || f.right.length)) return;

    const byRegion = new Map<string, FileFormatting>();
    for (const f of files) byRegion.set(await diffAnchorId(f.path), f);
    // Per file: "side:line" → block key, and the cell that carries each block's label.
    type Info = { block: string; kind: string; label?: string };
    const cellInfo = new Map<FileFormatting, Map<string, Info>>();
    files.forEach((f, fi) => {
      const m = new Map<string, Info>();
      f.blocks.forEach((b, bi) => {
        const block = `${fi}:${bi}`;
        for (const line of b.left) m.set(`left:${line}`, { block, kind: b.kind });
        for (const line of b.right) m.set(`right:${line}`, { block, kind: b.kind });
        const at = b.right.length ? `right:${b.right[0]}` : `left:${b.left[0]}`;
        m.set(at, { block, kind: b.kind, label: b.reason });
      });
      cellInfo.set(f, m);
    });

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    const apply = (els: HTMLElement[]) => {
      for (const el of els) {
        const f = byRegion.get(el.id);
        if (!f) continue;
        const info = cellInfo.get(f)!;
        for (const cell of el.querySelectorAll<HTMLElement>('td[data-diff-side][data-line-number]')) {
          const hit = info.get(`${cell.dataset.diffSide}:${cell.dataset.lineNumber}`);
          if (!hit) continue;
          cell.dataset.prhFormatBlock = hit.block;
          cell.dataset.prhFormatKind = hit.kind;
          if (opts.dimLines) cell.dataset.prhFormatDim = '';
          if (hit.label && cell.classList.contains('diff-text-cell')) cell.dataset.prhFormatLabel = hit.label;
          if (hit.block === hovered) cell.dataset.prhFormatHover = '';
        }
      }
    };
    // Hovering any line of a block highlights the block and shows its label.
    let hovered: string | null = null;
    const setHover = (block: string | null, root: ParentNode = document) => {
      if (block === hovered) return;
      for (const c of document.querySelectorAll<HTMLElement>('td[data-prh-format-hover]')) delete c.dataset.prhFormatHover;
      hovered = block;
      if (block) for (const c of root.querySelectorAll<HTMLElement>(`td[data-prh-format-block="${block}"]`)) c.dataset.prhFormatHover = '';
    };
    document.addEventListener(
      'mouseover',
      (e) => {
        let cell = (e.target as Element | null)?.closest?.<HTMLElement>('td[data-prh-format-block]');
        if (cell && !cell.matches(ON)) cell = null;
        setHover(cell?.dataset.prhFormatBlock ?? null, (cell && dom.fileElementOf(cell)) ?? document);
      },
      { passive: true, signal },
    );

    const unsubscribe = dom.observeFiles(apply);
    apply(dom.fileElements());
    signal.addEventListener(
      'abort',
      () => {
        unsubscribe();
        style.remove();
      },
      { once: true },
    );

    const lines = files.reduce((n, f) => n + f.left.length + f.right.length, 0);
    const whole = files.filter((f) => f.whole);
    const plural = (n: number, s = 's') => (n === 1 ? '' : s);
    const shown = files.filter((f) => f.left.length + f.right.length).length;
    const summary = lines
      ? `${lines} formatting/comment-only line${plural(lines)} in ${shown} file${plural(shown)}` +
        (whole.length ? ` (${whole.length} entirely)` : '')
      : `${whole.length} file${plural(whole.length)} with only blank-line changes`;

    let viewer: AutoViewer | null = null;
    const show = () => {
      const s = viewer?.summary();
      status.set({ text: `🧹 ${[summary, ...(s?.parts ?? [])].join(' · ')}`, actions: s?.actions ?? [] });
    };
    if (opts.autoViewFiles && whole.length) {
      // Test/docs files are the other auto-viewer's job (and keep its "auto" tag).
      const isTest = settings.features.autoViewTests.enabled
        ? createTestFileMatcher(settings.testPatterns, page.owner, page.repo)
        : () => ({ isTest: false });
      const candidates = new Set(whole.map((f) => f.path).filter((p) => !neverAutoView(p) && !isTest(p).isTest));
      if (candidates.size) {
        viewer = await startAutoViewer({
          dom,
          signal,
          reportError,
          prKey: prKey(page),
          memory: { userUnviewed: 'formatUserUnviewed', autoViewed: 'formatAutoViewed' },
          attr: 'data-prh-format-viewed',
          tag: 'format',
          color: COLORS.formatting,
          title: 'Only formatting changes; marked as viewed by Pretty PR Review',
          noun: 'formatting-only file',
          isCandidate: (path) => candidates.has(path),
          onChange: show,
        });
        if (signal.aborted) return;
      }
    }
    show();
  },
};
