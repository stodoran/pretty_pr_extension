/**
 * Pretty-prints JSON like `JSON.stringify(value, null, 2)`, except that
 * arrays and objects that fit on one line go on it, and every value keeps
 * its exact text (`1.0` stays `1.0`, big
 * integers keep their digits, string escapes are untouched). Each output line
 * also gets the path of the value it belongs to, for hunk headers.
 */

export interface PrettyJson {
  lines: string[];
  /** Per line: the path of the value on it (`a.b[2].c`; '' is the root). */
  paths: string[];
  /** Per object path: a name that identifies it (its "name", "title", "id"... field), for readable headers. */
  labels: Map<string, string>;
}

/** Fields that usually name an object, best first. */
const LABEL_KEYS = ['name', 'title', 'label', 'display_name', 'displayName', 'key', 'id'];
const IDENT = /^[A-Za-z_$][\w$]*$/;

class Invalid extends Error {}

/** Containers that fit on one line this wide (indent included) are printed on it: `[0.84, 0.12]`. */
const WIDTH = 120;

type Node = string | Node[] | { entries: [token: string, key: string, value: Node][] };

export function prettyJson(text: string): PrettyJson | null {
  let root: Node;
  try {
    root = parse(text);
  } catch (err) {
    if (err instanceof Invalid || err instanceof SyntaxError || err instanceof RangeError) return null;
    throw err;
  }
  const lines: string[] = [];
  const paths: string[] = [];
  const labels = new Map<string, string>();
  const emit = (line: string, path: string) => {
    lines.push(line);
    paths.push(path);
  };

  /** The node on one line, or null if it's longer than `budget`. */
  const inline = (n: Node, budget: number): string | null => {
    if (typeof n === 'string') return n.length <= budget ? n : null;
    const items = Array.isArray(n) ? n : n.entries;
    if (!items.length) return Array.isArray(n) ? '[]' : '{}';
    const parts: string[] = [];
    let used = 2;
    for (const item of items) {
      const head = Array.isArray(n) ? '' : `${(item as [string, string, Node])[0]}: `;
      const v = inline(Array.isArray(n) ? (item as Node) : (item as [string, string, Node])[2], budget - used - head.length);
      if (v === null) return null;
      parts.push(head + v);
      used += head.length + v.length + 2;
      if (used > budget) return null;
    }
    return Array.isArray(n) ? `[${parts.join(', ')}]` : `{${parts.join(', ')}}`;
  };

  const print = (n: Node, indent: string, prefix: string, path: string, comma: string) => {
    if (!Array.isArray(n) && typeof n === 'object') {
      for (const [, key, v] of n.entries) {
        const rank = LABEL_KEYS.indexOf(key);
        if (rank < 0 || typeof v !== 'string' || !v.startsWith('"')) continue;
        const prev = labels.get(path);
        if (!prev || LABEL_KEYS.indexOf(prev.split('\0')[0]!) > rank) labels.set(path, `${key}\0${v.slice(1, -1)}`);
      }
    }
    const one = typeof n === 'string' ? n : inline(n, WIDTH - indent.length - prefix.length - comma.length);
    if (one !== null) return emit(`${indent}${prefix}${one}${comma}`, path);
    const inner = `${indent}  `;
    if (Array.isArray(n)) {
      emit(`${indent}${prefix}[`, path);
      n.forEach((v, k) => print(v, inner, '', `${path}[${k}]`, k < n.length - 1 ? ',' : ''));
      return emit(`${indent}]${comma}`, path);
    }
    const entries = (n as { entries: [string, string, Node][] }).entries;
    emit(`${indent}${prefix}{`, path);
    entries.forEach(([token, key, v], k) => {
      const child = IDENT.test(key) ? `${path}${path ? '.' : ''}${key}` : `${path}[${token}]`;
      print(v, inner, `${token}: `, child, k < entries.length - 1 ? ',' : '');
    });
    emit(`${indent}}${comma}`, path);
  };

  print(root, '', '', '', '');
  for (const [k, v] of labels) labels.set(k, v.split('\0')[1]!);
  return { lines, paths, labels };
}

/** Parses to a tree that keeps every scalar's exact text. */
function parse(text: string): Node {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const ws = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i++;
  };
  const string = (): string => {
    const start = i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i++;
      else if (text.charCodeAt(i) < 0x20) throw new Invalid();
      i++;
    }
    if (i >= text.length) throw new Invalid();
    return text.slice(start, ++i);
  };
  const value = (depth: number): Node => {
    if (depth > 500) throw new Invalid();
    ws();
    const c = text[i];
    if (c === '"') return string();
    if (c !== '{' && c !== '[') {
      const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 400));
      if (!m) throw new Invalid();
      i += m[0].length;
      return m[0];
    }
    const close = c === '{' ? '}' : ']';
    i++;
    ws();
    const items: Node[] = [];
    const entries: [string, string, Node][] = [];
    if (text[i] === close) i++;
    else
      for (;;) {
        if (c === '{') {
          ws();
          if (text[i] !== '"') throw new Invalid();
          const token = string();
          ws();
          if (text[i++] !== ':') throw new Invalid();
          entries.push([token, JSON.parse(token) as string, value(depth + 1)]);
        } else items.push(value(depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i++] !== close) throw new Invalid();
        break;
      }
    return c === '{' ? { entries } : items;
  };
  const root = value(0);
  ws();
  if (i !== text.length) throw new Invalid();
  return root;
}

/** `field_groups[3].fields[0].name` → `field_groups[3] "Income" › fields[0] "Client Name" › name`. */
export function describePath(path: string, labels: Map<string, string>): string {
  if (!path) return '(root)';
  const parts: string[] = [];
  const re = /\.?([A-Za-z_$][\w$]*)|\[([^\]"]*|"(?:[^"\\]|\\.)*")\]/g;
  let so = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    so += m[0];
    const label = labels.get(so);
    const piece = m[1] ?? `[${m[2]}]`;
    if (m[2] !== undefined && parts.length) parts[parts.length - 1] += piece;
    else parts.push(piece);
    if (label) parts[parts.length - 1] += ` “${label.length > 60 ? `${label.slice(0, 57)}…` : label}”`;
  }
  return parts.join(' › ');
}
