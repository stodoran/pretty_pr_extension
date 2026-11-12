/** Parser for `git diff` unified output (what GitHub serves at /pull/N.diff). */

export interface DiffLine {
  kind: ' ' | '-' | '+';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string | null; // null for added files
  newPath: string | null; // null for deleted files
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary: boolean;
  /** File mode changed (e.g. made executable). */
  modeChange?: boolean;
  /** Abbreviated blob ids from the `index` line, for verifying fetched contents. */
  oldBlob?: string;
  newBlob?: string;
  oldNoNewlineAtEof: boolean;
  newNoNewlineAtEof: boolean;
  hunks: Hunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function unquote(p: string): string {
  if (!p.startsWith('"')) return p;
  // git C-style quoting for unusual paths
  return JSON.parse(p.replace(/\\([0-7]{3})/g, (_, o: string) => `\\u${parseInt(o, 8).toString(16).padStart(4, '0')}`));
}

function stripPrefix(p: string): string | null {
  const u = unquote(p.trim());
  if (u === '/dev/null') return null;
  return u.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = text.split('\n');
  let file: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  let lastKind: DiffLine['kind'] | null = null;

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const kind = line[0];
      const body = line.slice(1);
      if (kind === ' ' || (kind === undefined && line === '')) {
        hunk.lines.push({ kind: ' ', text: body, oldNo: oldNo++, newNo: newNo++ });
        oldLeft--;
        newLeft--;
        lastKind = ' ';
        continue;
      }
      if (kind === '-') {
        hunk.lines.push({ kind: '-', text: body, oldNo: oldNo++ });
        oldLeft--;
        lastKind = '-';
        continue;
      }
      if (kind === '+') {
        hunk.lines.push({ kind: '+', text: body, newNo: newNo++ });
        newLeft--;
        lastKind = '+';
        continue;
      }
    }
    if (line.startsWith('\\')) {
      // "\ No newline at end of file" applies to the preceding line's side
      if (file && lastKind === '-') file.oldNoNewlineAtEof = true;
      else if (file && lastKind === '+') file.newNoNewlineAtEof = true;
      else if (file) file.oldNoNewlineAtEof = file.newNoNewlineAtEof = true;
      continue;
    }

    if (line.startsWith('diff --git ')) {
      hunk = null;
      const m = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line);
      file = {
        oldPath: m ? unquote(m[1]!) : null,
        newPath: m ? unquote(m[2]!) : null,
        status: 'modified',
        binary: false,
        oldNoNewlineAtEof: false,
        newNoNewlineAtEof: false,
        hunks: [],
      };
      files.push(file);
      continue;
    }
    if (!file) continue;

    const h = HUNK.exec(line);
    if (h) {
      hunk = {
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        lines: [],
      };
      file.hunks.push(hunk);
      oldLeft = hunk.oldLines;
      newLeft = hunk.newLines;
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      continue;
    }
    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('old mode ') || line.startsWith('new mode ')) file.modeChange = true;
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      file.status = 'renamed';
      file.oldPath = unquote(line.slice(12));
    } else if (line.startsWith('rename to ')) file.newPath = unquote(line.slice(10));
    else if (line.startsWith('index ')) {
      const m = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/.exec(line);
      if (m) {
        file.oldBlob = m[1];
        file.newBlob = m[2];
      }
    } else if (line.startsWith('--- ')) file.oldPath = stripPrefix(line.slice(4));
    else if (line.startsWith('+++ ')) file.newPath = stripPrefix(line.slice(4));
    else if (line.startsWith('Binary files ')) file.binary = true;
  }

  for (const f of files) {
    if (f.status === 'added') f.oldPath = null;
    if (f.status === 'deleted') f.newPath = null;
  }
  return files;
}

/** Rebuilds the old (base) file from the new (head) file by reverse-applying the diff. */
export function reverseApply(newText: string, file: DiffFile): string {
  const newLines = newText.split('\n');
  const out: string[] = [];
  let ni = 1; // next head line to copy (1-based)
  for (const hunk of file.hunks) {
    const copyUntil = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;
    while (ni <= copyUntil) out.push(newLines[ni++ - 1]!);
    for (const l of hunk.lines) {
      if (l.kind === ' ') out.push(newLines[ni++ - 1]!);
      else if (l.kind === '+') ni++;
      else out.push(l.text);
    }
  }
  while (ni <= newLines.length) out.push(newLines[ni++ - 1]!);
  // Head ended with "\n" (last element ""), base may not, and vice versa.
  let result = out.join('\n');
  if (file.oldNoNewlineAtEof && result.endsWith('\n')) result = result.slice(0, -1);
  else if (!file.oldNoNewlineAtEof && file.newNoNewlineAtEof) result += '\n';
  return result;
}

/** Content of a side that consists entirely of +/- lines (added or deleted file). */
export function sideFromDiff(file: DiffFile, side: 'old' | 'new'): string {
  const kind = side === 'old' ? '-' : '+';
  const text = file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === kind).map((l) => l.text)).join('\n');
  const noEol = side === 'old' ? file.oldNoNewlineAtEof : file.newNoNewlineAtEof;
  return text.length && !noEol ? text + '\n' : text;
}

/** Maps an old (base) line number to the corresponding new (head) line number. */
export function mapOldToNew(file: DiffFile, oldLine: number): number {
  let delta = 0;
  for (const h of file.hunks) {
    if (oldLine < h.oldStart) break;
    if (oldLine < h.oldStart + h.oldLines) {
      const l = h.lines.find((x) => x.oldNo === oldLine);
      // A removed line has no counterpart; use the position where it was.
      return l?.newNo ?? h.newStart + (oldLine - h.oldStart);
    }
    delta = h.newStart + h.newLines - (h.oldStart + h.oldLines);
  }
  return oldLine + delta;
}
