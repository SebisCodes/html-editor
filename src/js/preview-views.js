/**
 * The two views of a template's preview (?template=): the example view, the template filled with
 * the page's examples (the default), and the template view, the tags shown as their text.
 *
 * createViewDocument() runs these steps:
 *   1. without a template syntax, or in the template view, the page as written
 *      (preview-document.js);
 *   2. in the example view, fill the template (html-examples.js), mark its elements with their
 *      places in the code and hold back the addresses that held a placeholder, then let the
 *      browser read it; when filling fails, the template view is shown with a note.
 * The code and what is made of it (the page as one file, the ZIP, the text) are the template as
 * written; print follows the view shown and names it in its title.
 */

import { state, areas } from './state.js?v=2';
import { getTemplateSyntax, getTemplateNameByAddress } from './template-tags.js?v=1';
import { buildViewTitle } from './template-controls.js?v=1';
import { buildHtmlView, buildExampleSource } from './html-examples.js?v=1';
import { createPreviewDocument, createExamplePreviewDocument } from './preview-document.js?v=4';
import { getHeldPreviewCss } from './file-refs.js?v=4';

/** The template syntax of the placeholders the address asks for with ?template=, or null. */
export const TEMPLATE_SYNTAX = getTemplateSyntax(getTemplateNameByAddress(location.search));
/** The view that shows the template filled with the examples. */
export const EXAMPLE_VIEW = 'example';
/** The view that shows the tags as their text. */
export const TEMPLATE_VIEW = 'template';

/** The state of the views: the view chosen, whether the example view could not be made, and the map of the example view shown. */
const views = { mode: EXAMPLE_VIEW, failed: false, map: null };

/**
 * Returns the view chosen.
 * @returns {string} EXAMPLE_VIEW or TEMPLATE_VIEW.
 */
export function getViewMode() {
    return views.mode;
}

/**
 * Sets the view chosen.
 * @param {string} mode - EXAMPLE_VIEW or TEMPLATE_VIEW.
 * @returns {void}
 */
export function setViewMode(mode) {
    views.mode = mode === TEMPLATE_VIEW ? TEMPLATE_VIEW : EXAMPLE_VIEW;
}

/**
 * Tells whether the preview shows the example view.
 * @returns {boolean} true with a template syntax, the example view chosen and made.
 */
export function isExampleViewShown() {
    return Boolean(TEMPLATE_SYNTAX) && views.mode === EXAMPLE_VIEW && !views.failed;
}

/**
 * Tells whether the example view was chosen but could not be made.
 * @returns {boolean} true while the template view stands in for it.
 */
export function isExampleViewFailed() {
    return Boolean(TEMPLATE_SYNTAX) && views.mode === EXAMPLE_VIEW && views.failed;
}

/**
 * Returns the page's examples for the open document.
 * @returns {?import('./template-examples.js').TemplateExamples} the examples, null without a page or away from its document.
 */
export function getTemplateExamples() {
    return areas.sync?.getTemplate() || null;
}

/**
 * Returns the page as a document for the preview or for printing (the steps in the header).
 * @param {string} code - the code.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @returns {Document} the document, not yet in a frame.
 */
export function createViewDocument(code, parsed) {
    views.failed = false;
    views.map = null;
    if (!TEMPLATE_SYNTAX || views.mode === TEMPLATE_VIEW) return createPreviewDocument(code, parsed, TEMPLATE_SYNTAX);
    const examples = getTemplateExamples();
    try {
        const view = buildHtmlView(code, parsed, TEMPLATE_SYNTAX, examples);
        views.map = view.map;
        /**
         * Returns the blob: address of an example picture by name.
         * @param {string} name - the picture's name.
         * @returns {?string} the address, null for an unknown name.
         */
        const getExampleAddress = name => (examples ? examples.getPictureAddress(name) : null);
        return createExamplePreviewDocument(buildExampleSource(code, parsed, view, css => getHeldPreviewCss(css, getExampleAddress)), code, parsed, examples);
    } catch (error) {
        console.error(error);
        views.failed = true;
        views.map = null;
        return createPreviewDocument(code, parsed, TEMPLATE_SYNTAX);
    }
}

/**
 * Returns the map of the example view the preview shows, for editing text in place.
 * @returns {?import('./template-expansion.js').ViewSegment[]} the map, null outside the example view.
 */
export function getExampleMap() {
    return views.map;
}

/**
 * Returns the page as written for what is made of the code (its text), while the preview shows
 * the example view.
 * @returns {?Document} the template's document in the example view, null when the preview shows the code as written.
 */
export function getTemplateDocument() {
    return isExampleViewShown() && state.parsed ? createPreviewDocument(state.code, state.parsed, TEMPLATE_SYNTAX) : null;
}

/**
 * Returns the title of a print of the view shown: the document's name, with a template syntax
 * followed by the view it shows.
 * @param {string} name - the document's name.
 * @returns {string} the title, e.g. "Letter (example view)".
 */
export function getViewTitle(name) {
    if (!TEMPLATE_SYNTAX) return name;
    return buildViewTitle(name, isExampleViewShown() ? EXAMPLE_VIEW : TEMPLATE_VIEW, text => areas.i18n?.translate(text) ?? text);
}
