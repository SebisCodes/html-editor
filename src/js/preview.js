/**
 * The preview: the page in a frame without scripts (sandbox="allow-same-origin",
 * src/preview.html with a policy that allows no script), drawn from the code.
 *
 * renderPreview() runs these steps:
 *   1. read the code (html.js) and list its problems with the files it misses;
 *   2. put the page (preview-document.js; with a template syntax the view chosen,
 *      preview-views.js) into the frame, keeping the frame's scroll place, with the editor's own
 *      marks styled;
 *   3. draw the problems, the code, the Files tab, the outline, the document settings and the
 *      template's controls again, and frame the element at the code's cursor.
 * While a text of the preview is edited in place, the preview is not drawn; it is drawn once
 * the edit ends.
 */

import { parse } from './html.js?v=7';
import { state, ui, getElements } from './state.js?v=2';
import { getMissingRefs } from './file-refs.js?v=4';
import { checkTemplateSections, convertTemplateTagsToBraces } from './template-tags.js?v=1';
import { TEMPLATE_SYNTAX, createViewDocument } from './preview-views.js?v=1';
import { renderTemplateControls } from './template-panel.js?v=1';
import { connectPreviewDocument } from './preview-events.js?v=4';
import { renderProblems } from './problems.js?v=4';
import { renderCode } from './code-view.js?v=4';
import { renderFilesTab } from './files-tab.js?v=4';
import { renderOutline } from './outline.js?v=4';
import { renderSettingsPanel } from './settings-panel.js?v=4';

/** The frame's page, from the script's own place, so it also holds on the language pages (/de/ …). */
export const PREVIEW_URL = new URL('../preview.html?v=1', import.meta.url).href;
/** The styles of the editor's marks in the preview: the code cursor's element, the edited text, moving a picture, page breaks. */
const EDITOR_CSS = '[data-htmleditor-mark]{outline:2px solid rgba(26,115,232,.85)!important;outline-offset:2px!important}'
    + '[data-htmleditor-edit]{outline:2px solid #1a73e8!important;outline-offset:2px!important;background:rgba(26,115,232,.08)!important;cursor:text!important}'
    + 'img[data-hp]{cursor:grab!important;-webkit-user-drag:none!important;-webkit-touch-callout:none!important}'
    + '[data-htmleditor-swap]{outline:3px solid #c2410c!important;outline-offset:3px!important}'
    + '[data-htmleditor-moving]{opacity:.45!important}[data-htmleditor-drag],[data-htmleditor-drag] *{cursor:grabbing!important}'
    + 'div[style*="break-"]:empty{border-top:2px dashed #8a8f98;margin:1.5em 0}';
export { TEMPLATE_SYNTAX };
/** How long after typing the preview is drawn, in milliseconds. */
export const RENDER_DELAY = 280;
let renderTimer = 0;
let previewWaiting = false;
const elementsByPlace = new Map();
let elementsByPlaceFor = null;

/**
 * Tells whether the frame shows the preview page, and connects the preview's events when its
 * document is new. A command that returns whether it took place: the caller
 * draws only into a ready frame.
 * @returns {boolean} true when the frame holds the preview page.
 */
export function connectPreview() {
    const frameDocument = ui.frame.contentDocument;
    if (!frameDocument || !/\/preview\.html/.test(frameDocument.URL)) return false;
    if (frameDocument !== state.previewDocument) {
        state.previewDocument = frameDocument;
        connectPreviewDocument(frameDocument);
    }
    return true;
}

/**
 * Draws the preview each time its frame loads; a frame that went elsewhere goes back to the
 * preview page.
 * @returns {void}
 */
export function startPreviewFrame() {
    ui.frame.addEventListener('load', () => {
        if (!connectPreview()) { ui.frame.src = PREVIEW_URL; return; }
        renderPreview();
    });
}

/**
 * Draws the preview a little later, marking the stage as computing meanwhile.
 * @param {number} [delay] - milliseconds to wait.
 * @returns {void}
 */
export function startPreviewTimer(delay = RENDER_DELAY) {
    clearTimeout(renderTimer);
    ui.stage.classList.add('computing');
    renderTimer = setTimeout(renderPreview, delay);
}

/**
 * Tells whether the preview waits for drawing (the stage is marked as computing).
 * @returns {boolean} true while a drawing is scheduled.
 */
export function isPreviewScheduled() {
    return ui.stage.classList.contains('computing');
}

/**
 * Draws the preview and the views made from the code (the steps in the header).
 * @returns {void}
 */
export function renderPreview() {
    clearTimeout(renderTimer);
    ui.stage.classList.remove('computing');
    if (state.textEdit) { previewWaiting = true; return; }
    previewWaiting = false;
    state.parsed = parseCode(state.code);
    state.problems = [...state.parsed.problems, ...getMissingFileProblems(), ...getTemplateProblems()].sort((a, b) => a.pos - b.pos);
    if (connectPreview()) {
        try { showPreviewDocument(); } catch (e) { console.error(e); }
    }
    renderProblems();
    renderCode();
    if (!ui.pictures.hidden) renderFilesTab();
    renderOutline();
    renderSettingsPanel();
    renderTemplateControls();
    showCodeElement({ scroll: false });
}

/**
 * Draws the preview when an edit in place held it back.
 * @returns {void}
 */
export function renderWaitingPreview() {
    if (previewWaiting) renderPreview();
}

/**
 * Reads the code; when reading fails, the result is empty with the error as its problem. With a
 * template syntax the tags are read in safe brace form, so every tag reads as text.
 * @param {string} code - the code.
 * @returns {import('./html.js').ParsedHtml} the code as read.
 */
function parseCode(code) {
    try { return parse(convertTemplateTagsToBraces(code, TEMPLATE_SYNTAX), { isTemplate: Boolean(TEMPLATE_SYNTAX) }); } catch (e) {
        console.error(e);
        return { toks: [], elements: [], problems: [{ pos: 0, kind: 'error', msg: 'The preview failed: ' + e.message }], outline: [], refs: [], texts: [], ids: new Map(), complete: false };
    }
}

/**
 * Returns a problem for each reference to a file the document does not have.
 * @returns {import('./html.js').HtmlProblem[]} the problems.
 */
function getMissingFileProblems() {
    return getMissingRefs().map(ref => ({ pos: ref.a, kind: 'error', msg: `The file "${ref.value}" is missing - add it in the Files tab (or drop it into the editor)` }));
}

/**
 * Returns the problems of the template placeholders: sections that stay open, stray or misplaced
 * end tags and tags with a sign outside the syntax.
 * @returns {import('./html.js').HtmlProblem[]} the problems; empty without a template syntax.
 */
function getTemplateProblems() {
    return TEMPLATE_SYNTAX ? checkTemplateSections(state.code, TEMPLATE_SYNTAX) : [];
}

/**
 * Puts the page into the frame with the editor's styles, keeps the frame's scroll place and
 * notes the marked elements.
 * @returns {void}
 */
function showPreviewDocument() {
    const frameDocument = state.previewDocument;
    const page = createViewDocument(state.code, state.parsed);
    const scrolling = frameDocument.scrollingElement;
    const top = scrolling ? scrolling.scrollTop : 0, left = scrolling ? scrolling.scrollLeft : 0;
    state.markedElement = null;
    frameDocument.replaceChild(frameDocument.importNode(page.documentElement, true), frameDocument.documentElement);
    const style = frameDocument.createElement('style');
    style.setAttribute('data-htmleditor', '');
    style.textContent = EDITOR_CSS;
    frameDocument.head.append(style);
    /**
     * Scrolls the frame back to where it was.
     * @returns {void}
     */
    const resetScroll = () => { const scrollingNow = frameDocument.scrollingElement; if (scrollingNow) { scrollingNow.scrollTop = top; scrollingNow.scrollLeft = left; } };
    resetScroll();
    requestAnimationFrame(resetScroll);
    state.previewElements = getElements('[data-hp]', frameDocument);
    state.sourceElements = state.previewElements.map(element => [+element.getAttribute('data-hp'), element]).sort((a, b) => a[0] - b[0]);
}

/**
 * Returns the elements of the code by the place of their start tag. A query that fills a cache: the map is made once per reading of the code.
 * @returns {Map<number, import('./html.js').HtmlElement>} the elements by place.
 */
export function getElementsByPlace() {
    if (elementsByPlaceFor !== state.parsed) {
        elementsByPlace.clear();
        for (const element of state.parsed.elements) elementsByPlace.set(element.a, element);
        elementsByPlaceFor = state.parsed;
    }
    return elementsByPlace;
}

/**
 * Frames the element at the code's cursor in the preview: the innermost element whose code
 * holds the cursor. Only while the code has the focus, unless always is set.
 * @param {object} [options] - how it is framed.
 * @param {boolean} [options.scroll] - true (the default) to scroll the element into sight.
 * @param {boolean} [options.always] - true to frame it also when the code has no focus.
 * @returns {void}
 */
export function showCodeElement({ scroll = true, always = false } = {}) {
    if (state.markedElement) state.markedElement.removeAttribute('data-htmleditor-mark');
    state.markedElement = null;
    const cursor = ui.ta.selectionStart;
    const list = state.sourceElements;
    if (!list.length || !state.parsed || (document.activeElement !== ui.ta && !always)) return;
    const index = findInnermostElement(list, cursor);
    if (index < 0) return;
    const element = list[index][1];
    element.setAttribute('data-htmleditor-mark', '');
    state.markedElement = element;
    if (scroll) element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * Returns the innermost element of the preview whose code holds a place: the last start tag
 * at or before it whose element ends at or after it and is in the page's body.
 * @param {Array<[number, Element]>} list - the marked elements sorted by place.
 * @param {number} place - the place in the code.
 * @returns {number} the index in the list, -1 when no element holds the place.
 */
function findInnermostElement(list, place) {
    let low = 0, high = list.length - 1, best = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (list[middle][0] <= place) { best = middle; low = middle + 1; } else high = middle - 1;
    }
    const elements = getElementsByPlace();
    while (best >= 0) {
        const element = elements.get(list[best][0]);
        const node = list[best][1];
        if (element && element.e >= place && node.isConnected && node.ownerDocument.body?.contains(node)) break;
        best--;
    }
    return best;
}

/**
 * Frames the element at the code's cursor also when the code has no focus, and scrolls to it.
 * @returns {void}
 */
export function showCodeElementNow() {
    showCodeElement({ always: true });
}
