import { browser } from 'wxt/browser';

/**
 * When the extension is reloaded/updated, content scripts already running in
 * open tabs are orphaned: DOM access still works, but every extension API call
 * throws "Extension context invalidated". These helpers let the orphan detect
 * that and shut down quietly.
 */
export function isContextValid(): boolean {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
}

export function isInvalidationError(err: unknown): boolean {
  return err instanceof Error && /extension context invalidated/i.test(err.message);
}
