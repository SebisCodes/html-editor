/**
 * Opening files: with the Open button, by dropping them anywhere on the editor, or by pasting.
 * .html files become new documents; a ZIP with an .html file becomes one document with its
 * files (the index.html, or the one least deep; files in folders keep their last name part);
 * pictures, stylesheets and other files go into the open document. A file dropped onto the code
 * goes where it was dropped. Pasting a whole HTML page outside the code replaces the open one; a
 * pasted picture becomes a file of the document.
 */

import { isKeepable, readAsDataUrl } from './assets.js?v=6';
import { state, ui, DEFAULT_NAME, getElement, showToast } from './state.js?v=2';
import { setCode } from './history.js?v=6';
import { renderPreview } from './preview.js?v=6';
import { openNewDocument } from './documents.js?v=6';
import { addFile } from './document-files.js?v=6';
import { renderInsertPanel } from './insert-panel.js?v=6';
import { TYPING_FIELDS } from './keyboard.js?v=6';
import { readZipEntries, readEntryData } from './zip-read.js?v=2';

const MEGABYTE = 1024 * 1024;
/** The largest page that is opened. */
const MAX_PAGE_SIZE = 8 * MEGABYTE;
/** The largest ZIP that is opened, and what all of its entries may unpack to. */
const MAX_ZIP_SIZE = 100 * MEGABYTE;
/** A pasted text that starts like a whole HTML page (comments before it allowed). */
const WHOLE_PAGE = /^\s*(<!--[\s\S]*?-->\s*)*(<!doctype html|<html[\s>])/i;
let dragDepth = 0;

/**
 * Asks for files to open (the Open button and "Open a file" of "My documents").
 * @returns {void}
 */
export function showFilePicker() {
    getElement('#file').click();
}

/**
 * Connects the Open button, dropping files on the editor and pasting.
 * @returns {void}
 */
export function startFileImport() {
    const picker = getElement('#file');
    getElement('#btn-open').addEventListener('click', showFilePicker);
    picker.addEventListener('change', async () => { await openFiles([...picker.files]); picker.value = ''; });
    window.addEventListener('dragenter', showDropZone);
    window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop'); } });
    window.addEventListener('drop', openDroppedFiles);
    window.addEventListener('paste', importPastedContent);
}

/**
 * Marks the page as a drop target while files are dragged over it.
 * @param {DragEvent} event - the drag entering an element.
 * @returns {void}
 */
function showDropZone(event) {
    if (!event.dataTransfer.types.includes('Files')) return;
    dragDepth++;
    document.body.classList.add('drop');
    event.preventDefault();
}

/**
 * Opens files: pages as new documents, ZIPs as documents with their files, the others into the
 * open document (a single one is also inserted at the cursor).
 * @param {File[]} files - the files.
 * @returns {Promise<void>} settles when all are opened.
 */
export async function openFiles(files) {
    const zips = files.filter(file => /\.zip$/i.test(file.name));
    const pages = files.filter(file => !zips.includes(file) && (/\.(html?|xhtml)$/i.test(file.name) || (/\.txt$/i.test(file.name) && !file.type.startsWith('image/'))));
    const others = files.filter(file => !zips.includes(file) && !pages.includes(file));
    for (const page of pages) await openPageFile(page);
    for (const zip of zips) await openZip(zip);
    for (const other of others) await addFile(other, others.length === 1 && !pages.length);
}

/**
 * Opens a page file as a new document.
 * @param {File} file - the .html (or .txt) file.
 * @returns {Promise<void>} settles when it is open.
 */
async function openPageFile(file) {
    if (file.size > MAX_PAGE_SIZE) { showToast('The file is larger than 8 MB'); return; }
    const text = await file.text();
    if (openNewDocument(file.name.replace(/\.[^.]+$/, '') || DEFAULT_NAME, text)) showToast(`Opened "${file.name}" - it is now in "My documents"`);
}

/**
 * Tells whether a ZIP entry is left out: hidden files, macOS folders and folders.
 * @param {import('./zip-read.js').ZipEntry} entry - the entry.
 * @returns {boolean} true for an entry left out.
 */
function isJunkEntry(entry) {
    return /(^|\/)(\.|__MACOSX)/.test(entry.name) || entry.name.endsWith('/');
}

/**
 * Opens a ZIP with an .html file and its files as one document; tells the user why when it
 * cannot be opened.
 * @param {File} file - the ZIP.
 * @returns {Promise<void>} settles when it is open or refused.
 */
async function openZip(file) {
    try {
        if (file.size > MAX_ZIP_SIZE) throw new Error('it is larger than 100 MB');
        const entries = readZipEntries(new Uint8Array(await file.arrayBuffer()));
        const budget = { left: MAX_ZIP_SIZE };
        const pages = entries.filter(entry => /\.html?$/i.test(entry.name) && !isJunkEntry(entry));
        if (!pages.length) throw new Error('there is no .html file in it');
        const main = pages.find(entry => /(^|\/)index\.html?$/i.test(entry.name)) || pages.sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
        const code = new TextDecoder().decode(await readEntryData(main, budget));
        const files = await readZipFiles(entries, main, budget);
        openZipDocument(file, main, code, files);
    } catch (e) { showToast(`"${file.name}" could not be opened: ${e.message}`); }
}

/**
 * Returns the files of a ZIP a document can keep, by their last name part (the first of a name wins).
 * @param {import('./zip-read.js').ZipEntry[]} entries - the entries.
 * @param {import('./zip-read.js').ZipEntry} main - the page's entry.
 * @param {object} budget - what the ZIP may still unpack to.
 * @param {number} budget.left - the bytes left.
 * @returns {Promise<Object<string, string>>} name -> data URI.
 */
async function readZipFiles(entries, main, budget) {
    const files = {};
    for (const entry of entries) {
        const name = entry.name.replace(/^.*\//, '');
        if (isJunkEntry(entry) || entry === main || !isKeepable(name) || files[name]) continue;
        files[name] = await readAsDataUrl(new Blob([await readEntryData(entry, budget)]), name);
    }
    return files;
}

/**
 * Opens the page of a ZIP with its files as a new document, named after the page (or the ZIP
 * for an index.html).
 * @param {File} file - the ZIP.
 * @param {import('./zip-read.js').ZipEntry} main - the page's entry.
 * @param {string} code - the page's code.
 * @param {Object<string, string>} files - its files.
 * @returns {void}
 */
function openZipDocument(file, main, code, files) {
    const count = Object.keys(files).length;
    const zipName = file.name.replace(/\.zip$/i, '');
    if (!openNewDocument(main.name.replace(/^.*\//, '').replace(/\.html?$/i, '').replace(/^index$/i, zipName) || zipName, code, files)) return;
    state.assets = files;
    renderInsertPanel();
    renderPreview();
    showToast(`Opened "${file.name}" with ${count} ${count === 1 ? 'file' : 'files'}`);
}

/**
 * Opens dropped files (a drop handler); a file dropped onto the code goes where it was dropped.
 * @param {DragEvent} event - the drop.
 * @returns {void}
 */
function openDroppedFiles(event) {
    dragDepth = 0;
    document.body.classList.remove('drop');
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    if (event.target === ui.ta && document.caretPositionFromPoint) {
        const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
        if (caret && caret.offsetNode === ui.ta) ui.ta.setSelectionRange(caret.offset, caret.offset);
        ui.ta.focus({ preventScroll: true });
    }
    openFiles(files);
}

/**
 * Takes a paste outside the fields (a paste handler): a picture becomes a file of the document
 * (inserted at the cursor when pasted into the code); a whole HTML page replaces the open code.
 * @param {ClipboardEvent} event - the paste.
 * @returns {void}
 */
function importPastedContent(event) {
    const active = document.activeElement;
    const picture = [...(event.clipboardData?.files || [])].find(file => /^image\//.test(file.type));
    if (picture && (active === ui.ta || !(active && active.matches(TYPING_FIELDS)))) {
        event.preventDefault();
        const extension = picture.type.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        addFile(new File([picture], picture.name && picture.name !== 'image.png' ? picture.name : `picture.${extension}`, { type: picture.type }), active === ui.ta);
        return;
    }
    if (active && active.matches(TYPING_FIELDS)) return;
    const text = event.clipboardData.getData('text');
    if (!WHOLE_PAGE.test(text)) return;
    event.preventDefault();
    setCode(text);
    showToast('HTML pasted from the clipboard - "Undo" brings the old code back');
}
