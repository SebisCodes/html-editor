/**
 * Files of the open document: adding one (as a new file, in place of one, or under the name the
 * code asks for), renaming one with its references in the code, removing one, and putting a
 * reference to one into the code. The files are stored with the document they were added to,
 * also when another document was opened meanwhile.
 */

import { store } from './files.js?v=10';
import { assets, getFreeName, readAsDataUrl, isPicture, isKeepable, getExtension } from './assets.js?v=6';
import { state, areas, showToast } from './state.js?v=2';
import { setCode } from './history.js?v=9';
import { renderPreview } from './preview.js?v=9';
import { getFileUses } from './file-refs.js?v=6';
import { addSnippet } from './code-insert.js?v=9';
import { renderFilesTab } from './files-tab.js?v=9';

/** The largest file a document keeps, in bytes. */
const MAX_FILE_SIZE = 12 * 1024 * 1024;

/**
 * Stores a file with the open document. A command that returns the name it was stored under,
 * as the caller may need it.
 * @param {File} file - the file.
 * @param {boolean} insert - true to put a reference to it into the code at the cursor.
 * @param {string} [storeAs] - the name to store it under (replacing that file, or one the code asks for).
 * @returns {Promise<string|null>} the name, null when the file cannot be kept.
 */
export async function addFile(file, insert, storeAs) {
    const id = state.fileId;
    const name = storeAs || getFreeName(state.assets, (file.name || `picture.${getPictureExtension(file.type)}`).toLowerCase());
    if (!isKeepable(name) && !/^image\//.test(file.type)) { showToast('A document can keep pictures, stylesheets, scripts, fonts, PDFs, audio and video'); return null; }
    if (file.size > MAX_FILE_SIZE) { showToast('The file is larger than 12 MB'); return null; }
    const dataUrl = await readAsDataUrl(file, name);
    const files = await assets.add(id, name, dataUrl);
    if (state.fileId !== id) return name;
    state.assets = files;
    renderPreview();
    renderFilesTab();
    if (insert) addFileReference(name);
    showToast(storeAs ? `"${name}" now has the new content` : `File "${name}" added to "${state.name}"`);
    areas.sync?.handleChange();
    return name;
}

/**
 * Returns the extension of a picture by its media type ("image/jpeg" gives "jpg").
 * @param {string} type - the media type.
 * @returns {string} the extension.
 */
export function getPictureExtension(type) {
    return (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
}

/**
 * Puts a reference to a file into the code at the cursor: a picture as <img>, a stylesheet
 * as a link in the head (once), a script, a video, an audio, a font as @font-face, anything
 * else as a link.
 * @param {string} name - the file's name.
 * @returns {void}
 */
export function addFileReference(name) {
    const extension = getExtension(name);
    if (isPicture(name)) addSnippet(`<img src="${name}" alt="|">`, false);
    else if (extension === 'css') {
        if (getFileUses(name).some(ref => ref.tag === 'link')) { showToast(`"${name}" is linked already`); return; }
        addSnippet(`<link rel="stylesheet" href="${name}">|`, false, true);
    } else if (extension === 'js' || extension === 'mjs') addSnippet(`<script src="${name}"></script>|`, true);
    else if (/^(mp4|webm)$/.test(extension)) addSnippet(`<video src="${name}" controls></video>|`, true);
    else if (/^(mp3|wav|ogg|m4a)$/.test(extension)) addSnippet(`<audio src="${name}" controls></audio>|`, true);
    else if (/^(woff2|woff|ttf|otf)$/.test(extension)) addSnippet(`@font-face { font-family: "${name.replace(/\.[^.]+$/, '')}"; src: url("${name}"); }|`, false);
    else addSnippet(`<a href="${name}">|${name}</a>`, false);
}

/**
 * Gives a file a new name; the code's references follow (one undo step, in "img/logo.png"
 * only the last part changes). Undo and Redo rename the file back and forth with the code.
 * When another document was opened meanwhile, only the document the rename started on changes.
 * @param {string} oldName - the file's name.
 * @param {string} wanted - the new name; without an extension the old one is kept.
 * @returns {Promise<void>} settles when the file is renamed.
 */
export async function renameFile(oldName, wanted) {
    const others = { ...state.assets };
    delete others[oldName];
    let wantedName = wanted.trim();
    if (!/\.[a-z0-9]+$/i.test(wantedName)) wantedName += (/(\.[a-z0-9]+)$/i.exec(oldName) || ['', ''])[1];
    const name = getFreeName(others, wantedName);
    if (name === oldName) { renderFilesTab(); return; }
    const files = {};
    for (const [fileName, dataUrl] of Object.entries(state.assets)) files[fileName === oldName ? name : fileName] = dataUrl;
    const id = state.fileId, startCode = state.code;
    const code = getRenamedCode(startCode, oldName, name);
    await assets.set(id, files);
    if (state.fileId !== id) {
        if (code !== startCode) try { store.save(id, { code }); } catch (e) { /* storage full */ }
        return;
    }
    state.assets = files;
    if (code !== state.code) {
        setCode(code);
        state.history[state.history.length - 1].rename = [oldName, name];
    } else renderPreview();
    renderFilesTab();
    areas.sync?.handleChange();
    showToast(`"${oldName}" is now "${name}"`);
}

/**
 * Returns the code with every reference to a file renamed: only the last part of a path
 * changes, ?query and #hash stay.
 * @param {string} code - the code.
 * @param {string} oldName - the file's name.
 * @param {string} name - its new name.
 * @returns {string} the changed code.
 */
function getRenamedCode(code, oldName, name) {
    let renamed = code;
    for (const ref of getFileUses(oldName).sort((x, y) => y.a - x.a)) {
        const raw = renamed.slice(ref.a, ref.b);
        const query = raw.search(/[?#]/), path = query < 0 ? raw : raw.slice(0, query), tail = query < 0 ? '' : raw.slice(query);
        const cut = path.lastIndexOf('/') + 1;
        renamed = renamed.slice(0, ref.a) + path.slice(0, cut) + name + tail + renamed.slice(ref.b);
    }
    return renamed;
}

/**
 * Removes a file from the open document; nothing more changes when another document was
 * opened meanwhile.
 * @param {string} name - the file's name.
 * @returns {Promise<void>} settles when it is removed.
 */
export async function removeFile(name) {
    const id = state.fileId;
    const files = await assets.remove(id, name);
    if (state.fileId !== id) return;
    state.assets = files;
    renderFilesTab();
    renderPreview();
    areas.sync?.handleChange();
}
