import { COLORS } from '../../core/ui/colors';
import type { Feature } from '../../core/feature';
import { call } from '../../core/messaging';
import { diffAnchorId, type DiffDomAdapter } from '../../github/dom/adapter';
import { isFilesTab } from '../../github/pr';
import type { FunctionLocation, MovedFunction } from '../../moves/detect';
import { MovesPanel } from './panel';
import { injectMoveStyles, isOverLabel } from './styles';

/**
 * Marks Python functions that moved (possibly renamed/modified) in the diff:
 * a colored gutter on the moved lines, a "moved to/from" label on the first
 * line, dimming for unchanged moves, and a panel listing all moves with
 * jump links and a function-level compare view.
 *
 * Analysis runs in the background worker (it fetches the full diff, so it
 * isn't limited to files GitHub has rendered). Decorations are data-attributes
 * styled by an injected stylesheet, so React re-renders don't fight us; they
 * are re-applied whenever GitHub renders more rows.
 */
export const movedCode: Feature = {
  id: 'movedCode',
  appliesTo: isFilesTab,

  async run({ page, settings, dom, status, signal, reportError }) {
    status.set({ text: '🔀 Looking for moved code…' });
    const result = await call('analyzeMoves', {
      owner: page.owner,
      repo: page.repo,
      number: page.number,
      headOid: readHeadOid(),
    });
    if (signal.aborted) return;
    console.info(
      `[Pretty PR Review] moved-code: ${result.moves.length} move(s) across ${result.analyzedFiles} Python file(s), ${result.skipped.length} skipped`,
    );

    const skippedNote = result.skipped.length ? ` · ${result.skipped.length} file(s) not analysed` : '';
    if (!result.moves.length) {
      if (skippedNote) {
        status.set({ text: `🔀 No moved code${skippedNote}`, tone: 'info', actions: [skippedAction(result.skipped)] });
      } else status.clear();
      return;
    }

    const removeStyles = injectMoveStyles();
    const marks = await buildMarks(result.moves, settings.features.movedCode.dimUnchanged);
    const apply = (els: HTMLElement[]) => {
      for (const el of els) for (const m of marks.get(el.id) ?? []) applyMark(dom, el, m);
    };
    const unsubscribe = dom.observeFiles(apply);
    apply(dom.fileElements());
    const jump = (loc: FunctionLocation, side: 'left' | 'right') => void goTo(dom, loc, side).catch(reportError);
    watchLabelClicks(result.moves, jump, signal);

    const panel = new MovesPanel(result.moves, { goTo: jump });
    signal.addEventListener(
      'abort',
      () => {
        unsubscribe();
        removeStyles();
        panel.destroy();
      },
      { once: true },
    );

    const modified = result.moves.filter((m) => m.kind === 'moved-modified').length;
    const classes = result.moves.filter((m) => m.defKind === 'class').length;
    const fns = result.moves.length - classes;
    const counts = [
      fns ? `${fns} moved function${fns === 1 ? '' : 's'}` : '',
      classes ? `${classes} moved class${classes === 1 ? '' : 'es'}` : '',
    ].filter(Boolean);
    status.set({
      text: `🔀 ${counts.join(', ')}${modified ? ` (${modified} modified)` : ''}${skippedNote}`,
      actions: [
        { label: 'Show', onClick: () => panel.toggle() },
        ...(result.skipped.length ? [skippedAction(result.skipped)] : []),
      ],
    });
  },
};

function skippedAction(skipped: { path: string; reason: string }[]) {
  return {
    label: 'Why?',
    onClick: () => console.info('[Pretty PR Review] files not analysed for moves:', skipped),
  };
}

/** The page embeds PR data as JSON; the head commit lets the worker fetch exact file versions. */
function readHeadOid(): string | null {
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const m = /"headOid":"([0-9a-f]{40})"/.exec(script.textContent ?? '');
    if (m) return m[1]!;
  }
  return null;
}

interface Mark {
  moveId: string;
  side: 'left' | 'right';
  start: number;
  end: number;
  kind: MovedFunction['kind'];
  label: string;
  dim: boolean;
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

async function buildMarks(moves: MovedFunction[], dimUnchanged: boolean): Promise<Map<string, Mark[]>> {
  const byRegion = new Map<string, Mark[]>();
  const add = async (path: string, mark: Mark) => {
    const id = await diffAnchorId(path);
    byRegion.set(id, [...(byRegion.get(id) ?? []), mark]);
  };
  for (const m of moves) {
    const sameFile = m.from.displayPath === m.to.displayPath;
    const pct = m.kind === 'moved-modified' ? ` · ${Math.round(m.similarity * 100)}% similar` : '';
    const dim = dimUnchanged && m.kind === 'moved';
    const where = (loc: FunctionLocation) => (sameFile ? `line ${loc.startLine}` : `${basename(loc.path)}:${loc.startLine}`);
    const wasNamed = m.renamed ? ` (was ${m.from.qualname})` : '';
    await add(m.from.displayPath, {
      moveId: m.id,
      side: 'left',
      start: m.from.startLine,
      end: m.from.endLine,
      kind: m.kind,
      label: `↗ moved to ${where(m.to)}${pct}`,
      dim,
    });
    await add(m.to.displayPath, {
      moveId: m.id,
      side: 'right',
      start: m.to.startLine,
      end: m.to.endLine,
      kind: m.kind,
      label: `↙ moved from ${where(m.from)}${wasNamed}${pct}`,
      dim,
    });
  }
  return byRegion;
}

function applyMark(dom: DiffDomAdapter, fileEl: HTMLElement, m: Mark) {
  for (let line = m.start; line <= m.end; line++) {
    for (const cell of dom.lineCells(fileEl, m.side, line)) {
      cell.dataset.prhMove = m.kind;
      if (m.dim) cell.dataset.prhDim = '';
      if (line === m.start) {
        cell.dataset.prhLabel = m.label;
        cell.dataset.prhMoveId = m.moveId;
        cell.dataset.prhMoveSide = m.side;
      }
    }
  }
}

/** Clicking a "moved to/from" label jumps to the label on the other end of the move. */
function watchLabelClicks(moves: MovedFunction[], jump: (loc: FunctionLocation, side: 'left' | 'right') => void, signal: AbortSignal) {
  const byId = new Map(moves.map((m) => [m.id, m]));
  const labelCellAt = (e: MouseEvent) => {
    const cell = (e.target as Element | null)?.closest?.<HTMLElement>('td[data-prh-label]');
    return cell && isOverLabel(cell, e.clientX, e.clientY) ? cell : null;
  };
  let hovered: HTMLElement | null = null;
  document.addEventListener(
    'mousemove',
    (e) => {
      const cell = labelCellAt(e);
      if (cell === hovered) return;
      hovered?.removeAttribute('data-prh-label-hover');
      cell?.setAttribute('data-prh-label-hover', '');
      hovered = cell;
    },
    { passive: true, signal },
  );
  // Capture phase on document runs before GitHub's (React root) handlers, so line selection doesn't kick in.
  const intercept = (e: MouseEvent) => {
    const cell = labelCellAt(e);
    if (!cell) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== 'click') return;
    const move = byId.get(cell.dataset.prhMoveId ?? '');
    if (!move) return;
    if (cell.dataset.prhMoveSide === 'left') jump(move.to, 'right');
    else jump(move.from, 'left');
  };
  for (const type of ['mousedown', 'click'] as const) document.addEventListener(type, intercept, { capture: true, signal });
}

/**
 * Scrolls a move's other end into view. GitHub's diff list is virtualized:
 * files not yet rendered use estimated heights, so after a long jump the files
 * in between render at their real size and the target drifts. So: scroll, let
 * GitHub render, and repeat until the target line stops moving. (We don't
 * check for an exact "centered" position: GitHub's sticky-header scroll padding
 * shifts where the browser puts "center".)
 */
async function goTo(dom: DiffDomAdapter, loc: FunctionLocation, side: 'left' | 'right') {
  const id = await diffAnchorId(loc.displayPath);
  // Not rendered at all yet: let GitHub scroll to and render the file first.
  if (!document.getElementById(id)) location.hash = id;

  const find = () => {
    const region = document.getElementById(id);
    return { region, cell: region ? dom.lineCells(region, side, loc.startLine).at(-1) : undefined };
  };
  const deadline = Date.now() + 3000;
  let lastTop: number | null = null;
  let still = 0;
  let cell: HTMLElement | undefined;
  while (Date.now() < deadline) {
    const found = find();
    cell = found.cell;
    const target = cell ?? found.region;
    if (target) {
      const top = target.getBoundingClientRect().top;
      if (cell && lastTop !== null && Math.abs(top - lastTop) < 2) {
        if (++still >= 2) break; // stable across two render cycles
      } else {
        still = 0;
        target.scrollIntoView({ block: cell ? 'center' : 'start', behavior: 'instant' });
      }
      lastTop = cell ? target.getBoundingClientRect().top : null;
    }
    await new Promise((r) => setTimeout(r, 100)); // let GitHub render what scrolled into view
  }
  cell?.closest('tr')?.animate(
    [{ outline: `2px solid ${COLORS.moved}`, outlineOffset: '-2px' }, { outline: '2px solid transparent', outlineOffset: '-2px' }],
    { duration: 1600 },
  );
}
