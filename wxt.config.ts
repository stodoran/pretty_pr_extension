import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Non-hidden so it's visible in Chrome's "Load unpacked" file picker.
  outDir: 'dist',
  manifest: {
    name: 'Pretty PR Review',
    description: 'Calmer GitHub PR reviews: auto-views tests and docs, highlights moved functions.',
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: 'Pretty PR Review — click for settings',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' },
    },
    permissions: ['storage'],
    // Background fetches of PR diffs / raw files with the user's session (moved-function detection).
    host_permissions: [
      'https://github.com/*',
      'https://patch-diff.githubusercontent.com/*',
      'https://raw.githubusercontent.com/*',
    ],
  },
});
