import { browser } from 'wxt/browser';
import { buildRegistry, LANGUAGES_KEY, storedLanguages, type Registry, type StoredLanguages } from './registry';

let cached: { raw: string; registry: Registry } | null = null;

export async function loadStoredLanguages(): Promise<StoredLanguages> {
  const res = await browser.storage.local.get(LANGUAGES_KEY);
  return storedLanguages(res[LANGUAGES_KEY]);
}

export async function saveStoredLanguages(stored: StoredLanguages): Promise<void> {
  await browser.storage.local.set({ [LANGUAGES_KEY]: stored });
}

/** The registry for the current language files (rebuilt only when they change). */
export async function loadRegistry(): Promise<Registry> {
  const stored = await loadStoredLanguages();
  const raw = JSON.stringify(stored);
  if (cached?.raw !== raw) cached = { raw, registry: buildRegistry(stored) };
  return cached.registry;
}
