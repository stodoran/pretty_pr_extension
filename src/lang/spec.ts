/**
 * Language files: the JSON (with comments) format users upload to teach the
 * extension a language, its validation, and compilation into the lookup
 * structures the scanner and the features use. See languages/python.jsonc for
 * the documented format.
 */

export interface LanguageSpec {
  id: string;
  name: string;
  version?: number;
  extensions: string[];
  comments?: { line?: string[]; block?: [string, string][] };
  strings?: {
    quotes?: string[];
    multiline?: string[];
    prefixes?: string[];
    rawPrefixes?: string[];
    meaninglessPrefixes?: string[];
    equivalentQuotes?: string[][];
    interpolation?: { prefixes?: string[]; quotes?: string[]; open: string; close: string } | null;
    implicitConcatenation?: boolean;
  };
  identifierChars?: string;
  operators?: string[];
  regex?: { afterKeywords?: string[] } | null;
  keywords?: string[];
  softKeywords?: string[];
  constants?: string[];
  blocks: 'indentation' | 'braces';
  lineContinuation?: string | null;
  memberAccess?: string[];
  decorator?: string | null;
  modifiers?: string[];
  definitions?: { kind: 'function' | 'class'; pattern: string; inside?: 'class' }[];
  docstrings?: boolean;
  locals?: {
    assignment?: boolean;
    assignmentOperators?: string[];
    declarations?: string[];
    bindAfter?: string[];
    bindBefore?: string[];
    loops?: [string, string][];
    lambda?: [string, string] | null;
    globals?: string[];
  };
  imports?: { pattern: string }[];
  formatting?: {
    enabled?: boolean;
    trailingCommas?: 'never' | 'safe' | 'always';
    optionalSemicolons?: { neededBefore: string[] } | null;
    lineBreakEndsStatementAfter?: string[];
    wrappingParens?: { after: string[]; before: string[]; tupleAfter?: string[] } | null;
    notCalls?: string[];
  };
  examples?: Example[];
}

export type Example =
  | { before: string; after: string; expect: 'formatting' | 'real' }
  | { line: string; defines: string[] };

// ---- JSONC ----------------------------------------------------------------------

/** JSON with // and /* comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unclosed /* comment');
      out += text.slice(i, end + 2).replace(/[^\n]/g, ' ');
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Trailing commas (outside strings: strings were copied verbatim, so re-scan).
  let clean = '';
  for (let k = 0; k < out.length; k++) {
    const c = out[k]!;
    if (c === '"') {
      let j = k + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      clean += out.slice(k, j + 1);
      k = j;
      continue;
    }
    if (c === ',') {
      let j = k + 1;
      while (j < out.length && /\s/.test(out[j]!)) j++;
      if (out[j] === ']' || out[j] === '}') continue;
    }
    clean += c;
  }
  try {
    return JSON.parse(clean);
  } catch (err) {
    const msg = (err as Error).message;
    const pos = /position (\d+)/.exec(msg);
    if (!pos) throw new Error(msg);
    const line = clean.slice(0, Number(pos[1])).split('\n').length;
    throw new Error(`${msg.replace(/ in JSON at position \d+.*/, '')} (line ${line})`);
  }
}

// ---- validation -----------------------------------------------------------------

type Shape =
  | 'string'
  | 'boolean'
  | 'number'
  | 'strings'
  | { enum: string[] }
  | { object: Record<string, Shape>; required?: string[]; nullable?: boolean }
  | { array: Shape; length?: number };

const strings: Shape = 'strings';
const pair: Shape = { array: 'string', length: 2 };

const SPEC: Shape = {
  required: ['id', 'name', 'extensions', 'blocks'],
  object: {
    $schema: 'string',
    id: 'string',
    name: 'string',
    version: 'number',
    extensions: strings,
    comments: { object: { line: strings, block: { array: pair } } },
    strings: {
      object: {
        quotes: strings,
        multiline: strings,
        prefixes: strings,
        rawPrefixes: strings,
        meaninglessPrefixes: strings,
        equivalentQuotes: { array: strings },
        interpolation: {
          nullable: true,
          required: ['open', 'close'],
          object: { prefixes: strings, quotes: strings, open: 'string', close: 'string' },
        },
        implicitConcatenation: 'boolean',
      },
    },
    identifierChars: 'string',
    operators: strings,
    regex: { nullable: true, object: { afterKeywords: strings } },
    keywords: strings,
    softKeywords: strings,
    constants: strings,
    blocks: { enum: ['indentation', 'braces'] },
    lineContinuation: 'string',
    memberAccess: strings,
    decorator: 'string',
    modifiers: strings,
    definitions: {
      array: {
        required: ['kind', 'pattern'],
        object: { kind: { enum: ['function', 'class'] }, pattern: 'string', inside: { enum: ['class'] } },
      },
    },
    docstrings: 'boolean',
    locals: {
      object: {
        assignment: 'boolean',
        assignmentOperators: strings,
        declarations: strings,
        bindAfter: strings,
        bindBefore: strings,
        loops: { array: pair },
        lambda: pair,
        globals: strings,
      },
    },
    imports: { array: { required: ['pattern'], object: { pattern: 'string' } } },
    formatting: {
      object: {
        enabled: 'boolean',
        trailingCommas: { enum: ['never', 'safe', 'always'] },
        optionalSemicolons: { nullable: true, required: ['neededBefore'], object: { neededBefore: strings } },
        lineBreakEndsStatementAfter: strings,
        wrappingParens: {
          nullable: true,
          required: ['after', 'before'],
          object: { after: strings, before: strings, tupleAfter: strings },
        },
        notCalls: strings,
      },
    },
    examples: {
      array: {
        object: { before: 'string', after: 'string', expect: { enum: ['formatting', 'real'] }, line: 'string', defines: strings },
      },
    },
  },
};

/** Keys that may also be null (meaning "none"). */
const NULLABLE_SCALARS = new Set(['lineContinuation', 'decorator', 'lambda']);

function check(value: unknown, shape: Shape, path: string, errors: string[]) {
  const where = path || 'file';
  const type = (t: string) => errors.push(`${where}: expected ${t}`);
  if (value === null && NULLABLE_SCALARS.has(path.split('.').at(-1) ?? '')) return;
  if (shape === 'string') return typeof value === 'string' ? undefined : type('a string');
  if (shape === 'boolean') return typeof value === 'boolean' ? undefined : type('true or false');
  if (shape === 'number') return typeof value === 'number' ? undefined : type('a number');
  if (shape === 'strings') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) type('a list of strings');
    return;
  }
  if ('enum' in shape) {
    if (!shape.enum.includes(value as string)) type(`one of ${shape.enum.map((e) => `"${e}"`).join(', ')}`);
    return;
  }
  if ('array' in shape) {
    if (!Array.isArray(value)) return type('a list');
    if (shape.length !== undefined && value.length !== shape.length) return type(`a list of ${shape.length}`);
    value.forEach((v, i) => check(v, shape.array, `${path}[${i}]`, errors));
    return;
  }
  if (value === null && shape.nullable) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return type('an object');
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const sub = shape.object[key];
    if (!sub) errors.push(`${path ? `${path}.` : ''}${key}: unknown key`);
    else check(obj[key], sub, path ? `${path}.${key}` : key, errors);
  }
  for (const key of shape.required ?? []) if (!(key in obj)) errors.push(`${path ? `${path}.` : ''}${key}: missing`);
}

/** Parses and validates a language file; throws with every problem found. */
export function parseLanguageFile(text: string): LanguageSpec {
  const raw = parseJsonc(text);
  const errors: string[] = [];
  check(raw, SPEC, '', errors);
  const spec = raw as LanguageSpec;
  if (!errors.length) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(spec.id)) errors.push('id: lowercase letters, digits, - and _ only');
    if (!spec.extensions.length) errors.push('extensions: at least one');
    for (const e of spec.extensions) if (!/^\.[\w.+-]+$/.test(e)) errors.push(`extensions: "${e}" should look like ".ext"`);
    spec.examples?.forEach((ex, i) => {
      const keys = Object.keys(ex).sort().join(',');
      if (keys !== 'after,before,expect' && keys !== 'defines,line') {
        errors.push(`examples[${i}]: either before/after/expect or line/defines`);
      }
    });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return spec;
}
