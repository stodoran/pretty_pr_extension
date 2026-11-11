import { browser } from 'wxt/browser';
import type { TabState } from './messaging';

/** Background-worker side of the toolbar indicator (per tab). */

const DEFAULT_TITLE = 'Pretty PR Review — click for settings';
const FRAMES = ['·', '··', '···'];
const MAX_BUSY_MS = 60_000; // never leave a spinner behind if the page goes away mid-work
const timers = new Map<number, ReturnType<typeof setInterval>>();

export async function setTabState(tabId: number, state: TabState): Promise<null> {
  clearInterval(timers.get(tabId));
  timers.delete(tabId);
  const { action } = browser;

  if (state === 'busy') {
    const started = Date.now();
    let frame = 0;
    const tick = () => {
      if (Date.now() - started > MAX_BUSY_MS) return void setTabState(tabId, 'idle');
      action.setBadgeText({ tabId, text: FRAMES[frame++ % FRAMES.length] }).catch(() => setTabState(tabId, 'idle'));
    };
    await action.setBadgeBackgroundColor({ tabId, color: '#8250df' });
    await action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
    await action.setTitle({ tabId, title: 'Pretty PR Review — working…' });
    tick();
    timers.set(tabId, setInterval(tick, 300));
  } else if (state === 'error') {
    await action.setBadgeBackgroundColor({ tabId, color: '#cf222e' });
    await action.setBadgeText({ tabId, text: '!' });
    await action.setTitle({ tabId, title: 'Pretty PR Review — something went wrong (see the note on the page)' });
  } else {
    await action.setBadgeText({ tabId, text: '' });
    await action.setTitle({ tabId, title: DEFAULT_TITLE });
  }
  return null;
}

/** Tab closed: drop its timer. */
export function forgetTab(tabId: number) {
  clearInterval(timers.get(tabId));
  timers.delete(tabId);
}
