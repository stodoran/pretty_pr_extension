import { defineContentScript } from 'wxt/utils/define-content-script';
import { startRegistry } from '../core/registry';
import { FEATURES } from '../features';

export default defineContentScript({
  // All of github.com: PR pages are often reached via in-page (SPA) navigation,
  // which doesn't re-inject content scripts.
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    startRegistry(ctx, FEATURES);
  },
});
