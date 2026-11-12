import type { FunctionLocation, MovedFunction } from '../../moves/detect';
import { dedent, diffLines, type DiffOp } from '../../moves/line-diff';
import { COLORS } from '../../core/ui/colors';
import { highlight, type HlSpan } from '../../lang/highlight';
import type { Registry } from '../../lang/registry';
import { diffViewMode } from '../../github/view';

/**
 * Side panel listing moved functions, plus a modal comparing a function's old
 * and new versions. Rendered in a shadow root; colors come from GitHub's Primer
 * CSS variables (which inherit into shadow DOM) so light/dark themes just work.
 * All repo content is inserted with textContent, never as HTML.
 */
const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel, .modal { font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--fgColor-default, #1f2328); background: var(--bgColor-default, #fff);
    border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,.2); }
  .panel { position: fixed; right: 16px; bottom: 64px; z-index: 2147483000; width: min(440px, calc(100vw - 32px));
    max-height: 60vh; overflow: auto; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px; border-bottom: 1px solid var(--borderColor-default, #d1d9e0);
    position: sticky; top: 0; background: inherit; font-weight: 600; border-radius: 12px 12px 0 0; }
  .item { padding: 10px 12px; border-bottom: 1px solid var(--borderColor-muted, #d1d9e0b3); }
  .item:last-child { border-bottom: 0; }
  .title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
  code, pre { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .badge { font-size: 11px; font-weight: 600; padding: 0 7px; border-radius: 10px; color: #fff; }
  .badge.moved { background: ${COLORS.moved}; }
  .badge.moved-modified { background: ${COLORS.movedModified}; }
  .muted { color: var(--fgColor-muted, #59636e); }
  .loc { display: flex; gap: 6px; align-items: baseline; }
  .loc .k { width: 34px; flex: none; }
  button { all: unset; cursor: pointer; }
  .link { color: var(--fgColor-accent, #0969da); overflow-wrap: anywhere; }
  .link:hover { text-decoration: underline; }
  .btn { margin-top: 6px; padding: 2px 10px; border-radius: 6px; font-size: 12px;
    border: 1px solid var(--borderColor-default, #d1d9e0); }
  .btn:hover { background: var(--bgColor-muted, #f6f8fa); }
  .x { padding: 0 6px; font-size: 16px; line-height: 1; }
  .backdrop { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.4);
    display: flex; align-items: center; justify-content: center; padding: 16px; }
  .modal { width: 100%; max-width: 1800px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
  .modal header { position: static; flex: none; }
  .modal .body { overflow: auto; padding: 0; }
  table.cmp { width: max-content; min-width: 100%; border-collapse: collapse; margin: 6px 0;
    font: 12px/20px ui-monospace, SFMono-Regular, Menlo, monospace; }
  table.cmp td { vertical-align: top; padding: 0 8px; }
  table.cmp td.num { width: 1%; white-space: nowrap; text-align: right; color: var(--fgColor-muted, #59636e); user-select: none; }
  table.unified td.num + td.num { border-right: 1px solid var(--borderColor-muted, #d1d9e0b3); }
  table.cmp td.code { white-space: pre; }
  table.split td.code { width: 50%; }
  table.split td.code:nth-child(2) { border-right: 1px solid var(--borderColor-default, #d1d9e0); }
  table.unified td.code::before { content: attr(data-marker); display: inline-block; width: 14px; color: var(--fgColor-muted, #59636e); }
  table.cmp td.add:not(.empty) { background: var(--diffBlob-additionLine-bgColor, rgba(46, 160, 67, 0.18)); }
  table.cmp td.del:not(.empty) { background: var(--diffBlob-deletionLine-bgColor, rgba(248, 81, 73, 0.18)); }
  table.cmp td.empty { background: var(--bgColor-muted, rgba(127, 127, 127, 0.08)); }
  .pl-k { color: var(--color-prettylights-syntax-keyword, #cf222e); }
  .pl-s { color: var(--color-prettylights-syntax-string, #0a3069); }
  .pl-c { color: var(--color-prettylights-syntax-comment, #59636e); }
  .pl-c1 { color: var(--color-prettylights-syntax-constant, #0550ae); }
  .pl-en { color: var(--color-prettylights-syntax-entity, #6639ba); }
  .pl-v { color: var(--color-prettylights-syntax-variable, #953800); }
  .note { padding: 8px 12px; border-bottom: 1px solid var(--borderColor-muted, #d1d9e0b3); }
`;

export interface PanelHandlers {
  goTo(loc: FunctionLocation, side: 'left' | 'right'): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class MovesPanel {
  private host = document.createElement('pr-review-helper-moves');
  private root = this.host.attachShadow({ mode: 'open' });
  private panel: HTMLElement | null = null;

  constructor(
    private moves: MovedFunction[],
    private handlers: PanelHandlers,
    private registry: Registry,
  ) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.root.append(style);
    document.body.append(this.host);
  }

  toggle() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    } else this.panel = this.root.appendChild(this.renderPanel());
  }

  destroy() {
    this.host.remove();
  }

  private renderPanel(): HTMLElement {
    const panel = el('div', 'panel');
    const header = el('header');
    header.append(el('span', '', `Moved code (${this.moves.length})`));
    const close = el('button', 'x', '✕');
    close.title = 'Close';
    close.addEventListener('click', () => this.toggle());
    header.append(close);
    panel.append(header);

    for (const m of this.moves) {
      const item = el('div', 'item');
      const title = el('div', 'title');
      title.append(el('code', '', m.defKind === 'class' ? `class ${m.to.qualname}` : m.to.qualname));
      title.append(el('span', `badge ${m.kind}`, m.kind === 'moved' ? 'moved' : `modified · ${Math.round(m.similarity * 100)}%`));
      if (m.renamed) title.append(el('span', 'muted', `was ${m.from.qualname}`));
      item.append(title);
      item.append(this.locRow('from', m.from, 'left'), this.locRow('to', m.to, 'right'));
      // Nothing to compare when the text is identical (apart from indentation).
      const ops = diffLines(dedent(m.from.text), dedent(m.to.text));
      if (ops.some((op) => op.kind !== ' ')) {
        const compare = el('button', 'btn', 'Compare');
        compare.addEventListener('click', () => this.openCompare(m, ops));
        item.append(compare);
      }
      panel.append(item);
    }
    return panel;
  }

  private locRow(label: string, loc: FunctionLocation, side: 'left' | 'right'): HTMLElement {
    const row = el('div', 'loc');
    row.append(el('span', 'k muted', label));
    const link = el('button', 'link', `${loc.path}:${loc.startLine}`);
    link.title = 'Jump to this location in the diff';
    link.addEventListener('click', () => this.handlers.goTo(loc, side));
    row.append(link);
    return row;
  }

  private openCompare(m: MovedFunction, ops: DiffOp[]) {
    const backdrop = el('div', 'backdrop');
    const modal = el('div', 'modal');
    const header = el('header');
    const heading = el('span');
    heading.append(el('code', '', m.from.qualname), document.createTextNode(' → '), el('code', '', m.to.qualname));
    header.append(heading);
    const close = el('button', 'x', '✕');
    header.append(close);

    const body = el('div', 'body');
    if (m.kind === 'moved') body.append(el('div', 'note muted', 'Only names, comments or formatting differ; the logic is unchanged.'));
    const lang = this.registry.byId(m.lang);
    const plain = (text: string) => text.split('\n').map((t) => (t ? [{ text: t }] : []));
    const hl: Highlights = {
      old: lang ? highlight(dedent(m.from.text).split('\n'), lang) : plain(dedent(m.from.text)),
      new: lang ? highlight(dedent(m.to.text).split('\n'), lang) : plain(dedent(m.to.text)),
    };
    body.append(
      diffViewMode() === 'split' ? renderSplit(ops, m.from.startLine, m.to.startLine, hl) : renderUnified(ops, m.from.startLine, m.to.startLine, hl),
    );
    modal.append(header, body);
    backdrop.append(modal);

    const dismiss = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
      }
    };
    close.addEventListener('click', dismiss);
    backdrop.addEventListener('click', (e) => e.target === backdrop && dismiss());
    document.addEventListener('keydown', onKey, true);
    this.root.append(backdrop);
  }
}

const kindClass = (k: DiffOp['kind']) => (k === '+' ? 'add' : k === '-' ? 'del' : 'ctx');

function numCell(n: number | undefined, kind: string) {
  return el('td', `num ${kind}`, n === undefined ? '' : String(n));
}
/** Highlighted lines per side, indexed by line offset from the function start. */
interface Highlights {
  old: HlSpan[][];
  new: HlSpan[][];
}

function codeCell(text: string | undefined, kind: string, spans?: HlSpan[]) {
  const td = el('td', `code ${kind}`);
  if (text === undefined) td.classList.add('empty');
  else if (spans) td.append(...spans.map((s) => (s.cls ? el('span', `pl-${s.cls}`, s.text) : document.createTextNode(s.text))));
  else td.textContent = text;
  return td;
}

function renderUnified(ops: DiffOp[], oldStart: number, newStart: number, hl: Highlights): HTMLElement {
  const table = el('table', 'cmp unified');
  let o = oldStart;
  let n = newStart;
  for (const op of ops) {
    const k = kindClass(op.kind);
    const tr = el('tr');
    const spans = op.kind === '-' ? hl.old[o - oldStart] : hl.new[n - newStart];
    tr.append(numCell(op.kind !== '+' ? o++ : undefined, k), numCell(op.kind !== '-' ? n++ : undefined, k));
    const code = codeCell(op.text, k, spans);
    code.dataset.marker = op.kind;
    tr.append(code);
    table.append(tr);
  }
  return table;
}

function renderSplit(ops: DiffOp[], oldStart: number, newStart: number, hl: Highlights): HTMLElement {
  const table = el('table', 'cmp split');
  let o = oldStart;
  let n = newStart;
  let dels: string[] = [];
  let adds: string[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      const tr = el('tr');
      const d = dels[i];
      const a = adds[i];
      tr.append(codeCell(d, 'del', hl.old[o - oldStart]), codeCell(a, 'add', hl.new[n - newStart]));
      tr.prepend(numCell(d !== undefined ? o++ : undefined, 'del'));
      tr.insertBefore(numCell(a !== undefined ? n++ : undefined, 'add'), tr.lastChild);
      table.append(tr);
    }
    dels = [];
    adds = [];
  };
  for (const op of ops) {
    if (op.kind === '-') dels.push(op.text);
    else if (op.kind === '+') adds.push(op.text);
    else {
      flush();
      const tr = el('tr');
      tr.append(codeCell(op.text, 'ctx', hl.old[o - oldStart]), codeCell(op.text, 'ctx', hl.new[n - newStart]));
      tr.prepend(numCell(o++, 'ctx'));
      tr.insertBefore(numCell(n++, 'ctx'), tr.lastChild);
      table.append(tr);
    }
  }
  flush();
  return table;
}
