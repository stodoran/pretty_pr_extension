import { browser } from 'wxt/browser';
import { DEFAULT_COLORS, type ColorSettings } from './ui/colors';
import { BUILTIN_TEST_PATTERNS, MARKDOWN_PATTERN, type TestPatternConfig } from './test-files';

/** Add an entry here for every feature module; the registry reads `enabled`. */
export interface FeatureSettings {
  autoViewTests: { enabled: boolean };
  movedCode: {
    enabled: boolean;
    /** 0–1 token similarity for a modified function to still count as moved. */
    minSimilarity: number;
    /** Dim the lines of functions that moved without changes. */
    dimUnchanged: boolean;
  };
  definitionSearch: { enabled: boolean };
}
export type FeatureId = keyof FeatureSettings;

export interface Settings {
  /** Bumped when built-in defaults change, so saved settings can be migrated. */
  version: number;
  testPatterns: TestPatternConfig;
  features: FeatureSettings;
  /** Per-feature colors; '' keeps the theme default. */
  colors: ColorSettings;
}

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  testPatterns: { defaults: [...BUILTIN_TEST_PATTERNS], overrides: [] },
  features: {
    autoViewTests: { enabled: true },
    movedCode: { enabled: true, minSimilarity: 0.65, dimUnchanged: true },
    definitionSearch: { enabled: true },
  },
  colors: { ...DEFAULT_COLORS },
};

const KEY = 'settings';

function migrate(stored: Partial<Settings>): Partial<Settings> {
  const version = stored.version ?? 1;
  const defaults = stored.testPatterns?.defaults;
  // v2: markdown files are auto-viewed too.
  if (version < 2 && defaults && !defaults.includes(MARKDOWN_PATTERN)) {
    return { ...stored, testPatterns: { ...stored.testPatterns!, defaults: [...defaults, MARKDOWN_PATTERN] } };
  }
  return stored;
}

function merge(raw: Partial<Settings> | undefined): Settings {
  const stored = raw && migrate(raw);
  return {
    version: SETTINGS_VERSION,
    testPatterns: { ...DEFAULT_SETTINGS.testPatterns, ...stored?.testPatterns },
    features: Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS.features).map(([id, def]) => [
        id,
        { ...def, ...stored?.features?.[id as FeatureId] },
      ]),
    ) as unknown as FeatureSettings,
    colors: { ...DEFAULT_COLORS, ...stored?.colors },
  };
}

/** Settings live in storage.sync so they follow you across Chrome profiles. */
export async function loadSettings(): Promise<Settings> {
  const res = await browser.storage.sync.get(KEY);
  return merge(res[KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.sync.set({ [KEY]: settings });
}
