import type { Language } from './language';
import { scan } from './scan';

/**
 * Syntax highlighter for the Compare view. Produces spans with GitHub's own
 * "pl-*" class names so colors match the diff. Strings and comments spanning
 * lines are split per line.
 */
export type HlClass = 'k' | 's' | 'c' | 'c1' | 'en' | 'v';
export type HlSpan = { text: string; cls?: HlClass };

const ALL_CAPS = /^[A-Z][A-Z0-9_]+$/;

export function highlight(lines: string[], lang: Language): HlSpan[][] {
  const src = lines.join('\n');
  const out: HlSpan[][] = lines.map(() => []);
  let line = 0;
  const push = (text: string, cls?: HlClass) => {
    const parts = text.split('\n');
    parts.forEach((part, k) => {
      if (k > 0) line++;
      if (!part) return;
      const spans = out[line]!;
      const last = spans.at(-1);
      if (last && last.cls === cls) last.text += part;
      else spans.push({ text: part, cls });
    });
  };

  const toks = scan(src, lang).filter((t) => t.type !== 'nl');
  let pos = 0;
  let prevCode = '';
  let decorating = false;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    push(src.slice(pos, t.start));
    let cls: HlClass | undefined;
    if (t.type === 'comment') cls = 'c';
    else if (t.type === 'string' || t.type === 'regex') cls = 's';
    else if (t.type === 'number') cls = 'c1';
    else if (t.type === 'name') {
      if (decorating) {
        cls = 'en';
        decorating = toks[k + 1]?.value === '.' && toks[k + 1]!.start === t.end;
      } else if (lang.definitionKeywords.has(prevCode)) cls = 'en';
      else if (lang.keywords.has(t.value) || lang.softKeywords.has(t.value)) cls = 'k';
      else if (lang.constants.has(t.value) || ALL_CAPS.test(t.value)) cls = 'c1';
    } else if (t.type === 'op') {
      if (lang.decorator && t.value === lang.decorator && toks[k + 1]?.type === 'name' && toks[k + 1]!.start === t.end) {
        decorating = true;
        cls = 'en';
      } else if (decorating && t.value === '.' && toks[k + 1]?.type === 'name' && toks[k + 1]!.start === t.end) cls = 'en';
      else decorating = false;
    }
    if (t.type !== 'name' && t.type !== 'op') decorating = false;
    push(src.slice(t.start, t.end), cls);
    if (t.type !== 'comment') prevCode = t.value;
    pos = t.end;
  }
  push(src.slice(pos));
  return out;
}
