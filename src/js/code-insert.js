/**
 * Changing the code at the cursor as typing does: replacing a range (it stays in the browser's
 * own undo and assistive technology), wrapping the selection in a tag and inserting snippets.
 */

import { state, ui } from './state.js?v=2';
import { addHistoryStep } from './history.js?v=4';
import { showCodeElement } from './preview.js?v=4';

/** Where the cursor goes in a snippet. */
const CURSOR_MARK = '|';
/** Where the selected text goes in a snippet. */
const SELECTION_MARK = '§';
const INDENT = '  ';
/** An end tag of body, head or html right at the cursor; read on the next few characters only. */
const DOCUMENT_END_TAG = /^<\/(body|head|html)\b/i;
/** How many characters the end tag needs: "</body" and the one after it. */
const DOCUMENT_END_TAG_LENGTH = 7;

/**
 * Replaces a range of the code as typing would and sets the cursor; where execCommand does
 * not work, the text is set directly and an input event follows.
 * @param {number} start - the start of the range.
 * @param {number} end - its end.
 * @param {string} text - the new text.
 * @param {number} [selectionStart] - where the selection starts afterwards.
 * @param {number} [selectionEnd] - where it ends (selectionStart when left out).
 * @returns {void}
 */
export function setCodeRange(start, end, text, selectionStart, selectionEnd) {
    const textarea = ui.ta;
    if (document.activeElement !== textarea) textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
        textarea.setRangeText(text, start, end, 'end');
        textarea.dispatchEvent(new Event('input'));
    }
    if (selectionStart != null) textarea.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
}

/**
 * Wraps the selection in a tag (<strong>selection</strong>); without a selection the cursor
 * lands between the tags. One undo step.
 * @param {string} tag - the element name.
 * @returns {void}
 */
export function addTagAroundSelection(tag) {
    const start = ui.ta.selectionStart, end = ui.ta.selectionEnd;
    const selected = state.code.slice(start, end);
    const startTag = `<${tag}>`;
    setCodeRange(start, end, startTag + selected + `</${tag}>`, start + startTag.length, start + startTag.length + selected.length);
    addHistoryStep();
}

/**
 * Inserts a snippet at the cursor: "|" marks where the cursor goes, "§" stands for the
 * selected text. Block snippets start on a new line; snippets for the head go before </head>;
 * without a cursor in the code a snippet goes before </body>; before </body> or </head> on a
 * line of its own it goes on new lines, one level deeper. One undo step.
 * @param {string} snippet - the snippet.
 * @param {boolean} [block] - true for a snippet on lines of its own.
 * @param {boolean} [head] - true for a snippet of the head.
 * @returns {void}
 */
export function addSnippet(snippet, block = false, head = false) {
    const code = state.code;
    const [start, end] = getInsertRange(head);
    const text = snippet.replace(SELECTION_MARK, (head ? '' : code.slice(start, end)) || '');
    const lineStart = code.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(code.slice(lineStart))[0];
    if (start === end && !code.slice(lineStart, start).trim() && DOCUMENT_END_TAG.test(code.slice(start, start + DOCUMENT_END_TAG_LENGTH))) {
        addBeforeEndTagLine(text, lineStart, indent);
        return;
    }
    const placed = block || head ? formatOwnLines(text, start, end, lineStart, indent) : text;
    let cursor = placed.indexOf(CURSOR_MARK);
    const inserted = placed.replace(CURSOR_MARK, '');
    if (cursor < 0) cursor = inserted.length;
    setCodeRange(start, end, inserted, start + cursor);
    addHistoryStep();
    showCodeElement();
}

/**
 * Returns the range a snippet replaces: before </head> for the head, before </body> without a
 * cursor in the code, else the selection.
 * @param {boolean} head - true for a snippet of the head.
 * @returns {number[]} [start, end].
 */
function getInsertRange(head) {
    const textarea = ui.ta;
    let start = textarea.selectionStart, end = textarea.selectionEnd;
    const headEnd = state.code.search(/<\/head\s*>/i);
    if (head && headEnd >= 0) start = end = headEnd;
    else if (document.activeElement !== textarea && start === 0 && end === 0) {
        const bodyEnd = state.code.toLowerCase().lastIndexOf('</body');
        if (bodyEnd >= 0) start = end = bodyEnd;
    }
    return [start, end];
}

/**
 * Inserts a snippet on new lines before an end tag that stands on a line of its own, one level
 * deeper than it.
 * @param {string} text - the snippet with its cursor mark.
 * @param {number} lineStart - where the end tag's line starts.
 * @param {string} indent - the end tag's indentation.
 * @returns {void}
 */
function addBeforeEndTagLine(text, lineStart, indent) {
    let lines = text.split('\n').map(line => indent + INDENT + line).join('\n') + '\n';
    let cursor = lines.indexOf(CURSOR_MARK);
    lines = lines.replace(CURSOR_MARK, '');
    if (cursor < 0) cursor = lines.length - 1;
    setCodeRange(lineStart, lineStart, lines, lineStart + cursor);
    addHistoryStep();
    showCodeElement();
}

/**
 * Returns a block snippet indented as the cursor's line, on a new line when text stands before
 * the cursor, with a new line after it when text follows.
 * @param {string} text - the snippet.
 * @param {number} start - the start of the range it replaces.
 * @param {number} end - its end.
 * @param {number} lineStart - where the cursor's line starts.
 * @param {string} indent - the line's indentation.
 * @returns {string} the snippet as inserted.
 */
function formatOwnLines(text, start, end, lineStart, indent) {
    const code = state.code;
    let placed = text.split('\n').map((line, index) => (index ? indent + line : line)).join('\n');
    if (code.slice(lineStart, start).trim()) placed = '\n' + indent + placed;
    const lineEnd = code.indexOf('\n', end);
    if (code.slice(end, lineEnd < 0 ? code.length : lineEnd).trim()) placed += '\n' + indent;
    return placed;
}
