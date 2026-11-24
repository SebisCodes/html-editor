/**
 * Typing help in the code: the keys of the textarea.
 *
 * Ctrl/Cmd+Z, Shift+Z and Y undo and redo; Ctrl+B, I and U wrap the selection in <strong>,
 * <em> and <u>; Ctrl+Enter frames the cursor's element in the preview; Ctrl+/ comments lines
 * in or out; Escape leaves the code. Tab indents (Shift+Tab outdents) the selected lines; Enter
 * keeps the indentation (deeper after a start tag, the end tag on a line of its own between
 * two tags); ">" at the end of a start tag adds its end tag; "</" closes the open element;
 * quotes and brackets typed over a selection go around it.
 */

import { parse } from './html.js?v=8';
import { VOID } from './html-tokens.js?v=3';
import { state, ui } from './state.js?v=2';
import { undo, redo } from './history.js?v=10';
import { showCodeElementNow } from './preview.js?v=10';
import { setCodeRange, addTagAroundSelection } from './code-insert.js?v=10';

const INDENT = '  ';
/** Characters that go around a selection, with their closing partner. */
const PAIRS = { '"': '"', "'": "'", '(': ')', '[': ']', '{': '}' };

/**
 * Connects the typing help to the textarea.
 * @returns {void}
 */
export function startTyping() {
    ui.ta.addEventListener('keydown', handleCodeKey);
}

/**
 * Handles a key in the code (a keydown handler): the shortcuts first, then the typing help.
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function handleCodeKey(event) {
    if (runCodeShortcut(event)) return;
    const textarea = ui.ta;
    const value = textarea.value, start = textarea.selectionStart, end = textarea.selectionEnd;
    if (event.key === 'Tab') { event.preventDefault(); setLineIndent(event.shiftKey, value, start, end); return; }
    if (event.key === 'Enter' && !(event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); addLineBreak(value, start, end); return; }
    if (event.key === '>' && start === end && !event.isComposing && addEndTag(event, value, start)) return;
    if (event.key === '/' && start === end && value[start - 1] === '<' && !/[A-Za-z]/.test(value[start] || '') && closeOpenElement(event, value, start)) return;
    if (PAIRS[event.key] && start !== end && !event.isComposing) {
        event.preventDefault();
        setCodeRange(start, end, event.key + value.slice(start, end) + PAIRS[event.key], start + 1, end + 1);
    }
}

/**
 * Runs the shortcuts of the code. A command that returns whether it took place:
 * the typing help then does nothing.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true when the key was a shortcut.
 */
function runCodeShortcut(event) {
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (modifier && !event.altKey && (key === 'z' || key === 'Z')) { event.preventDefault(); event.shiftKey ? redo() : undo(); return true; }
    const commands = { y: redo, b: () => addTagAroundSelection('strong'), i: () => addTagAroundSelection('em'), u: () => addTagAroundSelection('u'), Enter: showCodeElementNow, '/': applyLineCommentSwitch };
    if (modifier && Object.hasOwn(commands, key)) { event.preventDefault(); commands[key](); return true; }
    if (key === 'Escape') { ui.ta.blur(); return true; }
    return false;
}

/**
 * Indents the selected lines by two spaces, or outdents them; without a selection Tab
 * inserts two spaces.
 * @param {boolean} outdent - true for Shift+Tab.
 * @param {string} value - the code.
 * @param {number} start - the selection's start.
 * @param {number} end - its end.
 * @returns {void}
 */
function setLineIndent(outdent, value, start, end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    if (start === end && !outdent) { setCodeRange(start, end, INDENT); return; }
    const lineEnd = value.indexOf('\n', end - (end > start && value[end - 1] === '\n' ? 1 : 0));
    const blockEnd = lineEnd < 0 ? value.length : lineEnd;
    const lines = value.slice(lineStart, blockEnd).split('\n');
    const changed = lines.map(line => (outdent ? line.replace(/^ {1,2}|^\t/, '') : INDENT + line)).join('\n');
    setCodeRange(lineStart, blockEnd, changed, lineStart, lineStart + changed.length);
}

/**
 * Inserts a new line with the line's indentation: between <tag> and </tag> the new line one
 * level deeper and the end tag on a line of its own; after a start tag that stays open one
 * level deeper.
 * @param {string} value - the code.
 * @param {number} start - the selection's start.
 * @param {number} end - its end.
 * @returns {void}
 */
function addLineBreak(value, start, end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(value.slice(lineStart))[0];
    const before = value.slice(lineStart, start);
    if (start === end && /<[A-Za-z][^<>]*>$/.test(before) && /^<\/[A-Za-z]/.test(value.slice(start))) {
        setCodeRange(start, end, '\n' + indent + INDENT + '\n' + indent, start + 1 + indent.length + INDENT.length);
        return;
    }
    const openTag = /<([A-Za-z][\w-]*)(?:\s[^<>]*)?>\s*$/.exec(before);
    if (openTag && start === end && !VOID.has(openTag[1].toLowerCase()) && !/\/>\s*$/.test(before)) { setCodeRange(start, end, '\n' + indent + INDENT); return; }
    setCodeRange(start, end, '\n' + indent);
}

/**
 * Adds the end tag when ">" closes a start tag at the end of a line, unless the element is
 * void, closes itself, is inside script or style, or its end tag follows further down. A
 * command that returns whether it took place: otherwise ">" is typed as usual.
 * @param {KeyboardEvent} event - the key.
 * @param {string} value - the code.
 * @param {number} cursor - the cursor.
 * @returns {boolean} true when the end tag was added.
 */
function addEndTag(event, value, cursor) {
    const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
    const tag = /<([A-Za-z][\w-]*)(?:\s[^<>]*)?$/.exec(value.slice(lineStart, cursor));
    const lineEnd = value.indexOf('\n', cursor);
    const rest = value.slice(cursor, lineEnd < 0 ? value.length : lineEnd);
    const quotes = (tag ? tag[0].match(/["']/g) || [] : []).length;
    if (!tag || rest.trim() || quotes % 2 !== 0 || /\/$/.test(value.slice(lineStart, cursor)) || VOID.has(tag[1].toLowerCase())) return false;
    const name = tag[1];
    const after = value.slice(cursor);
    const opens = (after.match(new RegExp('<' + escapeRegExp(name) + '(?=[\\s>/])', 'gi')) || []).length;
    const closes = (after.match(new RegExp('</' + escapeRegExp(name) + '\\s*>', 'gi')) || []).length;
    if (closes > opens || /^(script|style)$/i.test(findOpenElementAt(lineStart)?.name || '')) return false;
    event.preventDefault();
    setCodeRange(cursor, cursor, `></${name}>`, cursor + 1);
    return true;
}

/**
 * Closes the open element when "/" follows "<" (except <html>). A command that returns whether
 * it took place: otherwise "/" is typed as usual.
 * @param {KeyboardEvent} event - the key.
 * @param {string} value - the code.
 * @param {number} cursor - the cursor, after the "<".
 * @returns {boolean} true when the end tag was written.
 */
function closeOpenElement(event, value, cursor) {
    const element = findOpenElementAt(cursor - 1);
    if (!element || element.name === 'html') return false;
    event.preventDefault();
    setCodeRange(cursor, cursor, `/${value.slice(element.a + 1, element.tok.nameEnd)}>`);
    return true;
}

/**
 * Returns text with the characters that mean something in a regular expression escaped.
 * @param {string} text - the text.
 * @returns {string} the escaped text.
 */
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the innermost element that is still open at a place (for "</" and ">").
 * @param {number} place - the place in the code.
 * @returns {import('./html.js').HtmlElement|null} the element, null when none is open.
 */
function findOpenElementAt(place) {
    const parsed = parse(state.code.slice(0, place));
    let best = null;
    for (const element of parsed.elements) {
        if (element.e === place && !VOID.has(element.name) && !element.tok.self && (!best || element.a > best.a)) best = element;
    }
    return best;
}

/**
 * Comments the selected lines in or out, one <!-- … --> per line: out when every line with
 * text is a comment, else in.
 * @returns {void}
 */
export function applyLineCommentSwitch() {
    const textarea = ui.ta, value = textarea.value, start = textarea.selectionStart, end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = value.indexOf('\n', end - (end > start && value[end - 1] === '\n' ? 1 : 0));
    const lineEnd = nextBreak < 0 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const allComments = lines.every(line => !line.trim() || /^\s*<!--[\s\S]*-->\s*$/.test(line));
    const changed = lines.map(line => (!line.trim() ? line : allComments ? line.replace(/^(\s*)<!-- ?([\s\S]*?) ?-->\s*$/, '$1$2') : line.replace(/^(\s*)(.*)$/, '$1<!-- $2 -->'))).join('\n');
    setCodeRange(lineStart, lineEnd, changed, lineStart, lineStart + changed.length);
}
