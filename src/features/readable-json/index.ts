import type { Feature } from '../../core/feature';
import { call } from '../../core/messaging';
import { isFilesTab } from '../../github/pr';
import { diffViewMode } from '../../github/view';
import type { JsonHunk, JsonLine, ReadableJson } from '../../json/diff';

/**
 * Minified JSON files diff as one huge changed line (GitHub doesn't even
 * render them by default). For each modified one-line .json file, as it
 * scrolls into view, the worker formats both versions and diffs them; the
 * result replaces GitHub's diff in the file (split or unified, like the page),
 * with where in the document each change is. A button swaps back to GitHub's.
 * Needs no PR diff, so it also works when GitHub won't generate one.
 */

const PANEL = 'prh-json';
/** On the file body: which diff is showing, ours ('formatted') or GitHub's. */
const VIEW = 'data-prh-json-view';

const CSS = `
[${VIEW}="formatted"] > :not(.${PANEL}) { display: none !important; }
[${VIEW}="github"] > .${PANEL} { border-bottom: 1px solid var(--borderColor-default, #d1d9e0); }
[${VIEW}="github"] > .${PANEL} table { display: none; }
.${PANEL} { font: 12px/20px ui-monospace, SFMono-Regular, Menlo, monospace; }
.${PANEL}-bar { display: flex; gap: 8px; align-items: center; padding: 4px 12px; background: var(--bgColor-muted, #f6f8fa);
  font: 12px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--fgColor-muted, #59636e); }
.${PANEL}-bar b { color: var(--fgColor-default, #1f2328); font-weight: 600; }
.${PANEL}-bar .add { color: var(--fgColor-success, #1a7f37); } .${PANEL}-bar .del { color: var(--fgColor-danger, #d1242f); }
.${PANEL}-bar button { margin-left: auto; font: inherit; color: var(--fgColor-accent, #0969da); background: none; border: 0; cursor: pointer; padding: 0; }
.${PANEL}-bar button:hover { text-decoration: underline; }
.${PANEL} table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.${PANEL} td { padding: 0 8px; vertical-align: top; }
.${PANEL} col.num { width: 52px; }
.${PANEL} td.num { text-align: right; color: var(--fgColor-muted, #59636e); user-select: none; }
.${PANEL} td.code { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fgColor-default, #1f2328); }
.${PANEL} table.split td.code.old { border-right: 1px solid var(--borderColor-default, #d1d9e0); }
.${PANEL} td.add { background: var(--diffBlob-additionLine-bgColor, #dafbe1); }
.${PANEL} td.num.add { background: var(--diffBlob-additionNum-bgColor, #aceebb); }
.${PANEL} td.del { background: var(--diffBlob-deletionLine-bgColor, #ffebe9); }
.${PANEL} td.num.del { background: var(--diffBlob-deletionNum-bgColor, #ffcecb); }
.${PANEL} td.empty { background: var(--bgColor-muted, #f6f8fa); }
.${PANEL} td.add mark { background: var(--diffBlob-additionWord-bgColor, #aceebb); color: inherit; border-radius: 2px; }
.${PANEL} td.del mark { background: var(--diffBlob-deletionWord-bgColor, #ffcecb); color: inherit; border-radius: 2px; }
.${PANEL} tr.hunk td { background: var(--diffBlob-hunkLine-bgColor, #ddf4ff); color: var(--fgColor-muted, #59636e); }
`;

interface Comparison {
  baseOid: string;
  headOid: string;
  /** Paths of modified .json files that could be minified. */
  json: Set<string>;
}

/** The page embeds the PR's comparison (base/head commits, every changed file) as JSON. */
function readComparison(number: number): Comparison | null {
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent ?? '';
    if (!text.includes('"diffSummaries"')) continue;
    let route: Record<string, unknown> | undefined;
    const find = (o: unknown, depth: number): void => {
      if (route || !o || typeof o !== 'object' || depth > 6) return;
      if (Array.isArray((o as Record<string, unknown>).diffSummaries)) route = o as Record<string, unknown>;
      else for (const v of Object.values(o)) find(v, depth + 1);
    };
    try {
      find(JSON.parse(text), 0);
    } catch {
      continue;
    }
    const r = route as
      | { comparison?: { fullDiff?: { baseOid?: string; headOid?: string } }; pullRequest?: { number?: number }; diffSummaries: { path?: string; changeType?: string; linesAdded?: number; linesDeleted?: number }[] }
      | undefined;
    const base = r?.comparison?.fullDiff?.baseOid;
    const head = r?.comparison?.fullDiff?.headOid;
    if (!r || !base || !head) continue;
    // After in-page navigation the embedded data can belong to another PR.
    if (r.pullRequest?.number !== undefined && r.pullRequest.number !== number) continue;
    const json = new Set(
      r.diffSummaries
        // A minified file's change is one line out, one line in; anything else already diffs fine on GitHub.
        .filter((f) => f.changeType === 'MODIFIED' && f.path && /\.json$/i.test(f.path) && (f.linesAdded ?? 0) <= 1 && (f.linesDeleted ?? 0) <= 1)
        .map((f) => f.path!),
    );
    return { baseOid: base, headOid: head, json };
  }
  return null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

type Mode = 'split' | 'unified';
type Shown = Exclude<ReadableJson, { status: 'readable' | 'invalid' }>;

function codeCell(l: JsonLine | undefined, side: string, kind: string, sign = ''): HTMLTableCellElement {
  const td = el('td', { className: `code ${side} ${l ? kind : 'empty'}` });
  if (!l) return td;
  if (l.mark) {
    const [s, e] = l.mark;
    td.append(`${sign}${l.text.slice(0, s)}`, el('mark', { textContent: l.text.slice(s, e) }), l.text.slice(e));
  } else td.textContent = `${sign}${l.text}`;
  return td;
}
const numCell = (n: number | undefined, kind: string) => el('td', { className: `num ${n === undefined ? 'empty' : kind}`, textContent: n === undefined ? '' : String(n) });
const kindOf = (l: JsonLine) => (l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : 'ctx');

function hunkRows(h: JsonHunk, mode: Mode): HTMLTableRowElement[] {
  const header = el('td', { className: 'code', textContent: h.location });
  header.colSpan = mode === 'split' ? 3 : 1;
  const rows = [el('tr', { className: 'hunk' }, ...(mode === 'split' ? [el('td', { className: 'num' })] : [el('td', { className: 'num' }), el('td', { className: 'num' })]), header)];
  if (mode === 'unified') {
    for (const l of h.lines) {
      const k = kindOf(l);
      rows.push(el('tr', {}, numCell(l.old, k), numCell(l.new, k), codeCell(l, '', k, l.kind === ' ' ? '  ' : `${l.kind} `)));
    }
    return rows;
  }
  // Split: each run of removed lines beside the added lines that replace it.
  for (let i = 0; i < h.lines.length; ) {
    const l = h.lines[i]!;
    if (l.kind === ' ') {
      rows.push(el('tr', {}, numCell(l.old, 'ctx'), codeCell(l, 'old', 'ctx'), numCell(l.new, 'ctx'), codeCell(l, 'new', 'ctx')));
      i++;
      continue;
    }
    const del: JsonLine[] = [];
    const add: JsonLine[] = [];
    while (i < h.lines.length && h.lines[i]!.kind !== ' ') (h.lines[i]!.kind === '-' ? del : add).push(h.lines[i++]!);
    for (let r = 0; r < Math.max(del.length, add.length); r++) {
      const d = del[r];
      const a = add[r];
      rows.push(el('tr', {}, numCell(d?.old, 'del'), codeCell(d, 'old', 'del'), numCell(a?.new, 'add'), codeCell(a, 'new', 'add')));
    }
  }
  return rows;
}

function panel(state: Shown | { error: string }, mode: Mode, view: 'formatted' | 'github', onToggle: () => void): HTMLElement {
  const bar = el('div', { className: `${PANEL}-bar` });
  const box = el('div', { className: PANEL }, bar);
  if ('error' in state) {
    bar.append(`Couldn't format this minified JSON: ${state.error}`);
    return box;
  }
  if (state.status === 'formatting') bar.append(el('b', { textContent: 'Formatting only' }), ': the JSON is the same once formatted.');
  else {
    const hunks = state.hunks.length;
    bar.append(
      el('b', { textContent: view === 'formatted' ? 'Formatted JSON diff' : "GitHub's diff" }),
      el('span', { className: 'add', textContent: `+${state.added}` }),
      el('span', { className: 'del', textContent: `−${state.removed}` }),
      `${hunks} place${hunks === 1 ? '' : 's'}${state.truncated ? ' (first ones shown)' : ''}`,
    );
    // Fixed layout takes column widths from the first row, which is a hunk header spanning columns: give them explicitly.
    const widths = mode === 'split' ? ['num', 'code', 'num', 'code'] : ['num', 'num', 'code'];
    const cols = el('colgroup', {}, ...widths.map((w) => el('col', { className: w })));
    box.append(el('table', { className: mode }, cols, el('tbody', {}, ...state.hunks.flatMap((h) => hunkRows(h, mode)))));
  }
  const toggle = el('button', { type: 'button', textContent: view === 'formatted' ? "View GitHub's diff" : 'View formatted diff' });
  toggle.addEventListener('click', onToggle);
  bar.append(toggle);
  return box;
}

export const readableJson: Feature = {
  id: 'readableJson',
  appliesTo: isFilesTab,

  async run({ page, dom, status, signal }) {
    const cmp = readComparison(page.number);
    if (!cmp?.json.size) return;

    const style = el('style', { textContent: CSS });
    document.head.append(style);

    const results = new Map<string, ReadableJson | 'loading' | { error: string }>();
    /** Files the reader switched to GitHub's diff. */
    const showGithub = new Set<string>();
    let shown = 0;
    let formattingOnly = 0;
    const report = () => {
      if (!shown && !formattingOnly) return;
      const parts = [`🧾 Formatted diffs for ${shown} minified JSON file${shown === 1 ? '' : 's'} so far (more load as you scroll)`];
      if (formattingOnly) parts.push(`${formattingOnly} formatting-only`);
      status.set({ text: parts.join(' · ') });
    };

    // Puts the file's diff at the top of its body and hides GitHub's (the body is rebuilt when a collapsed file is expanded).
    const render = (fileEl: HTMLElement, path: string) => {
      const body = dom.fileBody(fileEl);
      const state = results.get(path);
      if (!body || !state || state === 'loading') return;
      // Readable or not JSON: GitHub's diff is the one to read.
      if ('status' in state && (state.status === 'readable' || state.status === 'invalid')) return;
      const mode = diffViewMode();
      const view = 'error' in state || showGithub.has(path) ? 'github' : 'formatted';
      const key = `${'error' in state ? 'error' : state.status}:${mode}:${view}`;
      const old = body.querySelector<HTMLElement>(`:scope > .${PANEL}`);
      if (old?.dataset.key === key && body.getAttribute(VIEW) === view) return;
      old?.remove();
      const p = panel(state, mode, view, () => {
        if (!showGithub.delete(path)) showGithub.add(path);
        render(elements.get(path) ?? fileEl, path);
      });
      p.dataset.key = key;
      body.setAttribute(VIEW, view);
      body.prepend(p);
    };

    const elements = new Map<string, HTMLElement>();
    const load = (path: string) => {
      results.set(path, 'loading');
      call('readableJson', { owner: page.owner, repo: page.repo, baseOid: cmp.baseOid, headOid: cmp.headOid, path }).then(
        (r) => {
          if (signal.aborted) return;
          results.set(path, r);
          if (r.status === 'diff') shown++;
          if (r.status === 'formatting') formattingOnly++;
          report();
          const current = elements.get(path);
          if (current) render(current, path);
        },
        (err: unknown) => {
          if (signal.aborted) return;
          results.set(path, { error: err instanceof Error ? err.message : String(err) });
          const current = elements.get(path);
          if (current) render(current, path);
        },
      );
    };

    const visible = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          visible.unobserve(e.target);
          const path = dom.filePath(e.target as HTMLElement);
          if (path && !results.has(path)) load(path);
        }
      },
      { rootMargin: '1500px 0px' },
    );

    const attach = (els: HTMLElement[]) => {
      for (const fileEl of els) {
        const path = dom.filePath(fileEl);
        if (!path || !cmp.json.has(path)) continue;
        elements.set(path, fileEl);
        if (results.has(path)) render(fileEl, path);
        else visible.observe(fileEl);
      }
    };
    const unsubscribe = dom.observeFiles(attach);
    attach(dom.fileElements());

    signal.addEventListener(
      'abort',
      () => {
        unsubscribe();
        visible.disconnect();
        style.remove();
        for (const p of document.querySelectorAll(`.${PANEL}`)) p.remove();
        for (const b of document.querySelectorAll(`[${VIEW}]`)) b.removeAttribute(VIEW);
      },
      { once: true },
    );
  },
};
