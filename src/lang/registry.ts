import pythonSource from '../../languages/python.jsonc?raw';
import typescriptSource from '../../languages/typescript.jsonc?raw';
import { compileLanguage, languageMatches, type Language } from './language';
import { parseLanguageFile } from './spec';

/**
 * The languages in use: the built-in ones (shipped language files) plus the
 * ones uploaded on the settings page, which replace a built-in one with the
 * same id. Stored in storage.local (language files are too big for sync).
 */
export const BUILTIN_LANGUAGES: Record<string, string> = { python: pythonSource, typescript: typescriptSource };

export interface StoredLanguages {
  /** Uploaded language files (source text), by id. */
  custom: { id: string; source: string }[];
  /** Ids switched off on the settings page. */
  disabled: string[];
}

export const LANGUAGES_KEY = 'languages';
export const EMPTY_LANGUAGES: StoredLanguages = { custom: [], disabled: [] };

export interface Registry {
  languages: Language[];
  forPath(path: string): Language | null;
  byId(id: string): Language | null;
  /** Changes whenever the language files in use change (part of cache keys). */
  hash: string;
  /** Files that failed to load, by id. */
  errors: Record<string, string>;
}

/** Cheap stable string hash (FNV-1a). */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export function loadLanguage(source: string): Language {
  return compileLanguage(parseLanguageFile(source));
}

export function buildRegistry(stored: StoredLanguages = EMPTY_LANGUAGES): Registry {
  const sources = new Map(Object.entries(BUILTIN_LANGUAGES));
  for (const c of stored.custom) sources.set(c.id, c.source);
  const languages: Language[] = [];
  const errors: Record<string, string> = {};
  let fingerprint = '';
  for (const [id, source] of sources) {
    if (stored.disabled.includes(id)) continue;
    try {
      languages.push(loadLanguage(source));
      fingerprint += `${id}:${hashOf(source)};`;
    } catch (err) {
      errors[id] = (err as Error).message;
    }
  }
  // Uploaded languages first, so they win an extension shared with a built-in one.
  const custom = new Set(stored.custom.map((c) => c.id));
  languages.sort((a, b) => Number(custom.has(b.id)) - Number(custom.has(a.id)));
  return {
    languages,
    forPath: (path) => languages.find((l) => languageMatches(l, path)) ?? null,
    byId: (id) => languages.find((l) => l.id === id) ?? null,
    hash: hashOf(fingerprint),
    errors,
  };
}

/** Built-in languages only (tests, and before storage has loaded). */
export const builtinRegistry = buildRegistry();

export function storedLanguages(raw: unknown): StoredLanguages {
  const r = (raw ?? {}) as Partial<StoredLanguages>;
  return { custom: Array.isArray(r.custom) ? r.custom : [], disabled: Array.isArray(r.disabled) ? r.disabled : [] };
}
