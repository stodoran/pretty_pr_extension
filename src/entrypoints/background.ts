import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { Rpc, RpcRequest, RpcResponse } from '../core/messaging';
import { forgetTab, setTabState } from '../core/tab-state';
import { analyzeFormatting } from '../formatting/analyze';
import { analyzeMoves } from '../moves/analyze';

type Sender = Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1];
type Handlers = { [K in keyof Rpc]: (params: Rpc[K]['params'], sender: Sender) => Promise<Rpc[K]['result']> };

const handlers: Handlers = {
  analyzeMoves: (params) => analyzeMoves(params),
  analyzeFormatting: (params) => analyzeFormatting(params),
  setTabState: async ({ state }, sender) => (sender.tab?.id === undefined ? null : setTabState(sender.tab.id, state)),
};

export default defineBackground(() => {
  // Toolbar icon opens the settings page.
  browser.action.onClicked.addListener(() => void browser.runtime.openOptionsPage());

  browser.tabs.onRemoved.addListener(forgetTab);

  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (r: RpcResponse) => void) => {
    const { rpc, params } = (msg ?? {}) as Partial<RpcRequest>;
    const handler = rpc && (handlers[rpc] as ((p: unknown, s: Sender) => Promise<unknown>) | undefined);
    if (!handler) return false;
    handler(params, sender).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true; // async response
  });
});
