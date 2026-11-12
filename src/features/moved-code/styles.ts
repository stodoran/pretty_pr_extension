import { COLORS } from '../../core/ui/colors';
/**
 * Page-level stylesheet for move decorations. Cells only get data-attributes
 * (React leaves unknown attributes alone); everything visual lives here.
 * The two class names used (`new-diff-line-number`, `diff-text-cell`) are
 * GitHub's plain, non-hashed classes on diff cells.
 */
const CSS = `
td[data-prh-move="moved"] { --prh-move-color: ${COLORS.moved}; }
td[data-prh-move="moved-modified"] { --prh-move-color: ${COLORS.movedModified}; }
td[data-prh-move] { --prh-move-tint: color-mix(in srgb, var(--prh-move-color) 8%, transparent); }
/* Like GitHub's selected-line highlight: a translucent tint layered over the
   cell's own background, so add/remove colors still show through. */
td.new-diff-line-number[data-prh-move], td.diff-text-cell[data-prh-move] {
  background-image: linear-gradient(var(--prh-move-tint), var(--prh-move-tint));
}
td.new-diff-line-number[data-prh-move] { box-shadow: inset 3px 0 0 var(--prh-move-color); }
td.diff-text-cell[data-prh-dim] .diff-text-inner { opacity: 0.88; } /* only the code text, not the background */
td.diff-text-cell[data-prh-label] { position: relative; }
td.diff-text-cell[data-prh-label-hover] { cursor: pointer; }
td.diff-text-cell[data-prh-label]::after {
  content: attr(data-prh-label);
  position: absolute; top: 50%; transform: translateY(-50%); right: 36px; z-index: 2; /* clear of GitHub's line-hover menu */
  padding: 0 8px; border-radius: 10px;
  font: 600 11px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #fff; background: var(--prh-move-color);
  white-space: nowrap; pointer-events: none;
}
td.diff-text-cell[data-prh-label-hover]::after { filter: brightness(1.15); box-shadow: 0 0 0 2px var(--bgColor-default, #fff), 0 0 0 3px var(--prh-move-color); }
`;

/** Labels are ::after pseudo-elements (no DOM nodes inside React-managed cells); hit-test them by geometry. */
export function isOverLabel(cell: HTMLElement, x: number, y: number): boolean {
  const after = getComputedStyle(cell, '::after');
  if (!after.content || after.content === 'none') return false;
  const rect = cell.getBoundingClientRect();
  const right = rect.right - parseFloat(after.right || '0');
  const width = parseFloat(after.width) + parseFloat(after.paddingLeft) + parseFloat(after.paddingRight);
  const height = parseFloat(after.lineHeight) || 18;
  const top = rect.top + parseFloat(after.top || '0') - height / 2; // centered: translateY(-50%)
  return x >= right - width && x <= right && y >= top && y <= top + height;
}

export function injectMoveStyles(): () => void {
  const style = document.createElement('style');
  style.id = 'pr-review-helper-moves';
  style.textContent = CSS;
  document.head.append(style);
  return () => style.remove();
}
