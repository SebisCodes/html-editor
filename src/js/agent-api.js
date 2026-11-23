/**
 * What the AI prompt (ai.js) and the WebMCP tools (mcp.js) get from the editor: the document as
 * they see it, its problems and elements, the user's documents, and the changes the tools make
 * (each an undo step).
 */

import { getAttributeValue, getDecodedText } from './html-tokens.js?v=3';
import { store } from './files.js?v=10';
import { state, ui, areas } from './state.js?v=2';
import { setCode } from './history.js?v=5';
import { getElementsByPlace, showCodeElementNow } from './preview.js?v=5';
import { getLineIndex, getLineStartPlace, showCodePosition } from './code-view.js?v=5';
import { openDocument, openNewDocument, createBlankPage } from './documents.js?v=5';
import { receiveDocument } from './incoming.js?v=5';

const AI_DOCUMENT_NAME = 'AI document';
/** The longest text list_elements shows of an element. */
const ELEMENT_TEXT_LENGTH = 60;

/**
 * Returns the document as the prompt and the agent see it.
 * @returns {{code: string, name: string, files: string[], pictures: string[], sel: string, problems: string[], context: object|null}}
 *   the code, its name, the names of all documents and of its files, the selected code, the
 *   problems with their lines and what the page that holds the document says.
 */
export function getPromptState() {
    return {
        code: state.code, name: state.name, files: store.getSortedEntries().map(entry => entry.name), pictures: Object.keys(state.assets),
        sel: state.code.slice(ui.ta.selectionStart, ui.ta.selectionEnd),
        problems: state.problems.map(problem => `line ${getLineIndex(problem.pos) + 1}: ${problem.msg}`),
        context: areas.sync?.getContext() || null,
    };
}

/**
 * Returns the problems with their line numbers.
 * @returns {Array<{pos: number, kind: string, msg: string, line: number}>} the problems.
 */
export function getProblemList() {
    return state.problems.map(problem => ({ ...problem, line: getLineIndex(problem.pos) + 1 }));
}

/**
 * Returns the elements of the page for list_elements: name, depth, line, id, classes and the
 * start of their text (none for script and style).
 * @param {string} tag - only elements of this name; all when empty.
 * @returns {import('./mcp.js').AgentElement[]} the elements in code order.
 */
export function getAgentElements(tag) {
    return (state.parsed?.elements || []).filter(element => !tag || element.name === tag).map(element => ({
        name: element.name, depth: element.depth, line: getLineIndex(element.a) + 1,
        id: getAttributeValue(element.tok, 'id') || '', cls: (getAttributeValue(element.tok, 'class') || '').trim(),
        text: /^(script|style)$/.test(element.name) ? '' : getDecodedText(state.code.slice(element.ca, element.cb).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, ELEMENT_TEXT_LENGTH),
    }));
}

/**
 * Returns the user's documents, the most recently changed first.
 * @returns {Array<{name: string, updated: number, open: boolean}>} the documents.
 */
export function getFileList() {
    return store.getSortedEntries().map(entry => ({ name: entry.name, updated: entry.updated, open: entry.id === state.fileId }));
}

/**
 * Opens a document by name. A command that returns whether it took place.
 * @param {string} name - the document's name.
 * @returns {boolean} true when the document exists (it is open then).
 */
export function openFileByName(name) {
    const entry = store.findByName(name);
    if (entry && entry.id !== state.fileId) openDocument(entry.id);
    return !!entry;
}

/**
 * Makes and opens a new document. A command that returns the name it got.
 * @param {string} name - the wanted name.
 * @param {string} [html] - its code; an empty page when left out.
 * @returns {string|null|false} the document's name, null or false when the storage is full.
 */
export function createFile(name, html) {
    return openNewDocument(name || AI_DOCUMENT_NAME, html || createBlankPage(name || AI_DOCUMENT_NAME)) && state.name;
}

/**
 * Inserts HTML: at the end (before </body>), at the cursor, or on the lines after the heading
 * with the given text or id, as deep as the heading. A command that returns whether it took
 * place.
 * @param {string} html - the HTML.
 * @param {string} where - "end", "cursor", or a heading's text or id.
 * @returns {boolean} false when there is no such heading.
 */
export function addHtml(html, where) {
    if (where === 'end') { receiveDocument(html, 'add', { direct: true }); return true; }
    const place = where === 'cursor' ? { at: ui.ta.selectionStart, indent: '' } : findHeadingEnd(where);
    if (!place) return false;
    const { at, indent } = place;
    const lead = at > 0 && state.code[at - 1] !== '\n' && where !== 'cursor' ? '\n' : '';
    const block = where === 'cursor' ? html : html.trim().split('\n').map(line => indent + line).join('\n') + '\n';
    setCode(state.code.slice(0, at) + lead + block + state.code.slice(at));
    return true;
}

/**
 * Returns the place after a heading of a text or id: the next line when the heading ends its
 * line, else right after it; with the heading's indentation.
 * @param {string} where - the heading's text or id.
 * @returns {{at: number, indent: string}|null} the place, null when there is no such heading.
 */
function findHeadingEnd(where) {
    const wanted = where.trim().toLowerCase();
    const heading = (state.parsed?.outline || []).find(item => item.title.toLowerCase() === wanted || item.id.toLowerCase() === wanted);
    if (!heading) return null;
    const code = state.code;
    const end = getElementsByPlace().get(heading.pos)?.e ?? heading.pos;
    const lineStart = code.lastIndexOf('\n', heading.pos - 1) + 1, lineEnd = code.indexOf('\n', end);
    const indent = /^[ \t]*/.exec(code.slice(lineStart))[0];
    const at = !code.slice(end, lineEnd < 0 ? code.length : lineEnd).trim() ? (lineEnd < 0 ? code.length : lineEnd + 1) : end;
    return { at, indent };
}

/**
 * Replaces an exact piece of the code, the first match or every match. It does the work of the
 * WebMCP tool replace_text and returns the count the tool's answer reports.
 * @param {string} find - the text.
 * @param {string} replacement - the new text.
 * @param {boolean} all - true for every match.
 * @returns {number} how many matches were replaced, 0 for none.
 */
export function updateText(find, replacement, all) {
    if (!find) return 0;
    const count = state.code.split(find).length - 1;
    if (!count) return 0;
    setCode(all ? state.code.split(find).join(replacement) : state.code.replace(find, () => replacement));
    return all ? count : 1;
}

/**
 * Puts the cursor at the start of a line and frames its element in the preview.
 * @param {number} lineNumber - the line, 1-based.
 * @returns {void}
 */
export function showLine(lineNumber) {
    showCodePosition(getLineStartPlace(lineNumber));
    showCodeElementNow();
}
