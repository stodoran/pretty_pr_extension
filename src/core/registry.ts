import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createReactUiAdapter } from '../github/dom/react-ui';
import { parsePrUrl, prKey } from '../github/pr';
import { pruneAutoViewMemory } from './auto-view-memory';
import type { Feature } from './feature';
import { isContextValid, isInvalidationError } from './lifecycle';
import { call, type TabState } from './messaging';
import { loadSettings } from './settings';
import { applyColors } from './ui/colors';
import { StatusDock } from './ui/status-dock';
import { browser } from 'wxt/browser';

const CONTEXT_CHECK_MS = 2000;

/**
 * Runs enabled features on each PR page visit. GitHub is a SPA, so the content
 * script is injected on all of github.com and reacts to in-page navigation.
 */
export function startRegistry(wxt: ContentScriptContext, features: Feature[]): void {
  const dock = new StatusDock();
  const dom = createReactUiAdapter();
  let current: AbortController | null = null;
  let lastKey: string | null = null;
  let dead = false;

  /** Toolbar badge; best effort (never let it break a feature). */
  const setTabState = (state: TabState) => void call('setTabState', { state }).catch(() => {});

  /** Extension was reloaded: stop everything; the fresh copy runs after a page refresh. */
  function teardown() {
    if (dead) return;
    dead = true;
    current?.abort();
    dock.clearAll();
    clearInterval(contextCheck);
    browser.storage.onChanged.removeListener(onStorageChange); // can't reset the badge: extension APIs are gone; it times out on its own // the WXT navigation listener stays, but onUrl() no-ops once dead
  }

  function handleError(err: unknown, show: (msg: string) => void) {
    if (dead) return;
    if (isInvalidationError(err) || !isContextValid()) return teardown();
    show(err instanceof Error ? err.message : String(err));
  }

  async function onUrl(url: string) {
    if (dead) return;
    if (!isContextValid()) return teardown();

    const page = parsePrUrl(url);
    const key = page ? `${prKey(page)}/${page.tab ?? ''}` : null;
    if (key === lastKey) return; // hash changes / same page
    lastKey = key;

    current?.abort();
    dock.clearAll();
    if (!page) return setTabState('idle');
    const controller = new AbortController();
    current = controller;
    let failed = false;
    setTabState('busy');

    let settings;
    try {
      settings = await loadSettings();
    } catch (err) {
      setTabState('error');
      return handleError(err, (msg) => dock.set('core', { tone: 'error', text: `Pretty PR Review: ${msg}` }));
    }
    if (controller.signal.aborted) return;
    applyColors(settings.colors, settings.features.formatting.fade);

    const runs: Promise<void>[] = [];
    for (const feature of features) {
      if (!settings.features[feature.id].enabled || !feature.appliesTo(page)) continue;
      const status = dock.scope(feature.id);
      const reportError = (err: unknown) => {
        if (controller.signal.aborted && !isInvalidationError(err)) return;
        failed = true;
        if (current === controller) setTabState('error');
        handleError(err, (msg) => status.set({ tone: 'error', text: `${feature.id}: ${msg}` }));
      };
      runs.push(feature.run({ page, settings, dom, status, signal: controller.signal, reportError }).catch(reportError));
    }
    // Busy until every feature's initial pass is done (e.g. moved-code analysis).
    await Promise.allSettled(runs);
    if (current === controller && !failed) setTabState('idle');
  }

  // Orphaned scripts only learn about invalidation when an API call fails, so
  // also poll — otherwise an orphan would keep clicking toggles via the DOM.
  const contextCheck = setInterval(() => {
    if (!isContextValid()) teardown();
  }, CONTEXT_CHECK_MS);

  // Colors and the formatting fade apply live when changed in settings (other settings on the next page load).
  function onStorageChange(changes: Record<string, unknown>, area: string) {
    if (dead || area !== 'sync' || !('settings' in changes)) return;
    loadSettings()
      .then((s) => applyColors(s.colors, s.features.formatting.fade))
      .catch((err: unknown) => handleError(err, (msg) => console.warn('[Pretty PR Review]', msg)));
  }
  browser.storage.onChanged.addListener(onStorageChange);

  pruneAutoViewMemory().catch((err: unknown) => handleError(err, (msg) => console.warn('[Pretty PR Review]', msg)));
  void onUrl(location.href);
  wxt.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => void onUrl(newUrl.href));
  wxt.onInvalidated(teardown);
}
