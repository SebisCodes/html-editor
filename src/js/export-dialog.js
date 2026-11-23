/**
 * The Export dialog and the download buttons: the .html, the page as one file with its files
 * inside, a ZIP with the files, PDF (print dialog), plain text, or all of it as one ZIP; the
 * text of the chosen format can be copied. "Open in another editor" is a format of its own
 * (convert-to.js, export-menu.js). Ctrl+S saves to the server or the page around the editor when
 * one is set up, otherwise it downloads the .html (a ZIP when the document has files).
 */

import { createZip } from './zip.js?v=4';
import { saveFile, getSafeName } from './util.js?v=3';
import { openDialog } from './dialogs.js?v=5';
import { state, ui, areas, getElement, showToast } from './state.js?v=2';
import { renderPreview } from './preview.js?v=4';
import { stopTextEdit } from './text-edit.js?v=4';
import { isPageBreaksOn, setPageBreaks, getSingleHtml, getZipFiles, getPlainText, runPrint } from './export.js?v=4';

let dialog = null, nameField = null, formatField = null, textField = null, infoLine = null;

/**
 * Returns the file name chosen in the dialog (the document's name when the field is empty).
 * @returns {string} a safe file name without extension.
 */
function getExportName() {
    return getSafeName(nameField.value || state.name);
}

/**
 * Opens the Export dialog with the document's name; an edit in the preview is kept first.
 * @returns {void}
 */
export function openExportDialog() {
    if (state.textEdit) stopTextEdit(true);
    renderPreview();
    nameField.value = state.name;
    updateExportDialog();
    openDialog(dialog);
}

/**
 * Shows the chosen format: its page-break option, the label of the download button, the copy
 * button, and its text or file list with its size.
 * @returns {void}
 */
function updateExportDialog() {
    if (formatField.value === 'convert') return;
    const format = formatField.value;
    getElement('#ex-breaks').closest('label').hidden = !(format === 'pdf' || format === 'single');
    dialog.dataset.raster = format === 'pdf' ? 'pdf' : 'false';
    getElement('#ex-download').textContent = format === 'pdf' ? 'Print / Save as PDF' : 'Download';
    getElement('#ex-copy').hidden = format === 'pdf' || format === 'zip';
    const fileCount = Object.keys(state.assets).length;
    if (format === 'pdf') { infoLine.textContent = ''; return; }
    if (format === 'zip') {
        textField.value = getZipFiles(getExportName()).map(file => file.name).join('\n');
        infoLine.textContent = `.html and ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
        return;
    }
    const text = format === 'html' ? state.code : format === 'txt' ? getPlainText() : getSingleHtml();
    textField.value = text;
    infoLine.textContent = `${new Blob([text]).size.toLocaleString('en')} bytes`;
}

/**
 * Downloads the chosen format, or prints for PDF (a click handler).
 * @returns {Promise<void>} settles when the download started.
 */
async function exportChosenFormat() {
    const format = formatField.value;
    const button = getElement('#ex-download');
    button.disabled = true;
    try {
        if (format === 'pdf') { dialog.close(); runPrint(); return; }
        if (format === 'single') saveFile(getSingleHtml(), `${getExportName()}.html`, 'text/html');
        else if (format === 'zip') saveFile(await createZip(getZipFiles(getExportName())), `${getExportName()}.zip`);
        else if (format === 'txt') saveFile(textField.value, `${getExportName()}.txt`, 'text/plain');
        else saveFile(state.code, `${getExportName()}.html`, 'text/html');
        showToast('Downloaded');
    } catch (error) { console.error(error); showToast(error.message); } finally { button.disabled = false; }
}

/**
 * Downloads everything at once as one ZIP: the .html, its files, the page as one file and the text.
 * @returns {Promise<void>} settles when the download started.
 */
async function exportAll() {
    const button = getElement('#ex-zip');
    button.disabled = true;
    try {
        const name = getExportName();
        saveFile(await createZip([...getZipFiles(name), { name: `${name}-single.html`, data: getSingleHtml() }, { name: `${name}.txt`, data: getPlainText() }]), `${name}-all.zip`);
        showToast('ZIP downloaded: .html, its files, the page as one file and the text');
    } catch (error) { console.error(error); showToast(error.message); } finally { button.disabled = false; }
}

/**
 * Copies the text of the chosen format; where the clipboard is not allowed, the field is
 * selected and copied with the browser's copy command.
 * @returns {Promise<void>} settles when it is copied.
 */
async function copyExportText() {
    const text = textField.value;
    try { await navigator.clipboard.writeText(text); showToast('Copied to the clipboard'); } catch (error) {
        textField.select();
        document.execCommand('copy');
        showToast('Copied to the clipboard');
    }
}

/**
 * Copies the code (the code button above it).
 * @returns {Promise<void>} settles when it is copied.
 */
async function copyCode() {
    try { await navigator.clipboard.writeText(state.code); } catch (e) { ui.ta.select(); document.execCommand('copy'); }
    showToast('Code copied');
}

/**
 * Downloads the document: the .html, or a ZIP with its files when it has any.
 * @returns {void}
 */
function exportHtmlFile() {
    nameField.value = state.name;
    const name = getSafeName(state.name);
    if (Object.keys(state.assets).length) createZip(getZipFiles(name)).then(zip => { saveFile(zip, `${name}.zip`); showToast('.html with its files downloaded (ZIP)'); });
    else { saveFile(state.code, `${name}.html`, 'text/html'); showToast('.html downloaded'); }
}

/**
 * Saves with Ctrl+S: to the server or the page around the editor when one is set up, otherwise
 * a download. Text being edited in the preview goes into the code first.
 * @returns {void}
 */
export function saveQuickly() {
    if (state.textEdit) stopTextEdit(true);
    if (areas.sync && areas.sync.isActive()) { areas.sync.save(); return; }
    exportHtmlFile();
}

/**
 * Connects the Export dialog and the download buttons.
 * @returns {void}
 */
export function startExportDialog() {
    dialog = getElement('#export');
    nameField = getElement('#ex-name');
    formatField = getElement('#ex-format');
    textField = getElement('#ex-text');
    infoLine = getElement('#ex-info');
    formatField.addEventListener('change', updateExportDialog);
    nameField.addEventListener('input', updateExportDialog);
    const breaksBox = getElement('#ex-breaks');
    breaksBox.checked = isPageBreaksOn();
    breaksBox.addEventListener('change', event => { setPageBreaks(event.target.checked); updateExportDialog(); });
    getElement('#ex-download').addEventListener('click', exportChosenFormat);
    getElement('#ex-zip').addEventListener('click', exportAll);
    getElement('#ex-copy').addEventListener('click', copyExportText);
    getElement('#btn-export').addEventListener('click', openExportDialog);
    getElement('#btn-copy').addEventListener('click', copyCode);
    getElement('#btn-download').addEventListener('click', () => exportHtmlFile());
}
