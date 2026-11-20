/**
 * The documents of "My documents" in the editor: opening one (each keeps its own undo history
 * while the page is open), making a new one, starting the open one over, the "New" menu, and
 * the buttons of the top bar for "My documents", Undo and Redo.
 *
 * openDocument() runs these steps:
 *   1. end an edit in the preview, store the open document's waiting edits and keep its history;
 *   2. take the other document's code, name, history and the files read so far;
 *   3. show it from the top, draw everything, and draw again once its files are read.
 */

import { escapeText } from './html-tokens.js?v=3';
import { store } from './files.js?v=10';
import { assets } from './assets.js?v=6';
import { START, TEMPLATES } from './samples.js?v=3';
import { openConfirmation } from './dialogs.js?v=5';
import { state, ui, areas, DEFAULT_NAME, NARROW_SCREEN, getElement, getElements, showToast } from './state.js?v=2';
import { setCode, addHistoryStep, updateHistoryButtons, undo, redo } from './history.js?v=3';
import { renderPreview } from './preview.js?v=3';
import { saveWaitingEdits } from './storage.js?v=3';
import { showCodePosition } from './code-view.js?v=3';
import { stopTextEdit } from './text-edit.js?v=3';
import { renderInsertPanel } from './insert-panel.js?v=3';
import { createFilesDialog } from './files-dialog.js?v=3';

const STORAGE_FULL = 'The browser storage is full - delete or download documents under "My documents" first';
/** The undo history of each document opened in this page, by id. */
const documentHistories = new Map();

/**
 * Returns an empty page with the usual head.
 * @param {string} [title] - the text of <title>.
 * @returns {string} the HTML code.
 */
export function createBlankPage(title = DEFAULT_NAME) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeText(title)}</title>
</head>
<body>

</body>
</html>
`;
}

/**
 * Shows the open document's name in the top bar, the tooltip of "My documents" and the "New" menu.
 * @returns {void}
 */
export function showFileName() {
    getElement('#file-name').textContent = state.name;
    getElement('#btn-files').title = `"${state.name}" is open. My documents: open, rename, duplicate or delete your documents (Ctrl+O)`;
    getElement('#new-restart b').textContent = `Start "${state.name}" over`;
}

/**
 * Opens a document of "My documents" (the steps in the header).
 * @param {string} id - the document's id.
 * @param {string} [code] - its code, when the caller has it; else it is read from the store.
 * @returns {void}
 */
export function openDocument(id, code) {
    if (state.textEdit) stopTextEdit(true);
    saveClosedDocumentHistory();
    const opened = code ?? store.code(id) ?? createBlankPage();
    setOpenedDocument(id, opened);
    showOpenedDocument(opened);
    assets.get(id).then(files => showOpenedFiles(id, files));
}

/**
 * Draws the open document again with its files once they are read; nothing when another
 * document is open by then or the files are the ones shown.
 * @param {string} id - the document the files belong to.
 * @param {Object<string, string>} files - its files, name -> data URI.
 * @returns {void}
 */
function showOpenedFiles(id, files) {
    if (state.fileId !== id || files === state.assets) return;
    state.assets = files;
    renderInsertPanel();
    renderPreview();
}

/**
 * Stores the edits of the document being closed that still wait for the delayed store, and
 * keeps its undo history for when it opens again.
 * @returns {void}
 */
function saveClosedDocumentHistory() {
    clearTimeout(state.historyTimer);
    saveWaitingEdits();
    if (!state.fileId) return;
    addHistoryStep();
    documentHistories.set(state.fileId, { history: state.history, future: state.future });
}

/**
 * Takes a document into the state: id, name, the code as stored, its history and its files as
 * far as they are read.
 * @param {string} id - the document's id.
 * @param {string} code - its code.
 * @returns {void}
 */
function setOpenedDocument(id, code) {
    state.fileId = id;
    state.name = store.getEntry(id)?.name || DEFAULT_NAME;
    state.savedCode = code;
    const kept = documentHistories.get(id);
    state.history = kept ? kept.history : [];
    state.future = kept ? kept.future : [];
    state.assets = assets.getCached(id);
}

/**
 * Shows the opened document from the top and draws everything for it.
 * @param {string} code - its code.
 * @returns {void}
 */
function showOpenedDocument(code) {
    ui.ta.value = code;
    ui.ta.scrollTop = 0;
    ui.ta.setSelectionRange(0, 0);
    setCode(code, { history: false });
    if (state.previewDocument?.scrollingElement) state.previewDocument.scrollingElement.scrollTop = 0;
    addHistoryStep();
    updateHistoryButtons();
    showFileName();
    areas.files.render();
    renderInsertPanel();
    areas.sync?.updateUi();
}

/**
 * Makes a new document in "My documents" and opens it with the cursor after <body>. A command
 * that returns the new id, as the callers need it.
 * @param {string} name - the wanted name.
 * @param {string} code - the code.
 * @param {Object<string, string>} [files] - its files.
 * @param {boolean} [inMemory] - keep it in memory only (a page's document), never stored.
 * @returns {string|null} the id, null when the browser storage is full.
 */
export function openNewDocument(name, code, files, inMemory = false) {
    let id;
    try { id = store.create(name, code, inMemory); } catch (e) {
        showToast(STORAGE_FULL);
        return null;
    }
    if (files && Object.keys(files).length) assets.set(id, files);
    openDocument(id, code);
    const bodyStart = /<body[^>]*>\n?/i.exec(code);
    if (bodyStart && !NARROW_SCREEN.matches) setTimeout(() => showCodePosition(Math.min(bodyStart.index + bodyStart[0].length, code.length)), 0);
    return id;
}

/**
 * Empties the body of the open document but keeps its head, after asking; "Undo" brings it
 * back. Nothing happens when another document was opened while the question was open.
 * @returns {Promise<void>} settles when it is done or cancelled.
 */
async function clearDocumentOnConfirm() {
    const bodyStart = /<body[^>]*>/i.exec(state.code), bodyEnd = state.code.search(/<\/body\s*>/i);
    const emptied = bodyStart && bodyEnd > bodyStart.index ? state.code.slice(0, bodyStart.index + bodyStart[0].length) + '\n\n' + state.code.slice(bodyEnd) : '';
    if (state.code === emptied) { showToast('This document is empty already'); return; }
    const forId = state.fileId;
    if (!await openConfirmation({
        title: `Start "${state.name}" over?`,
        text: bodyStart ? 'Everything between <body> and </body> is removed; the head (title, styles, meta tags) stays. "Undo" brings it back as long as the page is open.' : 'Everything is removed. "Undo" brings it back as long as the page is open.',
        ok: 'Start over',
    })) return;
    if (state.fileId !== forId) return;
    setCode(emptied);
    if (bodyStart) showCodePosition(bodyStart.index + bodyStart[0].length + 1);
    showToast(`"${state.name}" is empty now - "Undo" brings it back`);
}

/**
 * Runs an entry of the "New" menu: start the open document over, or a new document from the
 * welcome example, a template or a blank page.
 * @param {string} kind - "restart", "example", a template's key, or "blank".
 * @returns {void}
 */
export function openFromMenu(kind) {
    if (kind === 'restart') { clearDocumentOnConfirm(); return; }
    const template = kind === 'example' ? START : TEMPLATES[kind];
    if (openNewDocument(template ? template.name : DEFAULT_NAME, template ? template.code : createBlankPage())) showToast(`New document "${state.name}" - your other documents are under "My documents"`);
}

/**
 * Connects "My documents" (files-dialog.js) to the editor.
 * @param {function(): void} showFilePicker - asks for a file to open.
 * @returns {import('./files-dialog.js').FilesDialog} the dialog's API.
 */
export function createDocumentsDialog(showFilePicker) {
    return createFilesDialog({
        getCurrent: () => ({ id: state.fileId, name: state.name, code: state.code }),
        openDocument: id => { openDocument(id); showToast(`"${state.name}" opened`); },
        openNew: openFromMenu,
        renameDocument,
        onRemoved: openAfterRemoval,
        showFilePicker,
        showToast,
    });
}

/**
 * Gives a document a new name.
 * @param {string} id - the document's id.
 * @param {string} name - the new name.
 * @returns {void}
 */
function renameDocument(id, name) {
    try { store.save(id, { name }); } catch (e) { showToast('The browser storage is full'); return; }
    if (id !== state.fileId) return;
    state.name = name;
    showFileName();
    areas.sync?.handleChange();
}

/**
 * Forgets the history of a deleted document; when it was open, opens the most recent other
 * one, or a new blank document.
 * @param {string} id - the deleted document's id.
 * @returns {void}
 */
function openAfterRemoval(id) {
    documentHistories.delete(id);
    if (id !== state.fileId) return;
    state.fileId = '';
    const next = store.getSortedEntries()[0];
    if (next) openDocument(next.id);
    else openNewDocument(DEFAULT_NAME, createBlankPage());
}

/**
 * Opens or closes the "New" menu; the first entry gets the focus when it opens.
 * @param {boolean} [open] - true to open, false to close; toggles when left out.
 * @returns {void}
 */
export function setNewMenuOpen(open = getElement('#new-menu').hidden) {
    const menu = getElement('#new-menu');
    menu.hidden = !open;
    getElement('#btn-new').setAttribute('aria-expanded', open);
    if (open) menu.querySelector('button').focus();
}

/**
 * Tells whether the "New" menu is open.
 * @returns {boolean} true while it is open.
 */
export function isNewMenuOpen() {
    return !getElement('#new-menu').hidden;
}

/**
 * Connects the "New" menu (arrow keys move, Escape closes, a click outside closes) and the
 * buttons of "My documents", Undo and Redo.
 * @returns {void}
 */
export function startDocumentButtons() {
    const newButton = getElement('#btn-new'), menu = getElement('#new-menu');
    newButton.addEventListener('click', () => setNewMenuOpen());
    menu.addEventListener('click', openClickedNewItem);
    menu.addEventListener('keydown', event => moveInNewMenu(event, menu, newButton));
    document.addEventListener('pointerdown', event => { if (!menu.hidden && !event.target.closest('#new-menu, #btn-new')) setNewMenuOpen(false); });
    getElement('#btn-files').addEventListener('click', () => areas.files.open());
    getElement('#btn-undo').addEventListener('click', undo);
    getElement('#btn-redo').addEventListener('click', redo);
}

/**
 * Closes the "New" menu and opens the kind of document of the clicked entry.
 * @param {MouseEvent} event - the click in the menu.
 * @returns {void}
 */
function openClickedNewItem(event) {
    const entry = event.target.closest('[data-new]');
    if (!entry) return;
    setNewMenuOpen(false);
    openFromMenu(entry.dataset.new);
}

/**
 * Moves the focus through the "New" menu with the arrow keys; Escape closes it.
 * @param {KeyboardEvent} event - the key in the menu.
 * @param {HTMLElement} menu - the menu.
 * @param {HTMLElement} newButton - the "New" button, focused again after Escape.
 * @returns {void}
 */
function moveInNewMenu(event, menu, newButton) {
    const items = getElements('button', menu), index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    if (event.key === 'Escape') { event.stopPropagation(); setNewMenuOpen(false); newButton.focus(); }
}
