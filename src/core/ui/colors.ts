/**
 * One color per feature, so each decoration is recognisable at a glance.
 * Each is a CSS variable the user can override in settings (set on the page's
 * root element by `applyColors`, inherited into our shadow roots); unset, it
 * falls back to a Primer theme variable, then to the light-theme value.
 */
export const COLOR_KEYS = ['moved', 'movedModified', 'search', 'autoViewed', 'formatting'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type ColorSettings = Record<ColorKey, string>; // '' = theme default

export const COLOR_INFO: Record<ColorKey, { label: string; primer: string; fallback: string }> = {
  moved: { label: 'Moved code, unchanged', primer: '--bgColor-done-emphasis', fallback: '#8250df' },
  movedModified: { label: 'Moved code, modified', primer: '--bgColor-severe-emphasis', fallback: '#bc4c00' },
  search: { label: 'Definition search buttons', primer: '--bgColor-accent-emphasis', fallback: '#0969da' },
  autoViewed: { label: '“auto” tag on auto-viewed files', primer: '--bgColor-success-emphasis', fallback: '#1f883d' },
  formatting: { label: 'Formatting-only changes', primer: '--bgColor-neutral-emphasis', fallback: '#59636e' },
};

const cssVar = (key: ColorKey) => `--prh-color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export const COLORS = Object.fromEntries(
  COLOR_KEYS.map((k) => [k, `var(${cssVar(k)}, var(${COLOR_INFO[k].primer}, ${COLOR_INFO[k].fallback}))`]),
) as Record<ColorKey, string>;

export const DEFAULT_COLORS: ColorSettings = { moved: '', movedModified: '', search: '', autoViewed: '', formatting: '' };

const HEX = /^#[0-9a-f]{6}$/i;

/** CSS variable for how strongly formatting-only lines fade (a percentage). */
export const FORMAT_FADE_VAR = '--prh-format-fade-strength';

/** Sets the user's color overrides (removing any that were reset) and the formatting fade on the page. */
export function applyColors(colors: ColorSettings, formatFade: number, root: HTMLElement = document.documentElement): void {
  for (const k of COLOR_KEYS) {
    if (HEX.test(colors[k])) root.style.setProperty(cssVar(k), colors[k]);
    else root.style.removeProperty(cssVar(k));
  }
  const fade = Number.isFinite(formatFade) ? Math.min(100, Math.max(0, Math.round(formatFade))) : 75;
  root.style.setProperty(FORMAT_FADE_VAR, `${fade}%`);
}
