/**
 * The editor's state and the parts every module shares: the open document's code and what
 * was read from it, its files, the undo history, the page elements, the areas set up at start
 * (line wrap, "My documents", sync …) and a few small helpers.
 *
 * The code is the single source of truth: the preview, the problems, the outline and the
 * document settings are made from it, and every change goes through setCode() (history.js).
 *
 * The field names code, name, fileId, assets, problems and history are read by the tests
 * through window.htmlEditor.state.
 */

/** The prefix of the storage keys and messages. */
export const PREFIX = 'htmleditor';
/** The width below which the editor shows one view at a time. */
export const NARROW_SCREEN = matchMedia('(max-width: 860px)');
/** The height of a line of code in pixels. */
export const LINE_HEIGHT = 20;
/** The name of a document without one. */
export const DEFAULT_NAME = 'Document';
/** How long a toast stays, in milliseconds. */
const TOAST_TIME = 2600;
let toastTimer = 0;

/**
 * A step of the undo history.
 * @typedef {object} HistoryStep
 * @property {string} code - the code.
 * @property {number} sel - the cursor in the code.
 * @property {string[]} [rename] - [old name, new name] of a file renamed with this step.
 */

/**
 * A text of the preview being edited in place (text-edit.js).
 * @typedef {object} TextEdit
 * @property {HTMLElement} span - the editable span around the text in the preview.
 * @property {number} a - where the text starts in the code.
 * @property {number} b - where it ends.
 * @property {string} raw - the code of the text when the edit started.
 * @property {string} orig - the text node's text as it was.
 * @property {string} shown - the text as edited: each run of collapsing white space as one space.
 * @property {number[]} map - for each character of shown (and its end) the index in the decoded text.
 * @property {import('./html-tokens.js').DecodedRange} d - the decoded text of the code.
 */

/**
 * The editor's state.
 * @typedef {object} EditorState
 * @property {string} code - the open document's code.
 * @property {import('./html.js').ParsedHtml|null} parsed - the code as read.
 * @property {import('./html.js').HtmlProblem[]} problems - the problems of the code and the missing files, sorted by place.
 * @property {Array<[number, Element]>} sourceElements - the preview's marked elements with the place of their start tag, sorted by place.
 * @property {Element[]} previewElements - the preview's marked elements in document order.
 * @property {number} split - the share of the width the code takes.
 * @property {string} previewWidth - the width of the preview: "fill", "768" or "390".
 * @property {string} name - the document's name.
 * @property {string} fileId - the document's id in "My documents", "" for none.
 * @property {Object<string, string>} assets - the document's files: name -> data URI.
 * @property {HistoryStep[]} history - the undo steps; the last one is the current code.
 * @property {HistoryStep[]} future - the redo steps.
 * @property {number} historyTimer - the timer that makes an undo step of typing.
 * @property {boolean} showProblems - true when the list of problems is open.
 * @property {Element|null} markedElement - the element of the preview framed for the code cursor.
 * @property {string|null} savedCode - the code as this tab last read or stored it.
 * @property {Document|null} previewDocument - the document of the preview frame.
 * @property {TextEdit|null} textEdit - the text being edited in the preview, null when none.
 */

/** @type {EditorState} */
export const state = {
    code: '', parsed: null, problems: [], sourceElements: [], previewElements: [],
    split: 0.5, previewWidth: 'fill',
    name: DEFAULT_NAME, fileId: '', assets: {},
    history: [], future: [], historyTimer: 0,
    showProblems: true, markedElement: null,
    savedCode: null, previewDocument: null, textEdit: null,
};

/**
 * Returns the first element that matches a selector.
 * @param {string} selector - the CSS selector.
 * @param {ParentNode} [root] - where to search.
 * @returns {Element|null} the element.
 */
export function getElement(selector, root = document) {
    return root.querySelector(selector);
}

/**
 * Returns every element that matches a selector.
 * @param {string} selector - the CSS selector.
 * @param {ParentNode} [root] - where to search.
 * @returns {Element[]} the elements.
 */
export function getElements(selector, root = document) {
    return [...root.querySelectorAll(selector)];
}

/** The elements of the page the modules work with. */
export const ui = {
    ta: getElement('#code'), hl: getElement('#hl'), marks: getElement('#marks'), gutter: getElement('#gutter'),
    status: getElement('#code-status'), error: getElement('#code-error'),
    stage: getElement('#stage'), scroller: getElement('#scroller'), frame: getElement('#preview'),
    inspector: getElement('#inspector-body'), insert: getElement('#insert-wrap'), tree: getElement('#tree'),
    pictures: getElement('#pics-wrap'), work: getElement('#work'), toast: getElement('#toast'),
};

/**
 * The areas set up at start; each is null until it is.
 * @type {{i18n: object|null, lineWrap: object|null, files: object|null, sync: object|null, ai: object|null, aiStatus: object|null}}
 */
export const areas = { i18n: null, lineWrap: null, files: null, sync: null, ai: null, aiStatus: null };

/**
 * Shows a short message at the bottom of the editor.
 * @param {string} message - the message.
 * @returns {void}
 */
export function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('shown'), TOAST_TIME);
}

/**
 * Returns a number limited to a range.
 * @param {number} value - the number.
 * @param {number} min - the smallest value.
 * @param {number} max - the largest value.
 * @returns {number} the number within [min, max].
 */
export function getNumberInRange(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Returns how many of the document's problems are errors.
 * @returns {number} the number of errors.
 */
export function getErrorCount() {
    return state.problems.filter(problem => problem.kind === 'error').length;
}
