import { startAutoViewer, type AutoViewer } from '../../core/auto-viewer';
import { COLORS } from '../../core/ui/colors';
import type { Feature } from '../../core/feature';
import { createTestFileMatcher } from '../../core/test-files';
import { isFilesTab, prKey } from '../../github/pr';

/**
 * On the Files changed tab, marks files matching the auto-view patterns
 * (tests + markdown by default) as viewed, tagged "auto".
 */
export const autoViewTests: Feature = {
  id: 'autoViewTests',
  appliesTo: isFilesTab,

  async run({ page, settings, dom, status, signal, reportError }) {
    const matcher = createTestFileMatcher(settings.testPatterns, page.owner, page.repo);
    const cache = new Map<string, boolean>();
    let viewer: AutoViewer | null = null;
    const show = () => {
      const s = viewer?.summary();
      if (s?.parts.length) status.set({ text: `🧪 ${s.parts.join(' · ')}`, actions: s.actions });
    };
    viewer = await startAutoViewer({
      dom,
      signal,
      reportError,
      prKey: prKey(page),
      memory: { userUnviewed: 'userUnviewed', autoViewed: 'autoViewed' },
      attr: 'data-prh-auto-viewed',
      tag: 'auto',
      color: COLORS.autoViewed,
      title: 'Automatically marked as viewed by Pretty PR Review',
      noun: 'test/docs file',
      isCandidate: (path) => {
        let v = cache.get(path);
        if (v === undefined) cache.set(path, (v = matcher(path).isTest));
        return v;
      },
      onChange: show,
    });
    show(); // the first pass ran before `viewer` was assigned
  },
};
