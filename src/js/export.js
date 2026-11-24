/**
 * What Export makes of the document: the page as one HTML file with its files inside, the
 * files for a ZIP under the paths the code uses, the page as plain text, and printing (PDF
 * through the print dialog). Page breaks follow the usual print rules, placed before the
 * document's own styles so those win; turned off, the page simply flows, also past breaks in
 * its own styles. The choice is remembered in this browser.
 */

import { getRefPath } from './html.js?v=8';
import { getDecodedText } from './html-tokens.js?v=3';
import { getExtension, getDataUrlBytes, getDataUrlText } from './assets.js?v=6';
import { state, showToast } from './state.js?v=2';
import { renderPreview, PREVIEW_URL } from './preview.js?v=8';
import { createViewDocument, getTemplateDocument, getViewTitle } from './preview-views.js?v=3';
import { findFileForRef, getFileUses, getInlineCss } from './file-refs.js?v=6';
import { stopTextEdit } from './text-edit.js?v=8';

/** Whether a PDF applies page breaks: "0" off, anything else on. */
const PAGE_BREAKS_KEY = 'htmleditor.pagebreaks';
/** Page breaks by the usual print rules. */
const PRINT_CSS = '@media print{h1,h2,h3,h4,h5,h6{break-after:avoid}'
    + 'pre,blockquote,img,figure,tr{break-inside:avoid}p,li,dd{orphans:2;widows:2}}';
/**
 * The printed page where a box's padding repeats on every page: no page margin, so the browser
 * has no room for its header and footer; the margin as padding of every page, kept against a
 * style reset, and the editor's address centered at the bottom. Comes before the
 * document's own styles, so a document's own @page wins. Other browsers keep the page margin.
 */
const PRINT_PAGE_CSS = 'giit-print-footer{display:none!important}'
    + '@media print{@supports (box-decoration-break:clone){@page{margin:0}'
    + 'html{padding:18mm 16mm!important;box-decoration-break:clone!important}'
    + 'giit-print-footer{display:block!important;position:fixed!important;left:0!important;right:0!important;bottom:7mm!important;margin:0!important;padding:0!important;'
    + 'text-align:center!important;font:8pt/1 system-ui,sans-serif!important;color:#59636e!important;background:none!important}}}';
/** The editor's address at the bottom of every printed page. */
const PRINT_FOOTER_TEXT = 'html.giit.ch';
/** No page breaks when printing, also none of the page's own. */
const NO_BREAKS_CSS = '@media print{*{break-before:auto!important;break-after:auto!important;break-inside:auto!important;page-break-before:auto!important;page-break-after:auto!important;page-break-inside:auto!important;orphans:1!important;widows:1!important}}';
/** How deep stylesheets imported by stylesheets are put inside the one file. */
const MAX_CSS_DEPTH = 4;
/** Bytes turned into characters at once for base64. */
const BASE64_CHUNK = 0x8000;
/** How long printing waits for the pictures, in milliseconds. */
const PICTURE_WAIT = 3000;
/** How long the print frame stays after printing, in milliseconds. */
const PRINT_FRAME_TIME = 1000;

/**
 * Tells whether a PDF and the page as one file apply page breaks; on unless turned off.
 * @returns {boolean} true when page breaks apply.
 */
export function isPageBreaksOn() {
    try { return localStorage.getItem(PAGE_BREAKS_KEY) !== '0'; } catch (e) { return true; }
}

/**
 * Remembers whether page breaks apply; without storage the choice holds for this print only.
 * @param {boolean} on - true for page breaks.
 * @returns {void}
 */
export function setPageBreaks(on) {
    try { localStorage.setItem(PAGE_BREAKS_KEY, on ? '1' : '0'); } catch (e) { /* without storage it holds for this print only */ }
}

/**
 * Returns bytes as base64.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {string} the base64 text.
 */
function convertToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK));
    return btoa(binary);
}

/**
 * Returns a file of the document as a data: URI; a stylesheet with its own files inside.
 * @param {string} name - the file's name.
 * @param {number} [depth] - how deep in imported stylesheets the file is.
 * @returns {string} the data URI.
 */
function getFileDataUri(name, depth = 0) {
    if (getExtension(name) === 'css' && depth < MAX_CSS_DEPTH) return 'data:text/css;base64,' + convertToBase64(new TextEncoder().encode(getInlineCss(getDataUrlText(state.assets[name]), depth, getFileDataUri)));
    return state.assets[name];
}

/**
 * Returns the page as one file: every file of the document as a data URI in place of its name,
 * with the page-break rules as chosen.
 * @returns {string} the HTML code.
 */
export function getSingleHtml() {
    let code = state.code;
    const refs = state.parsed.refs.filter(ref => findFileForRef(ref.value)).sort((a, b) => b.a - a.a);
    for (const ref of refs) code = code.slice(0, ref.a) + getFileDataUri(findFileForRef(ref.value)) + code.slice(ref.b);
    const breaksOn = isPageBreaksOn();
    const rules = `<style>${breaksOn ? PRINT_CSS : NO_BREAKS_CSS}</style>`;
    if (breaksOn) return /<head\b[^>]*>/i.test(code) ? code.replace(/<head\b[^>]*>/i, headTag => headTag + rules) : rules + code;
    return /<\/head>/i.test(code) ? code.replace(/<\/head>/i, headEnd => rules + headEnd) : code + rules;
}

/**
 * Returns the files for a ZIP: the page and each file under the path the code uses for it
 * ("img/logo.png"), without "..".
 * @param {string} baseName - the file name of the page without .html.
 * @returns {{name: string, data: (string|Uint8Array)}[]} the files.
 */
export function getZipFiles(baseName) {
    const zipFiles = [{ name: `${baseName}.html`, data: state.code }];
    for (const [name, dataUrl] of Object.entries(state.assets)) zipFiles.push({ name: getZipPath(name), data: getDataUrlBytes(dataUrl) });
    return zipFiles;
}

/**
 * Returns the path under which a ZIP keeps a file: the path the code uses for it, or its name.
 * @param {string} name - the file's name.
 * @returns {string} the path.
 */
function getZipPath(name) {
    const path = getFileUses(name).map(ref => getRefPath(ref.value)).find(refPath => !/(^|\/)\.\.(\/|$)/.test(refPath) && !refPath.startsWith('/'));
    return path && path.toLowerCase().endsWith(name.toLowerCase()) ? path.slice(0, path.length - name.length) + name : name;
}

/**
 * Returns the page as plain text: the preview's text, or the code without tags when there is
 * no preview; while the preview shows a template's example view, the text of the template as
 * written.
 * @returns {string} the text, at most one empty line in a row, ending with a line break.
 */
export function getPlainText() {
    const templateBody = getTemplateDocument()?.body;
    const body = state.previewDocument?.body;
    const text = templateBody ? getBlockText(templateBody) : body ? body.innerText : getDecodedText(state.code.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' '));
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Returns the text of a document's body that is in no frame: the line breaks of <br>, and of
 * blocks, list items and table rows, on lines of their own, cells apart by tabs; scripts and
 * styles left out.
 * @param {HTMLElement} body - the body.
 * @returns {string} the text.
 */
function getBlockText(body) {
    const copy = body.cloneNode(true);
    copy.querySelectorAll('script, style, template, noscript').forEach(element => element.remove());
    copy.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
    copy.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote, section, article, header, footer, table, ul, ol, dl, dt, dd, address, figure, figcaption, hr').forEach(element => element.append('\n'));
    copy.querySelectorAll('td, th').forEach(element => element.append('\t'));
    return copy.textContent;
}

/**
 * Prints the page (PDF through the print dialog) from a frame of its own that may open the
 * print dialog but still runs no script; an edit in the preview is kept first.
 * @returns {void}
 */
export function runPrint() {
    if (state.textEdit) stopTextEdit(true);
    renderPreview();
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.className = 'print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.src = PREVIEW_URL;
    frame.addEventListener('load', () => runPrintFromFrame(frame), { once: true });
    document.body.append(frame);
}

/**
 * Puts the page into the print frame, waits for its pictures (at most a few seconds), opens
 * the print dialog with the document's name as the title, and removes the frame afterwards.
 * @param {HTMLIFrameElement} frame - the print frame.
 * @returns {Promise<void>} settles when the print dialog was opened.
 */
async function runPrintFromFrame(frame) {
    const frameDocument = frame.contentDocument;
    frameDocument.replaceChild(frameDocument.importNode(createViewDocument(state.code, state.parsed).documentElement, true), frameDocument.documentElement);
    const rules = frameDocument.createElement('style');
    const breaksOn = isPageBreaksOn();
    rules.textContent = breaksOn ? PRINT_CSS : NO_BREAKS_CSS;
    if (breaksOn) frameDocument.head.prepend(rules); else frameDocument.head.append(rules);
    addPrintPageLayout(frameDocument);
    await Promise.race([Promise.all([...frameDocument.images].map(picture => (picture.complete ? null : new Promise(resolve => { picture.onload = picture.onerror = resolve; })))), new Promise(resolve => setTimeout(resolve, PICTURE_WAIT))]);
    const pageTitle = document.title;
    document.title = getViewTitle(state.name);
    try { frame.contentWindow.print(); } catch (e) { showToast('This browser does not allow printing here'); }
    document.title = pageTitle;
    setTimeout(() => frame.remove(), PRINT_FRAME_TIME);
}

/**
 * Adds the page rules of printing before the document's own styles and the editor's address
 * after the body, so the document's :last-child rules still match.
 * @param {Document} frameDocument - the print frame's document.
 * @returns {void}
 */
function addPrintPageLayout(frameDocument) {
    const pageRules = frameDocument.createElement('style');
    pageRules.textContent = PRINT_PAGE_CSS;
    frameDocument.head.prepend(pageRules);
    const footer = frameDocument.createElement('giit-print-footer');
    footer.textContent = PRINT_FOOTER_TEXT;
    frameDocument.documentElement.append(footer);
}
