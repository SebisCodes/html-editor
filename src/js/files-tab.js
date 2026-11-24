/**
 * The Files tab of the side panel: the files of the open document with their size, where the
 * code uses them ("used 2×" jumps there) and the files the code asks for but that are missing
 * ("Add file…" stores one under that name). Each file can be inserted at the cursor, inserted as
 * a figure, renamed (the references follow), replaced, downloaded or removed.
 */

import { escapeHtml } from './html-tokens.js?v=3';
import { getDataUrlBytes, isPicture, getExtension } from './assets.js?v=6';
import { saveFile } from './util.js?v=3';
import { openConfirmation } from './dialogs.js?v=5';
import { state, ui, NARROW_SCREEN } from './state.js?v=2';
import { getMissingRefs, getFileUses } from './file-refs.js?v=6';
import { addSnippet } from './code-insert.js?v=9';
import { showCodePosition } from './code-view.js?v=9';
import { showPane } from './layout.js?v=9';
import { addFile, addFileReference, renameFile, removeFile } from './document-files.js?v=9';

/** The files a document can keep, for the file picker. */
const ACCEPTED_FILES = 'image/*,.css,.js,.mjs,.json,.txt,.csv,.xml,.pdf,.woff2,.woff,.ttf,.otf,.mp4,.webm,.mp3,.wav,.ogg,.m4a,.vtt,.ico';
/** The badge of a file that is no picture, by its extension. */
const BADGES = { css: 'CSS', js: 'JS', mjs: 'JS', json: 'JSON', pdf: 'PDF', woff2: 'FONT', woff: 'FONT', ttf: 'FONT', otf: 'FONT', mp4: 'VIDEO', webm: 'VIDEO', mp3: 'AUDIO', wav: 'AUDIO', ogg: 'AUDIO', m4a: 'AUDIO' };
const KILOBYTE = 1024;
const MEGABYTE = 1024 * 1024;
/** The size of each picture in pixels once it has loaded, by "name|length of its data". */
const pictureSizes = {};
let filePicker = null;

/**
 * Returns a file size for the list.
 * @param {number} bytes - the size in bytes.
 * @returns {string} "12 KB" or "1.5 MB".
 */
function formatFileSize(bytes) {
    return bytes < MEGABYTE ? `${Math.max(1, Math.round(bytes / KILOBYTE))} KB` : `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/**
 * Returns the badge of a file that is no picture.
 * @param {string} name - the file's name.
 * @returns {string} the badge: its kind, its extension, or "FILE".
 */
function getBadge(name) {
    return BADGES[getExtension(name)] || getExtension(name).toUpperCase() || 'FILE';
}

/**
 * Draws the Files tab.
 * @returns {void}
 */
export function renderFilesTab() {
    const files = Object.entries(state.assets);
    const missing = [...new Set(getMissingRefs().map(ref => ref.value))];
    const total = files.reduce((sum, [, dataUrl]) => sum + getDataUrlBytes(dataUrl).length, 0);
    ui.pictures.innerHTML = `
        <div class="picture-header"><button type="button" class="button primary" id="pic-add">Add files…</button>
            <span class="muted">${files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatFileSize(total)}` : 'No files yet'}</span></div>
        <p class="hint">Files belong to “${escapeHtml(state.name)}” and stay in your browser. Drop or paste pictures, stylesheets or fonts anywhere in the editor, or add them here; the code uses them by their name, e.g. <code>&lt;img src="logo.png"&gt;</code>.</p>
        ${missing.length ? `<div class="missing-pictures"><h3>Missing in this document</h3><ul>${missing.map(formatMissingFile).join('')}</ul></div>` : ''}
        <ul class="picture-gallery">${files.map(([name, dataUrl]) => formatFileCard(name, dataUrl)).join('')}</ul>`;
    showPictureSizes();
}

/**
 * Returns the line of a file the code asks for but that is missing.
 * @param {string} name - the name the code uses.
 * @returns {string} the line's HTML.
 */
function formatMissingFile(name) {
    return `<li><code data-no-i18n>${escapeHtml(name)}</code><button type="button" class="button small" data-pic-fill="${escapeHtml(name)}" title="Choose the file for ${escapeHtml(name)}">Add file…</button></li>`;
}

/**
 * Returns the card of a file: its picture or badge, name, size, uses and buttons.
 * @param {string} name - the file's name.
 * @param {string} dataUrl - its content.
 * @returns {string} the card's HTML.
 */
function formatFileCard(name, dataUrl) {
    const used = getFileUses(name).length;
    const dimensions = pictureSizes[name + '|' + dataUrl.length];
    const picture = isPicture(name);
    const safeName = escapeHtml(name);
    const insertTitle = picture ? 'A picture (img) at the cursor' : getExtension(name) === 'css' ? 'A link to the stylesheet in the head' : 'A reference to the file at the cursor';
    return `<li class="picture-card" data-name="${safeName}">
                <button type="button" class="picture-preview" data-pic="${safeName}" title="Insert ${safeName} at the cursor">${picture ? `<img alt="" src="${escapeHtml(dataUrl)}" data-dim="${escapeHtml(name + '|' + dataUrl.length)}">` : `<span class="picture-pdf" data-no-i18n>${escapeHtml(getBadge(name))}</span>`}</button>
                <div class="picture-info"><code class="picture-title" title="${safeName}" data-no-i18n>${safeName}</code>
                    <small>${dimensions ? dimensions + ' · ' : ''}${formatFileSize(getDataUrlBytes(dataUrl).length)} · ${used ? `<button type="button" class="link-button" data-pic-show="${safeName}" title="Show where it is used">used ${used}×</button>` : 'not used yet'}</small></div>
                <div class="picture-actions">
                    <button type="button" class="button small" data-pic="${safeName}" title="${insertTitle}">Insert</button>
                    ${picture ? `<button type="button" class="button small" data-pic-fig="${safeName}" title="A figure with caption at the cursor">As figure</button>` : ''}
                    <button type="button" class="button small" data-pic-ren="${safeName}" title="Rename - the code is changed along">Rename</button>
                    <button type="button" class="button small" data-pic-rep="${safeName}" title="Choose another file, keep the name">Replace</button>
                    <button type="button" class="button small" data-pic-dl="${safeName}" title="Download the file">Download</button>
                    <button type="button" class="button small danger" data-pic-del="${safeName}" title="Remove the file from this document">Remove</button>
                </div></li>`;
}

/**
 * Adds the size in pixels to each picture's card once the picture has loaded.
 * @returns {void}
 */
function showPictureSizes() {
    for (const picture of ui.pictures.querySelectorAll('img[data-dim]')) {
        if (!pictureSizes[picture.dataset.dim]) picture.addEventListener('load', () => showPictureSize(picture), { once: true });
    }
}

/**
 * Notes the size in pixels of a loaded picture and adds it to its card.
 * @param {HTMLImageElement} picture - the picture in the Files tab.
 * @returns {void}
 */
function showPictureSize(picture) {
    const key = picture.dataset.dim;
    pictureSizes[key] = `${picture.naturalWidth} × ${picture.naturalHeight} px`;
    const small = picture.closest('.picture-card')?.querySelector('small');
    if (small && !small.textContent.includes(' px')) small.insertAdjacentText('afterbegin', pictureSizes[key] + ' · ');
}

/**
 * Connects the Files tab and its file picker; the buttons that insert keep the code's cursor.
 * @returns {void}
 */
export function startFilesTab() {
    ui.pictures.addEventListener('mousedown', event => { if (event.target.closest('[data-pic], [data-pic-fig]')) event.preventDefault(); });
    ui.pictures.addEventListener('click', handleFilesTabClick);
    filePicker = document.createElement('input');
    filePicker.type = 'file';
    filePicker.accept = ACCEPTED_FILES;
    filePicker.multiple = true;
    filePicker.addEventListener('change', addPickedFiles);
}

/**
 * Runs the button clicked in the Files tab (a click handler).
 * @param {MouseEvent} event - the click.
 * @returns {Promise<void>} settles when the action is done.
 */
async function handleFilesTabClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const data = button.dataset;
    if (button.id === 'pic-add') { filePicker.click(); return; }
    if (data.pic) { addFileReference(data.pic); return; }
    if (data.picFig) { addSnippet(`<figure>\n  <img src="${data.picFig}" alt="">\n  <figcaption>|</figcaption>\n</figure>`, true); return; }
    if (data.picShow) { showFileUse(data.picShow); return; }
    if (data.picRen) { startRename(button, data.picRen); return; }
    if (data.picRep || data.picFill) { filePicker.dataset.into = data.picRep || data.picFill; filePicker.multiple = false; filePicker.click(); return; }
    if (data.picDl) { saveFile(new Blob([getDataUrlBytes(state.assets[data.picDl])]), data.picDl); return; }
    if (data.picDel) await removeFileOnConfirm(data.picDel);
}

/**
 * Shows the first place where the code uses a file.
 * @param {string} name - the file's name.
 * @returns {void}
 */
function showFileUse(name) {
    const ref = getFileUses(name)[0];
    if (!ref) return;
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(ref.a, true, ref.b);
}

/**
 * Puts a field in place of a file's name to rename it: Enter or leaving the field renames it,
 * Escape keeps the name.
 * @param {HTMLElement} button - the Rename button of the file's card.
 * @param {string} name - the file's name.
 * @returns {void}
 */
function startRename(button, name) {
    const title = button.closest('.picture-card').querySelector('.picture-title');
    const input = Object.assign(document.createElement('input'), { value: name, className: 'picture-rename', spellcheck: false });
    input.setAttribute('aria-label', 'New name');
    title.replaceWith(input);
    input.focus();
    input.setSelectionRange(0, name.replace(/\.[a-z0-9]+$/i, '').length);
    let done = false;
    /**
     * Ends the rename once: renames the file when kept and not empty, else draws the tab again.
     * @param {boolean} keep - true to rename.
     * @returns {void}
     */
    const stopRename = keep => {
        if (done) return;
        done = true;
        if (keep && input.value.trim()) renameFile(name, input.value);
        else renderFilesTab();
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); stopRename(true); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopRename(false); }
    });
    input.addEventListener('blur', () => stopRename(true));
}

/**
 * Asks before removing a file, then removes it.
 * @param {string} name - the file's name.
 * @returns {Promise<void>} settles when it is removed or kept.
 */
async function removeFileOnConfirm(name) {
    if (!await openConfirmation({ title: `Remove "${name}"?`, text: 'The file is removed from this document. Places that use it show nothing. "Undo" does not bring it back.', ok: 'Remove' })) return;
    await removeFile(name);
}

/**
 * Stores the files chosen in the file picker: one in place of a file (Replace, Add file…), or
 * new ones (a single one is also inserted at the cursor).
 * @returns {Promise<void>} settles when they are stored.
 */
async function addPickedFiles() {
    const into = filePicker.dataset.into;
    delete filePicker.dataset.into;
    filePicker.multiple = true;
    if (into && filePicker.files[0]) await addFile(filePicker.files[0], false, into);
    else for (const file of filePicker.files) await addFile(file, filePicker.files.length === 1);
    filePicker.value = '';
}
