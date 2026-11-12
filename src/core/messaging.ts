import { browser } from 'wxt/browser';
import type { FormattingResult } from '../formatting/analyze';
import type { ReadableJson } from '../json/diff';
import type { ReadableJsonParams } from '../json/analyze';
import type { MovesResult } from '../moves/analyze';

/**
 * Typed RPC from content scripts to the background worker, which can fetch
 * cross-origin (diff / raw file hosts) with the user's GitHub session.
 */
export interface Rpc {
  analyzeMoves: {
    params: { owner: string; repo: string; number: number; headOid: string | null };
    result: MovesResult;
  };
  analyzeFormatting: {
    params: { owner: string; repo: string; number: number };
    result: FormattingResult;
  };
  /** One JSON file's two versions, formatted and diffed. */
  readableJson: { params: ReadableJsonParams; result: ReadableJson };
  /** Toolbar badge for the calling tab: animated while features are working, "!" after an error. */
  setTabState: { params: { state: TabState }; result: null };
}

export type TabState = 'busy' | 'idle' | 'error';

export type Method = keyof Rpc;
export type RpcRequest = { [K in Method]: { rpc: K; params: Rpc[K]['params'] } }[Method];
export type RpcResponse = { ok: true; data: unknown } | { ok: false; error: string };

export async function call<K extends Method>(rpc: K, params: Rpc[K]['params']): Promise<Rpc[K]['result']> {
  const res = (await browser.runtime.sendMessage({ rpc, params })) as RpcResponse | undefined;
  if (!res) throw new Error('No response from background worker');
  if (!res.ok) throw new Error(res.error);
  return res.data as Rpc[K]['result'];
}
