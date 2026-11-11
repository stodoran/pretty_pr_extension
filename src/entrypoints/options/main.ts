import { COLOR_INFO, COLOR_KEYS, type ColorSettings } from '../../core/ui/colors';
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

function readColors(): ColorSettings {
  return Object.fromEntries(
    COLOR_KEYS.map((k) => {
      const input = $<HTMLInputElement>(`color-${k}`);
      return [k, input.dataset.custom === 'true' ? input.value : ''];
    }),
  ) as ColorSettings;
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
  $<HTMLTextAreaElement>('defaults').value = settings.testPatterns.defaults.join('\n');
  settings.testPatterns.overrides.forEach(overrideRow);
  colorRows(settings.colors);

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
