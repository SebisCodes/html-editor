/**
 * Editing text in the preview. A text of the page whose code is exactly what the preview
 * shows (an entity counts as its character) becomes editable on a click, with the cursor where
 * the click was and the code's cursor on the same character.
 *
 * startTextEdit() runs these steps:
 *   1. find the text in the code (text-source.js);
 *   2. where white space collapses, show each run of it as one space (as the page shows it),
 *      so the cursor moves as the reader sees the text, and keep a map back to the code;
 *   3. wrap the text in an editable span and put the cursor where the click was.
 * stopTextEdit() writes the change into the code as one undo step: &, < and > as entities, the
 * entities that were there kept, line breaks as text-breaks.js writes them; Escape cancels.
 */

import { escapeText } from './html-tokens.js?v=3';
import { state, ui, showToast, getNumberInRange } from './state.js?v=2';
import { renderPreview, renderWaitingPreview } from './preview.js?v=4';
import { setCode, addTypingStep } from './history.js?v=4';
import { showCodePosition } from './code-view.js?v=4';
import { formatBreaks } from './text-breaks.js?v=3';
import { getTextSource } from './text-source.js?v=3';

const SPACE = /[ \t\n\r\f]/;
const EDIT_HINT = 'Editing in the preview - Enter: new paragraph, Shift+Enter: new line, Ctrl+Enter or a click elsewhere keeps it, Escape cancels';
let hintShown = false;

/**
 * Makes a text of the preview editable (the steps in the header); nothing happens while
 * another text is edited or when the text is not in the code as shown.
 * @param {Node} node - the text node under the click.
 * @param {number} offset - the place of the click in its text.
 * @returns {void}
 */
export function startTextEdit(node, offset) {
    if (state.textEdit) return;
    const source = getTextSource(node);
    if (!source) return;
    const view = createEditView(node, offset);
    const span = createEditableSpan(view.node);
    state.textEdit = { span, a: source.a, b: source.b, raw: state.code.slice(source.a, source.b), orig: view.orig, shown: view.shown, map: view.map, d: source.d };
    span.focus({ preventScroll: true });
    setEditCursor(view);
    showCodePosition(source.d.starts[getNumberInRange(view.offset + view.base, 0, source.d.text.length)], false);
    if (state.markedElement) state.markedElement.removeAttribute('data-htmleditor-mark');
    if (!hintShown) { hintShown = true; showToast(EDIT_HINT); }
}

/**
 * The text as it is edited.
 * @typedef {object} EditView
 * @property {Node} node - the text node edited (white space at its start and end split off).
 * @property {number} offset - the place of the click in the text node's original text.
 * @property {number} base - how many characters of white space were split off at the start.
 * @property {string} orig - the text node's text.
 * @property {string} shown - the text as edited.
 * @property {number[]} map - for each character of shown (and its end) the index in the decoded text.
 * @property {number} at - the place of the click in shown.
 */

/**
 * Prepares the text node for editing: where white space collapses, the white space at its
 * start and end is split off (the page does not show it) and each run of white space inside
 * is shown as one space; the map leads from there back to the characters of the code.
 * @param {Node} textNode - the text node.
 * @param {number} clickOffset - the place of the click in its text.
 * @returns {EditView} the text as it is edited.
 */
function createEditView(textNode, clickOffset) {
    const style = state.previewDocument.defaultView.getComputedStyle(textNode.parentElement);
    const collapse = style.whiteSpaceCollapse ? style.whiteSpaceCollapse === 'collapse' : /^(normal|nowrap)$/.test(style.whiteSpace);
    let node = textNode, offset = clickOffset, base = 0;
    if (collapse) {
        const lead = /^[ \t\n\r\f]*/.exec(node.data)[0].length, trail = /[ \t\n\r\f]*$/.exec(node.data)[0].length;
        if (trail) node.splitText(node.data.length - trail);
        if (lead) node = node.splitText(lead);
        base = lead;
        offset -= lead;
    }
    const orig = node.data;
    const { shown, map } = collapse ? getCollapsedText(orig, base) : { shown: orig, map: [...Array(orig.length + 1).keys()].map(i => i + base) };
    if (collapse) node.data = shown;
    let at = 0;
    while (at < shown.length && map[at + 1] - base <= offset) at++;
    return { node, offset, base, orig, shown, map, at };
}

/**
 * Returns a text with each run of white space as one space, and for each of its characters
 * the index of the character it stands for.
 * @param {string} text - the text.
 * @param {number} base - the index of the text's first character.
 * @returns {{shown: string, map: number[]}} the text and the map (one more entry for the end).
 */
function getCollapsedText(text, base) {
    let shown = '';
    const map = [];
    for (let i = 0; i < text.length;) {
        map.push(base + i);
        if (SPACE.test(text[i])) {
            shown += ' ';
            while (i < text.length && SPACE.test(text[i])) i++;
        } else shown += text[i++];
    }
    map.push(base + text.length);
    return { shown, map };
}

/**
 * Wraps a text node in an editable span; Enter and Shift+Enter show as they are typed.
 * @param {Node} node - the text node.
 * @returns {HTMLElement} the span.
 */
function createEditableSpan(node) {
    const span = state.previewDocument.createElement('span');
    span.setAttribute('data-htmleditor-edit', '');
    node.replaceWith(span);
    span.append(node);
    span.contentEditable = 'plaintext-only';
    if (span.contentEditable !== 'plaintext-only') span.contentEditable = 'true';
    span.spellcheck = true;
    span.style.whiteSpace = 'pre-wrap';
    return span;
}

/**
 * Puts the cursor of the edited text where the click was.
 * @param {EditView} view - the text as it is edited.
 * @returns {void}
 */
function setEditCursor(view) {
    const selection = state.previewDocument.getSelection(), range = state.previewDocument.createRange();
    range.setStart(view.node, getNumberInRange(view.offset >= view.orig.length ? view.shown.length : view.at, 0, view.shown.length));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Ends the edit in place: writes the change into the code when it is kept, or shows the text
 * as it was.
 * @param {boolean} keep - true to keep the change, false to cancel it.
 * @returns {void}
 */
export function stopTextEdit(keep) {
    const edit = state.textEdit;
    if (!edit) return;
    state.textEdit = null;
    const edited = edit.span.textContent;
    if (!keep || edited === edit.shown) { resetEditedText(edit); renderWaitingPreview(); return; }
    if (state.code.slice(edit.a, edit.b) !== edit.raw) {
        resetEditedText(edit);
        showToast('The code changed meanwhile - the edit was not used');
        renderPreview();
        return;
    }
    const change = getTextChange(edit, edited);
    if (!change) { resetEditedText(edit); renderWaitingPreview(); return; }
    writeTextChange(change);
}

/**
 * Puts the text node back as it was, in place of the editable span.
 * @param {import('./state.js').TextEdit} edit - the edit.
 * @returns {void}
 */
function resetEditedText(edit) {
    const parent = edit.span.parentNode;
    if (!edit.span.isConnected) return;
    edit.span.replaceWith(state.previewDocument.createTextNode(edit.orig));
    parent.normalize();
}

/**
 * A change of the code made by an edit in place.
 * @typedef {object} TextChange
 * @property {number} from - where the changed code starts.
 * @property {number} to - where it ends.
 * @property {string} insert - the new code.
 * @property {number[]|null} endTag - [start, end] of a heading's end tag to be written as </p>.
 */

/**
 * Returns the change of the code for an edited text: the changed part of the text, widened
 * to whole entities (an entity is changed as a whole), as HTML.
 * @param {import('./state.js').TextEdit} edit - the edit.
 * @param {string} edited - the edited text.
 * @returns {TextChange|null} the change, null when the edit only made empty paragraphs.
 */
function getTextChange(edit, edited) {
    const { shown: before, map, d: decoded } = edit;
    let start = 0, tail = 0;
    while (start < before.length && start < edited.length && before[start] === edited[start]) start++;
    while (tail < before.length - start && tail < edited.length - start && before[before.length - 1 - tail] === edited[edited.length - 1 - tail]) tail++;
    const changeStart = map[start], changeEnd = map[before.length - tail];
    const groupStart = decoded.group[changeStart];
    let groupEnd = changeEnd;
    while (groupEnd < decoded.text.length && decoded.group[groupEnd] !== groupEnd) groupEnd++;
    const breaks = formatBreaks(edit.span, edited.slice(start, edited.length - tail), start === 0, edited.slice(edited.length - tail));
    if (breaks.text === '' && changeStart === changeEnd) return null;
    const insert = escapeKeepingNbsp(decoded.text.slice(groupStart, changeStart)) + breaks.text + escapeKeepingNbsp(decoded.text.slice(changeEnd, groupEnd));
    let to = decoded.starts[groupEnd];
    if (breaks.bare && groupEnd === changeEnd) while (state.code[to] === ' ' || state.code[to] === '\t') to++;
    return { from: decoded.starts[groupStart], to, insert, endTag: breaks.endTag };
}

/**
 * Returns text of an entity group as HTML text, a no-break space as &nbsp;.
 * @param {string} text - the text.
 * @returns {string} the escaped text.
 */
function escapeKeepingNbsp(text) {
    return escapeText(text).replace(/\u00a0/g, '&nbsp;');
}

/**
 * Writes the change of an edit into the code as one undo step and puts the code's cursor after
 * it. A new paragraph after the end of a heading is a <p>: the heading's end tag closes it.
 * @param {TextChange} change - the change.
 * @returns {void}
 */
function writeTextChange(change) {
    const code = state.code;
    addTypingStep();
    const after = change.endTag ? code.slice(change.to, change.endTag[0]) + '</p>' + code.slice(change.endTag[1]) : code.slice(change.to);
    setCode(code.slice(0, change.from) + change.insert + after);
    const cursor = change.from + change.insert.length;
    ui.ta.setSelectionRange(cursor, cursor);
    showCodePosition(cursor, false);
}
