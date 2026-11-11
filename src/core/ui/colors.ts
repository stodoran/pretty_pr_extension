/**
 * One color per feature, so each decoration is recognisable at a glance.
 * Each is a CSS variable the user can override in settings (set on the page's
 * root element by `applyColors`, inherited into our shadow roots); unset, it
 * falls back to a Primer theme variable, then to the light-theme value.
 */
export const COLOR_KEYS = ['moved', 'movedModified', 'search', 'autoViewed'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type ColorSettings = Record<ColorKey, string>; // '' = theme default

export const COLOR_INFO: Record<ColorKey, { label: string; primer: string; fallback: string }> = {
  moved: { label: 'Moved code, unchanged', primer: '--bgColor-done-emphasis', fallback: '#8250df' },
  movedModified: { label: 'Moved code, modified', primer: '--bgColor-severe-emphasis', fallback: '#bc4c00' },
  search: { label: 'Definition search buttons', primer: '--bgColor-accent-emphasis', fallback: '#0969da' },
  autoViewed: { label: '“auto” tag on auto-viewed files', primer: '--bgColor-success-emphasis', fallback: '#1f883d' },
};

const cssVar = (key: ColorKey) => `--prh-color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export const COLORS = Object.fromEntries(
  COLOR_KEYS.map((k) => [k, `var(${cssVar(k)}, var(${COLOR_INFO[k].primer}, ${COLOR_INFO[k].fallback}))`]),
) as Record<ColorKey, string>;

export const DEFAULT_COLORS: ColorSettings = { moved: '', movedModified: '', search: '', autoViewed: '' };

const HEX = /^#[0-9a-f]{6}$/i;

/** Sets the user's color overrides on the page (removing any that were reset). */
export function applyColors(colors: ColorSettings, root: HTMLElement = document.documentElement): void {
  for (const k of COLOR_KEYS) {
    if (HEX.test(colors[k])) root.style.setProperty(cssVar(k), colors[k]);
    else root.style.removeProperty(cssVar(k));
  }
}
