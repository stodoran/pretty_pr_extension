/** Whether the PR's diffs are shown split (side by side) or unified, as the reader set it on GitHub. */
export function diffViewMode(): 'split' | 'unified' {
  // Rendered diff rows show the current mode, including a change made since the page loaded.
  for (const row of document.querySelectorAll('table[role="grid"] tr.diff-line-row')) {
    const cells = row.querySelectorAll('td.diff-text-cell').length;
    if (cells) return cells > 1 ? 'split' : 'unified';
  }
  const param = new URLSearchParams(location.search).get('diff');
  if (param === 'split' || param === 'unified') return param;
  // Nothing rendered yet: the saved preference in the page's embedded data.
  for (const script of document.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
    const m = /"splitPreference":"(split|unified)"/.exec(script.textContent ?? '');
    if (m) return m[1] as 'split' | 'unified';
  }
  return 'split';
}
