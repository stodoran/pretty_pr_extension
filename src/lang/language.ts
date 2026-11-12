import { compilePattern, type Pattern } from './pattern';
import type { LanguageSpec } from './spec';

/** A language file compiled into the lookups the scanner and features use. */
export interface Language {
  spec: LanguageSpec;
  id: string;
  name: string;
  extensions: string[];
  lineComments: string[];
  blockComments: [string, string][];
  /** Longest first. */
  quotes: string[];
  multiline: Set<string>;
  /** Lowercase, longest first. */
  prefixes: string[];
  rawPrefixes: Set<string>;
  meaninglessPrefixes: Set<string>;
  /** Quote → index of its group of equivalent quotes. */
  quoteGroup: Map<string, number>;
  /** Group index → regex matching an escaped quote character of that group (`\'`, `\"`). */
  escapedQuote: Map<number, RegExp>;
  interpolation: { prefixes: Set<string>; quotes: Set<string>; open: string; close: string } | null;
  implicitConcatenation: boolean;
  /** Sticky identifier regex. */
  ident: RegExp;
  /** Leading-character test for identifiers. */
  nameStart: RegExp;
  /** Multi-character operators, longest first. */
  operators: string[];
  regexAfterKeywords: Set<string> | null;
  keywords: Set<string>;
  softKeywords: Set<string>;
  constants: Set<string>;
  indentBlocks: boolean;
  lineContinuation: string | null;
  memberAccess: Set<string>;
  decorator: string | null;
  modifiers: Set<string>;
  definitions: { kind: 'def' | 'class'; pattern: Pattern; inside: 'class' | null; arrow: boolean }[];
  /** Tokens right before `$name` in a definition pattern (`def`, `class`, `function`). */
  definitionKeywords: Set<string>;
  docstrings: boolean;
  locals: {
    assignment: boolean;
    assignmentOperators: Set<string>;
    declarations: Set<string>;
    bindAfter: Set<string>;
    bindBefore: Set<string>;
    loops: [string, string][];
    lambda: [string, string] | null;
    globals: Set<string>;
  };
  imports: Pattern[];
  formatting: {
    enabled: boolean;
    trailingCommas: 'never' | 'safe' | 'always';
    optionalSemicolons: Set<string> | null;
    lineBreakEndsAfter: Set<string>;
    wrappingParens: { after: Set<string>; before: Set<string>; tupleAfter: Set<string> } | null;
    /** Words a `(` can follow without being a call. */
    notCalls: Set<string>;
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byLength = (a: string, b: string) => b.length - a.length;

/** Compiles a validated spec; throws on bad patterns. */
export function compileLanguage(spec: LanguageSpec): Language {
  const s = spec.strings ?? {};
  const quotes = [...(s.quotes ?? [])].sort(byLength);
  const quoteGroup = new Map<string, number>();
  (s.equivalentQuotes ?? []).forEach((g, i) => g.forEach((q) => quoteGroup.set(q, i)));
  const extra = escapeRe(spec.identifierChars ?? '');
  const keywords = new Set(spec.keywords ?? []);
  const softKeywords = new Set(spec.softKeywords ?? []);
  const f = spec.formatting ?? {};
  const l = spec.locals ?? {};

  const definitions = (spec.definitions ?? []).map((d, i) => {
    try {
      return { kind: d.kind === 'function' ? ('def' as const) : ('class' as const), pattern: compilePattern(d.pattern), inside: d.inside ?? null, arrow: /=>\s*$/.test(d.pattern) };
    } catch (err) {
      throw new Error(`definitions[${i}].pattern: ${(err as Error).message}`);
    }
  });
  if (definitions.some((d) => !d.pattern.els.some((e) => e.kind === 'name'))) throw new Error('definitions: every pattern needs a $name');
  const imports = (spec.imports ?? []).map((d, i) => {
    try {
      const p = compilePattern(d.pattern);
      if (!p.els.some((e) => e.kind === 'entries' || e.kind === 'module')) throw new Error('needs $entries or $module');
      if (p.els[0]!.kind !== 'lit' || (p.els[0] as { optional: boolean }).optional) throw new Error('must start with a word');
      return p;
    } catch (err) {
      throw new Error(`imports[${i}].pattern: ${(err as Error).message}`);
    }
  });
  const definitionKeywords = new Set<string>();
  for (const d of definitions) {
    // Words before `$name` (`def`, `async function *`), except in variable-style patterns (`const $name = …`).
    const at = d.pattern.els.findIndex((e) => e.kind === 'name');
    const after = d.pattern.els.slice(at + 1);
    if (after.some((e) => e.kind === 'lit' && e.values.has('='))) continue;
    for (const e of d.pattern.els.slice(0, at)) if (e.kind === 'lit') for (const v of e.values) definitionKeywords.add(v);
  }

  return {
    spec,
    id: spec.id,
    name: spec.name,
    extensions: spec.extensions.map((e) => e.toLowerCase()),
    lineComments: [...(spec.comments?.line ?? [])].sort(byLength),
    blockComments: spec.comments?.block ?? [],
    quotes,
    multiline: new Set(s.multiline ?? []),
    prefixes: [...(s.prefixes ?? [])].map((p) => p.toLowerCase()).sort(byLength),
    rawPrefixes: new Set((s.rawPrefixes ?? []).map((p) => p.toLowerCase())),
    meaninglessPrefixes: new Set((s.meaninglessPrefixes ?? []).map((p) => p.toLowerCase())),
    quoteGroup,
    escapedQuote: new Map(
      (s.equivalentQuotes ?? []).map((g, i) => {
        const chars = [...new Set(g.join(''))].map(escapeRe).join('');
        return [i, new RegExp(`\\\\([${chars}])`, 'g')] as const;
      }),
    ),
    interpolation: s.interpolation
      ? {
          prefixes: new Set((s.interpolation.prefixes ?? []).map((p) => p.toLowerCase())),
          quotes: new Set(s.interpolation.quotes ?? []),
          open: s.interpolation.open,
          close: s.interpolation.close,
        }
      : null,
    implicitConcatenation: s.implicitConcatenation ?? false,
    ident: new RegExp(`[A-Za-z_${extra}\\u00C0-\\uFFFF][\\w${extra}\\u00C0-\\uFFFF]*`, 'y'),
    nameStart: new RegExp(`^[A-Za-z_${extra}\\u00C0-\\uFFFF]`),
    operators: [...(spec.operators ?? [])].filter((o) => o.length > 1).sort(byLength),
    regexAfterKeywords: spec.regex ? new Set(spec.regex.afterKeywords ?? []) : null,
    keywords,
    softKeywords,
    constants: new Set(spec.constants ?? []),
    indentBlocks: spec.blocks === 'indentation',
    lineContinuation: spec.lineContinuation ?? null,
    memberAccess: new Set(spec.memberAccess ?? ['.']),
    decorator: spec.decorator ?? null,
    modifiers: new Set(spec.modifiers ?? []),
    definitions,
    definitionKeywords,
    docstrings: spec.docstrings ?? false,
    locals: {
      assignment: l.assignment ?? false,
      assignmentOperators: new Set(l.assignmentOperators ?? ['=']),
      declarations: new Set(l.declarations ?? []),
      bindAfter: new Set(l.bindAfter ?? []),
      bindBefore: new Set(l.bindBefore ?? []),
      loops: l.loops ?? [],
      lambda: l.lambda ?? null,
      globals: new Set(l.globals ?? []),
    },
    imports,
    formatting: {
      enabled: f.enabled ?? true,
      trailingCommas: f.trailingCommas ?? 'never',
      optionalSemicolons: f.optionalSemicolons ? new Set(f.optionalSemicolons.neededBefore) : null,
      lineBreakEndsAfter: new Set(f.lineBreakEndsStatementAfter ?? []),
      wrappingParens: f.wrappingParens
        ? { after: new Set(f.wrappingParens.after), before: new Set(f.wrappingParens.before), tupleAfter: new Set(f.wrappingParens.tupleAfter ?? []) }
        : null,
      notCalls: new Set([...keywords, ...softKeywords, ...(f.notCalls ?? [])]),
    },
  };
}

export function languageMatches(lang: Language, path: string): boolean {
  const lower = path.toLowerCase();
  return lang.extensions.some((e) => lower.endsWith(e));
}
