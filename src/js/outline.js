/**
 * The Structure tab of the side panel: the headings of the page as an outline. A click shows
 * the heading in the preview (on narrow screens the preview pane) and puts the code's cursor
 * at it.
 */

import { escapeHtml } from './html-tokens.js?v=3';
import { state, ui, NARROW_SCREEN } from './state.js?v=2';
import { renderPreview, isPreviewScheduled } from './preview.js?v=6';
import { showCodePosition } from './code-view.js?v=6';
import { showPane } from './layout.js?v=6';

/**
 * Draws the outline of the headings, indented by their level below the highest one.
 * @returns {void}
 */
export function renderOutline() {
    const outline = state.parsed ? state.parsed.outline : [];
    if (!outline.length) { ui.tree.innerHTML = '<li class="muted" style="padding:8px">No headings yet - add one with &lt;h1&gt; … &lt;h6&gt;.</li>'; return; }
    const top = Math.min(...outline.map(heading => heading.level));
    ui.tree.innerHTML = outline.map((heading, index) => `<li class="lv${heading.level - top + 1}"><button type="button" class="choice" style="--t:${heading.level - top}" data-i="${index}" data-no-i18n><span class="num">h${heading.level}</span><span>${escapeHtml(heading.title)}</span></button></li>`).join('');
}

/**
 * Connects the outline's buttons.
 * @returns {void}
 */
export function startOutline() {
    ui.tree.addEventListener('click', showClickedHeading);
}

/**
 * Shows a heading of the outline in the preview and the code (a click handler); the places
 * are those of the code as it is, so a waiting preview is drawn first.
 * @param {MouseEvent} event - the click.
 * @returns {void}
 */
function showClickedHeading(event) {
    const button = event.target.closest('[data-i]');
    if (!button) return;
    if (isPreviewScheduled()) renderPreview();
    const heading = state.parsed.outline[+button.dataset.i];
    if (!heading) return;
    if (NARROW_SCREEN.matches) showPane('draw');
    showCodePosition(heading.pos, !NARROW_SCREEN.matches);
    const element = state.previewDocument?.querySelector(`[data-hp="${heading.pos}"]`);
    if (element) element.scrollIntoView({ block: 'start' });
}
