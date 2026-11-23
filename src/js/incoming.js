/**
 * Documents that arrive: from AI links and WebMCP tools (ai.js, mcp.js), and from the page
 * around the editor or ?src= (sync.js).
 *
 * A document from an AI goes to the document the link names: "new" makes a new document, a
 * name opens that document (or makes it when there is none), no name means the open one; with
 * mode "add" the HTML goes before </body>. A change of an existing document is one undo step.
 *
 * A document from a page replaces the document of that name that came from the same page
 * before (one undo step), or becomes a new document; the user's own documents are never
 * replaced. A document a page hands over is kept in memory only, never stored.
 */

import { store } from './files.js?v=10';
import { assets } from './assets.js?v=6';
import { VIEWER } from './sync.js?v=24';
import { state, ui, showToast, getErrorCount } from './state.js?v=2';
import { setCode, addTypingStep } from './history.js?v=5';
import { renderPreview } from './preview.js?v=5';
import { stopTextEdit } from './text-edit.js?v=5';
import { openDocument, openNewDocument, createBlankPage } from './documents.js?v=5';
import { renderInsertPanel } from './insert-panel.js?v=5';

const AI_DOCUMENT_NAME = 'AI document';
const INDENT = '  ';

/**
 * Which document an AI's document is for.
 * @typedef {object} ReceiveTarget
 * @property {string} [file] - "new", the name of a document, or "" for the open one.
 * @property {string} [name] - the name of a new document.
 * @property {boolean} [direct] - true for a call of a WebMCP tool.
 */

/**
 * Takes a document from an AI (see the header); in the viewer no message is shown.
 * @param {string} html - the HTML.
 * @param {string} mode - "add" to add it before </body>, anything else to replace the code.
 * @param {ReceiveTarget} [target] - which document.
 * @returns {Promise<void>} settles when the document is in the editor.
 */
export async function receiveDocument(html, mode, target = {}) {
    if (state.textEdit) stopTextEdit(true);
    const wanted = String(target.file || '').trim();
    const isNew = wanted.toLowerCase() === 'new';
    const entry = isNew ? null : wanted ? store.findByName(wanted) : store.getEntry(state.fileId);
    if (!entry) {
        const name = isNew ? target.name || AI_DOCUMENT_NAME : wanted || AI_DOCUMENT_NAME;
        if (openNewDocument(name, mode === 'add' ? addBeforeBodyEnd(createBlankPage(), html) : html)) VIEWER || showToast(`New document "${state.name}" from the AI - your other documents are unchanged`);
        return;
    }
    // The link says which document (chosen with the prompt's buttons): no question; "Undo" takes the change back.
    if (entry.id !== state.fileId) openDocument(entry.id);
    addTypingStep();
    setCode(mode === 'add' ? addBeforeBodyEnd(state.code, html) : html);
    const errors = getErrorCount();
    VIEWER || showToast(errors ? `Document received - the editor found ${errors} ${errors === 1 ? 'problem' : 'problems'}, see above the code` : `"${state.name}" changed by the AI - "Undo" takes it back`);
}

/**
 * Returns the code with HTML added before </body>: with </body> on a line of its own on the
 * lines before it, one level deeper; without </body> at the end.
 * @param {string} code - the code.
 * @param {string} html - the HTML to add.
 * @returns {string} the code with the HTML.
 */
function addBeforeBodyEnd(code, html) {
    const bodyEnd = code.toLowerCase().lastIndexOf('</body');
    if (bodyEnd < 0) return code.replace(/\s*$/, '\n') + html.trim() + '\n';
    const lineStart = code.lastIndexOf('\n', bodyEnd - 1) + 1;
    const lead = code.slice(lineStart, bodyEnd);
    if (lead.trim()) return code.slice(0, bodyEnd) + html.trim() + code.slice(bodyEnd);
    return code.slice(0, lineStart) + html.trim().split('\n').map(line => lead + INDENT + line).join('\n') + '\n' + code.slice(lineStart);
}

/**
 * A document from the page around the editor or from ?src= (sync.js's load contract).
 * @typedef {object} ExternalDocument
 * @property {string} name - its name.
 * @property {string} content - its code.
 * @property {Object<string, string>} [assets] - its files.
 * @property {boolean} [replaceAssets] - true when the files are the whole set (what the page removed must not come back).
 * @property {string} [into] - the id of the document to replace (the page's document).
 * @property {boolean} [asNew] - true to always make a new document.
 * @property {string} [page] - the origin of the page.
 * @property {boolean} [temp] - true to keep the document in memory only.
 */

/**
 * Opens a document from a page (see the header), from the top; an edit in the preview is
 * cancelled first.
 * @param {ExternalDocument} external - the document.
 * @returns {Promise<void>} settles when it is open.
 */
export async function importExternalDocument(external) {
    if (state.textEdit) stopTextEdit(false);
    const { name, into, asNew, page, temp } = external;
    const entry = asNew ? null : (into && store.getEntry(into)) || store.list().find(item => item.name === name && item.page && item.page === page && !!item.temp === !!temp);
    if (entry) await updatePageDocument(entry, external);
    else addPageDocument(external);
    ui.ta.setSelectionRange(0, 0);
    ui.ta.scrollTop = 0;
    if (state.previewDocument?.scrollingElement) state.previewDocument.scrollingElement.scrollTop = 0;
}

/**
 * Puts a page's document into the document that came from the page before: its files as sent
 * (all of them, or added to the others), its code as one undo step.
 * @param {import('./files.js').FileEntry} entry - the document from the page.
 * @param {ExternalDocument} external - the document.
 * @returns {Promise<void>} settles when it is open.
 */
async function updatePageDocument(entry, external) {
    const { content, assets: files, replaceAssets } = external;
    if (replaceAssets) await assets.set(entry.id, { ...(files || {}) });
    else if (files && Object.keys(files).length) await assets.set(entry.id, { ...(await assets.get(entry.id)), ...files });
    if (entry.id !== state.fileId) openDocument(entry.id);
    state.assets = await assets.get(entry.id);
    renderInsertPanel();
    if (content !== state.code) setCode(content); else renderPreview();
}

/**
 * Makes a new document of a page's document, in memory only when the page asks so, and notes
 * the page it came from.
 * @param {ExternalDocument} external - the document.
 * @returns {void}
 */
function addPageDocument(external) {
    const { name, content, assets: files, page, temp } = external;
    const id = openNewDocument(name, content, files, !!temp);
    if (id && page) try { store.setEntryFields(id, { page }); } catch (e) { /* storage full: it just is not recognized next time */ }
    if (!id || !files) return;
    state.assets = files;
    renderInsertPanel();
    renderPreview();
}
