import { COLOR_INFO, COLOR_KEYS, type ColorSettings } from '../../core/ui/colors';
import { runExamples } from '../../lang/examples';
import { BUILTIN_LANGUAGES, buildRegistry, loadLanguage, type StoredLanguages } from '../../lang/registry';
import { loadStoredLanguages, saveStoredLanguages } from '../../lang/storage';
import { SETTINGS_VERSION, loadSettings, saveSettings, type Settings } from '../../core/settings';
import {
  BUILTIN_TEST_PATTERNS,
  createTestFileMatcher,
  type OverrideMode,
  type PatternOverride,
  type TestPatternConfig,
} from '../../core/test-files';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | number | boolean> = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// ---- overrides ----------------------------------------------------------

function overrideRow(o: PatternOverride = { scope: '', mode: 'extend', patterns: [] }) {
  const scope = el('input', { placeholder: 'owner/* or owner/repo', value: o.scope, className: 'scope grow' });
  const mode = el(
    'select',
    { className: 'mode' },
    el('option', { value: 'extend', textContent: 'extend inherited' }),
    el('option', { value: 'replace', textContent: 'replace inherited' }),
  );
  mode.value = o.mode;
  const patterns = el('textarea', { rows: 3, spellcheck: false, value: o.patterns.join('\n'), className: 'patterns' });
  const remove = el('button', { type: 'button', textContent: 'Remove', className: 'danger' });
  const card = el('div', { className: 'card override' }, el('div', { className: 'row' }, scope, mode, remove), patterns);
  remove.addEventListener('click', () => {
    card.remove();
    updateTry();
  });
  card.addEventListener('input', updateTry);
  $('overrides').append(card);
}

function readPatternConfig(): TestPatternConfig {
  return {
    defaults: lines($<HTMLTextAreaElement>('defaults').value),
    overrides: [...document.querySelectorAll('.override')]
      .map((card) => ({
        scope: (card.querySelector('.scope') as HTMLInputElement).value.trim(),
        mode: (card.querySelector('.mode') as HTMLSelectElement).value as OverrideMode,
        patterns: lines((card.querySelector('.patterns') as HTMLTextAreaElement).value),
      }))
      .filter((o) => o.scope),
  };
}

// ---- colors -------------------------------------------------------------

function colorRows(colors: ColorSettings) {
  for (const key of COLOR_KEYS) {
    const info = COLOR_INFO[key];
    const input = el('input', { type: 'color', id: `color-${key}`, value: colors[key] || info.fallback });
    input.dataset.custom = String(Boolean(colors[key]));
    const state = el('span', { className: 'hint' });
    const reset = el('button', { type: 'button', textContent: 'Use theme default' });
    const sync = () => {
      const custom = input.dataset.custom === 'true';
      state.textContent = custom ? 'custom' : 'theme default';
      reset.disabled = !custom;
    };
    input.addEventListener('input', () => {
      input.dataset.custom = 'true';
      sync();
    });
    reset.addEventListener('click', () => {
      input.value = info.fallback;
      input.dataset.custom = 'false';
      sync();
    });
    sync();
    $('colors').append(el('div', { className: 'row color' }, input, el('label', { htmlFor: input.id, textContent: info.label, className: 'grow' }), state, reset));
  }
}

/** Below the formatting color: how strongly formatting-only lines fade toward the page background. */
function fadeRow(value: number) {
  const input = el('input', { type: 'range', id: 'fmt-fade', min: 0, max: 100, step: 5, value: String(value), className: 'grow' });
  const shown = el('span', { className: 'hint', textContent: `${value}%` });
  const reset = el('button', { type: 'button', textContent: 'Default (75%)' });
  input.addEventListener('input', () => (shown.textContent = `${input.value}%`));
  reset.addEventListener('click', () => {
    input.value = '75';
    shown.textContent = '75%';
  });
  const label = el('label', { htmlFor: input.id, textContent: 'Formatting-only fade' });
  $('colors').append(el('div', { className: 'row color' }, label, input, shown, reset));
}

function readColors(): ColorSettings {
  return Object.fromEntries(
    COLOR_KEYS.map((k) => {
      const input = $<HTMLInputElement>(`color-${k}`);
      return [k, input.dataset.custom === 'true' ? input.value : ''];
    }),
  ) as ColorSettings;
}

// ---- languages ----------------------------------------------------------

let stored: StoredLanguages = { custom: [], disabled: [] };

function langStatus(text: string, ok: boolean) {
  const out = $('lang-status');
  out.className = ok ? 'ok' : 'err';
  out.textContent = text;
}

function download(id: string, source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
  el('a', { href: url, download: `${id}.jsonc` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveLanguages(next: StoredLanguages, message: string) {
  stored = next;
  await saveStoredLanguages(next);
  renderLanguages();
  langStatus(message, true);
}

/** Checks a language file; returns the error text, or null if it is fine. */
function checkLanguage(source: string): { id: string; name: string } | string {
  try {
    const lang = loadLanguage(source);
    const failures = runExamples(lang);
    if (failures.length) return `Its examples don't hold:\n${failures.join('\n')}`;
    return { id: lang.id, name: lang.name };
  } catch (err) {
    return (err as Error).message;
  }
}

async function install(source: string) {
  const res = checkLanguage(source);
  if (typeof res === 'string') return langStatus(`Not installed. ${res}`, false);
  const replaces = res.id in BUILTIN_LANGUAGES ? ` (replaces the built-in ${res.id})` : '';
  await saveLanguages(
    { custom: [...stored.custom.filter((c) => c.id !== res.id), { id: res.id, source }], disabled: stored.disabled.filter((d) => d !== res.id) },
    `Installed ${res.name}${replaces}. Reload open PR tabs to use it.`,
  );
}

function renderLanguages() {
  const registry = buildRegistry({ custom: stored.custom, disabled: [] });
  const box = $('languages');
  box.replaceChildren();
  const ids = [...new Set([...Object.keys(BUILTIN_LANGUAGES), ...stored.custom.map((c) => c.id)])];
  for (const id of ids) {
    const custom = stored.custom.find((c) => c.id === id);
    const builtin = BUILTIN_LANGUAGES[id];
    const source = custom?.source ?? builtin!;
    const lang = registry.byId(id);
    const badge = custom ? (builtin ? 'uploaded, replaces built-in' : 'uploaded') : 'built in';
    const row = el(
      'div',
      { className: 'card lang' },
      el(
        'div',
        { className: 'row' },
        el('span', { className: 'name', textContent: lang?.name ?? id }),
        el('span', { className: 'badge', textContent: badge }),
        el('span', { className: 'exts hint grow', textContent: lang?.extensions.join(' ') ?? '' }),
      ),
    );
    const actions = el('div', { className: 'row' });
    const enabled = el('input', { type: 'checkbox', checked: !stored.disabled.includes(id) });
    enabled.addEventListener('change', () => {
      const disabled = enabled.checked ? stored.disabled.filter((d) => d !== id) : [...stored.disabled, id];
      void saveLanguages({ ...stored, disabled }, `${lang?.name ?? id} ${enabled.checked ? 'on' : 'off'}. Reload open PR tabs.`);
    });
    actions.append(el('label', { className: 'check' }, enabled, document.createTextNode('On')));
    const dl = el('button', { type: 'button', textContent: 'Download' });
    dl.addEventListener('click', () => download(id, source));
    actions.append(dl);
    if (custom) {
      const remove = el('button', { type: 'button', className: 'danger', textContent: builtin ? 'Reset to built-in' : 'Remove' });
      remove.addEventListener('click', () => {
        void saveLanguages({ ...stored, custom: stored.custom.filter((c) => c.id !== id) }, builtin ? `${id}: built-in rules restored.` : `Removed ${lang?.name ?? id}.`);
      });
      actions.append(remove);
    }
    const error = registry.errors[id];
    if (error) actions.append(el('span', { className: 'err', textContent: `Doesn't load: ${error}` }));
    row.append(actions);
    box.append(row);
  }
}

async function initLanguages() {
  stored = await loadStoredLanguages();
  renderLanguages();
  $<HTMLInputElement>('lang-upload').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await install(await file.text());
  });
}

// ---- tester -------------------------------------------------------------

function updateTry() {
  const out = $('try-result');
  const [owner, repo] = $<HTMLInputElement>('try-repo').value.trim().split('/');
  const path = $<HTMLInputElement>('try-path').value.trim();
  if (!path) {
    out.className = 'hint';
    out.textContent = 'Uses the unsaved values above.';
    return;
  }
  const res = createTestFileMatcher(readPatternConfig(), owner || '_', repo || '_')(path);
  out.className = res.isTest ? 'ok' : 'hint';
  out.textContent = res.rule
    ? `${res.isTest ? '✓ Auto-viewed' : '✗ Not auto-viewed'} — rule "${res.rule.pattern}" from ${res.rule.source}`
    : '✗ Not auto-viewed — no rule matched';
}

// ---- load / save --------------------------------------------------------

async function init() {
  const settings = await loadSettings();

  $<HTMLInputElement>('feat-autoViewTests').checked = settings.features.autoViewTests.enabled;
  $<HTMLInputElement>('feat-movedCode').checked = settings.features.movedCode.enabled;
  $<HTMLInputElement>('moved-similarity').value = String(settings.features.movedCode.minSimilarity);
  $<HTMLInputElement>('moved-dim').checked = settings.features.movedCode.dimUnchanged;
  $<HTMLInputElement>('feat-definitionSearch').checked = settings.features.definitionSearch.enabled;
  $<HTMLInputElement>('feat-formatting').checked = settings.features.formatting.enabled;
  $<HTMLInputElement>('fmt-dim').checked = settings.features.formatting.dimLines;
  $<HTMLInputElement>('fmt-autoview').checked = settings.features.formatting.autoViewFiles;
  $<HTMLTextAreaElement>('defaults').value = settings.testPatterns.defaults.join('\n');
  settings.testPatterns.overrides.forEach(overrideRow);
  colorRows(settings.colors);
  fadeRow(settings.features.formatting.fade);
  await initLanguages();

  $('add-override').addEventListener('click', () => overrideRow());
  $('reset-defaults').addEventListener('click', () => {
    $<HTMLTextAreaElement>('defaults').value = BUILTIN_TEST_PATTERNS.join('\n');
    updateTry();
  });
  for (const id of ['defaults', 'try-repo', 'try-path']) $(id).addEventListener('input', updateTry);

  $('save').addEventListener('click', async () => {
    const next: Settings = {
      version: SETTINGS_VERSION,
      testPatterns: readPatternConfig(),
      features: {
        autoViewTests: { enabled: $<HTMLInputElement>('feat-autoViewTests').checked },
        movedCode: {
          enabled: $<HTMLInputElement>('feat-movedCode').checked,
          minSimilarity: Math.min(1, Math.max(0.4, Number($<HTMLInputElement>('moved-similarity').value) || 0.65)),
          dimUnchanged: $<HTMLInputElement>('moved-dim').checked,
        },
        definitionSearch: { enabled: $<HTMLInputElement>('feat-definitionSearch').checked },
        formatting: {
          enabled: $<HTMLInputElement>('feat-formatting').checked,
          dimLines: $<HTMLInputElement>('fmt-dim').checked,
          autoViewFiles: $<HTMLInputElement>('fmt-autoview').checked,
          fade: Number($<HTMLInputElement>('fmt-fade').value),
        },
      },
      colors: readColors(),
    };
    const status = $('save-status');
    try {
      await saveSettings(next);
      status.className = 'ok';
      status.textContent = 'Saved. Colors update right away; reload open PR tabs for other changes.';
    } catch (err) {
      status.className = 'err';
      status.textContent = (err as Error).message;
    }
  });
}

void init();
