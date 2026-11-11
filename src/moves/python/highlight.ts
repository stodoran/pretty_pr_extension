/**
 * Minimal Python syntax highlighter for the Compare view. Produces spans with
 * GitHub's own "pl-*" class names so colors match the diff. Tracks open
 * triple-quoted strings across lines (docstrings).
 */
export type HlClass = 'k' | 's' | 'c' | 'c1' | 'en' | 'v';
export type HlSpan = { text: string; cls?: HlClass };

const KEYWORDS = new Set(
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type'.split(
    ' ',
  ),
);
const CONSTANTS = new Set(['True', 'False', 'None', 'self', 'cls', 'NotImplemented', 'Ellipsis']);

// One token at a time: comment | string start | number | identifier | decorator | anything else.
const TOKEN =
  /(#.*)|((?:[rRbBuUfF]{0,2})(?:"""|'''|"|'))|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?j?\b|\b0[xXoObB][\da-fA-F_]+\b)|([A-Za-z_]\w*)|(@[\w.]+)|(\s+|.)/gy;

export function highlightPython(lines: string[]): HlSpan[][] {
  let open: string | null = null; // quote of a string still open from a previous line
  return lines.map((line) => {
    const spans: HlSpan[] = [];
    const push = (text: string, cls?: HlClass) => {
      if (!text) return;
      const last = spans.at(-1);
      if (last && last.cls === cls) last.text += text;
      else spans.push({ text, cls });
    };
    let i = 0;
    let prevWord = '';

    const readString = (quote: string) => {
      // From i, consume until `quote` (respecting escapes) or end of line.
      let j = i;
      while (j < line.length) {
        if (line[j] === '\\') j += 2;
        else if (line.startsWith(quote, j)) {
          j += quote.length;
          push(line.slice(i, j), 's');
          i = j;
          return true;
        } else j++;
      }
      push(line.slice(i), 's');
      i = line.length;
      return false;
    };

    if (open) {
      if (readString(open)) open = null;
    }
    while (i < line.length) {
      TOKEN.lastIndex = i;
      const m = TOKEN.exec(line);
      if (!m) break;
      const [all, comment, strStart, num, word, deco] = m;
      if (comment) {
        push(comment, 'c');
        i += all.length;
      } else if (strStart) {
        const quote = strStart.replace(/^[rRbBuUfF]+/, '');
        const start = i;
        i += strStart.length;
        push(line.slice(start, i), 's');
        const closed = readString(quote);
        if (!closed && quote.length === 3) open = quote;
      } else if (num) {
        push(num, 'c1');
        i += all.length;
      } else if (word) {
        if (prevWord === 'def' || prevWord === 'class') push(word, 'en');
        else if (KEYWORDS.has(word)) push(word, 'k');
        else if (CONSTANTS.has(word)) push(word, 'c1');
        else if (/^[A-Z][A-Z0-9_]+$/.test(word)) push(word, 'c1');
        else push(word);
        prevWord = word;
        i += all.length;
        continue;
      } else if (deco) {
        push(deco, 'en');
        i += all.length;
      } else {
        push(all);
        i += all.length;
        if (all.trim()) prevWord = '';
        continue;
      }
      prevWord = '';
    }
    return spans;
  });
}
