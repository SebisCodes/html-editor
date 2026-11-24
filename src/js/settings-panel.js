/**
 * The Document tab of the side panel: settings that edit the head (title, language, description,
 * author, meta charset and viewport, the linked stylesheets) and a line about the page
 * (elements, words, headings, files). A code without <html> and <head> is shown as a part of a
 * page, with a button that makes it a complete page.
 *
 * Every setting is one undo step and keeps the code's cursor; a field being typed in is not
 * drawn again until it is left.
 */

import { escapeHtml, findAttribute, getAttributeValue, getDecodedText } from './html-tokens.js?v=3';
import { isRefTo, isOutsideRef } from './html.js?v=8';
import { getExtension } from './assets.js?v=6';
import { state, ui, NARROW_SCREEN, getElement, showToast } from './state.js?v=2';
import { setCode, addTypingStep } from './history.js?v=9';
import { getElementsByPlace } from './preview.js?v=9';
import { findFileForRef } from './file-refs.js?v=6';
import { showCodePosition } from './code-view.js?v=9';
import { showPane } from './layout.js?v=9';
import { createBlankPage } from './documents.js?v=9';
import { findFirstElement, findMetaElement, setAttributeInCode, addToHead, removeElementFromCode, setTitleInCode, setMetaInCode } from './head-edit.js?v=3';

/** The languages offered for <html lang>: [code, label]. */
const LANGUAGES = [['', 'Not set'], ['en', 'English (en)'], ['en-US', 'English, US (en-US)'], ['en-GB', 'English, UK (en-GB)'], ['de', 'German (de)'], ['de-CH', 'German, Switzerland (de-CH)'],
    ['de-DE', 'German, Germany (de-DE)'], ['fr', 'French (fr)'], ['it', 'Italian (it)'], ['es', 'Spanish (es)'], ['pt', 'Portuguese (pt)'], ['nl', 'Dutch (nl)']];
/** How long a typed title, description or author waits before it goes into the code, in milliseconds. */
const TYPING_DELAY = 350;
/** The timer of each text field. */
const fieldTimers = new WeakMap();

/**
 * Draws the Document tab, unless a field in it is being typed in.
 * @returns {void}
 */
export function renderSettingsPanel() {
    if (ui.inspector.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    if (!state.parsed) return;
    const info = formatDocumentInfo();
    const html = findFirstElement('html'), head = findFirstElement('head');
    if (!html || !head || !/<\/head\s*>/i.test(state.code)) {
        ui.inspector.innerHTML = `<p class="hint">This code has no <code>&lt;html&gt;</code> with a <code>&lt;head&gt;</code>, so it is shown as a part of a page. Title, language and description belong in the head.</p><div class="button-row"><button type="button" class="button primary" id="make-full">Make it a complete page</button></div>${info}`;
        return;
    }
    ui.inspector.innerHTML = formatSettingsForm(html) + info;
}

/**
 * Returns the line about the page: elements, words, headings and files.
 * @returns {string} the line's HTML.
 */
function formatDocumentInfo() {
    const parsed = state.parsed;
    const words = (state.previewDocument?.body?.innerText || '').match(/[\p{L}\p{N}]+/gu)?.length || 0;
    const fileCount = Object.keys(state.assets).length;
    return `<div class="doc-info"><b>${parsed.elements.length}</b> ${parsed.elements.length === 1 ? 'element' : 'elements'} · about <b>${words.toLocaleString('en')}</b> words · <b>${parsed.outline.length}</b> ${parsed.outline.length === 1 ? 'heading' : 'headings'} · <b>${fileCount}</b> ${fileCount === 1 ? 'file' : 'files'}</div>`;
}

/**
 * Returns the options of the language list; a language of the page that is not in the list
 * is added and selected.
 * @param {string} language - the page's language.
 * @returns {string} the options' HTML.
 */
function formatLanguageOptions(language) {
    const options = LANGUAGES.map(([code, label]) => `<option value="${escapeHtml(code)}"${code === language ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
    return LANGUAGES.some(([code]) => code === language) ? options : options + `<option value="${escapeHtml(language)}" selected data-no-i18n>${escapeHtml(language)}</option>`;
}

/**
 * Returns the list of linked stylesheets, each with where it comes from and a button to show
 * it in the code.
 * @param {import('./html.js').HtmlElement[]} sheets - the stylesheet links.
 * @returns {string} the list's HTML.
 */
function formatStylesheetList(sheets) {
    if (!sheets.length) return '<p class="hint">No stylesheet is linked.</p>';
    return `<ul class="pictures">${sheets.map(sheet => {
        const href = getAttributeValue(sheet.tok, 'href') || '';
        const origin = isOutsideRef(href) ? 'from the web' : findFileForRef(href) ? 'a file of this document' : 'missing';
        return `<li class="sheet-row"><span class="picture-name"><span data-no-i18n>${escapeHtml(href)}</span><small>${origin}</small></span><button type="button" class="button small" data-sheet="${sheet.a}" title="Show it in the code">Show</button></li>`;
    }).join('')}</ul>`;
}

/**
 * Returns the settings form of a complete page.
 * @param {import('./html.js').HtmlElement} html - the <html> element.
 * @returns {string} the form's HTML.
 */
function formatSettingsForm(html) {
    const code = state.code, parsed = state.parsed;
    const title = findFirstElement('title');
    const description = findMetaElement('description'), author = findMetaElement('author');
    const charset = parsed.elements.some(element => element.name === 'meta' && findAttribute(element.tok, 'charset'));
    const viewport = !!findMetaElement('viewport');
    const sheets = parsed.elements.filter(element => element.name === 'link' && /(^|\s)stylesheet(\s|$)/i.test(getAttributeValue(element.tok, 'rel') || ''));
    const cssFiles = Object.keys(state.assets).filter(name => getExtension(name) === 'css' && !sheets.some(sheet => isRefTo(getAttributeValue(sheet.tok, 'href') || '', name)));
    return `
        <div class="doc-form">
            <label class="field"><span>Title <small>(in the browser tab and in search results)</small></span><input id="d-title" value="${escapeHtml(title ? getDecodedText(code.slice(title.ca, title.cb)) : '')}" spellcheck="true"></label>
            <label class="field"><span>Language</span><select id="d-lang">${formatLanguageOptions(getAttributeValue(html.tok, 'lang') || '')}</select></label>
            <label class="field"><span>Description <small>(for search engines)</small></span><textarea id="d-desc" rows="3" spellcheck="true">${escapeHtml(description ? getAttributeValue(description.tok, 'content') || '' : '')}</textarea></label>
            <label class="field"><span>Author</span><input id="d-author" value="${escapeHtml(author ? getAttributeValue(author.tok, 'content') || '' : '')}" spellcheck="false"></label>
            <label class="box"><input type="checkbox" id="d-charset"${charset ? ' checked' : ''}> Characters as UTF-8 (meta charset)</label>
            <label class="box"><input type="checkbox" id="d-viewport"${viewport ? ' checked' : ''}> Fits phone screens (meta viewport)</label>
            <p class="subhead">Linked stylesheets</p>
            ${formatStylesheetList(sheets)}
            ${cssFiles.length ? `<div class="row2"><select id="d-sheet" aria-label="Stylesheet of this document">${cssFiles.map(name => `<option value="${escapeHtml(name)}" data-no-i18n>${escapeHtml(name)}</option>`).join('')}</select><button type="button" class="button" id="d-link">Link it</button></div>` : '<p class="hint">Add a .css file in the Files tab to link it here.</p>'}
        </div>`;
}

/**
 * Connects the Document tab: the language and the two boxes change the code at once, the text
 * fields when typing pauses; leaving the tab draws it again.
 * @returns {void}
 */
export function startSettingsPanel() {
    ui.inspector.addEventListener('change', event => writeSettingChange(event.target));
    ui.inspector.addEventListener('input', event => writeTypedSetting(event.target));
    ui.inspector.addEventListener('focusout', () => setTimeout(() => { if (!ui.inspector.contains(document.activeElement)) renderSettingsPanel(); }, 0));
    ui.inspector.addEventListener('click', handleSettingsClick);
}

/**
 * Writes a changed language, meta charset or viewport into the code.
 * @param {HTMLElement} field - the field that changed.
 * @returns {void}
 */
function writeSettingChange(field) {
    let code = state.code;
    const html = findFirstElement('html');
    if (field.id === 'd-lang' && html) code = setAttributeInCode(code, html.tok, 'lang', field.value || null);
    else if (field.id === 'd-charset') {
        const meta = state.parsed.elements.find(element => element.name === 'meta' && findAttribute(element.tok, 'charset'));
        if (field.checked && !meta) {
            const head = findFirstElement('head');
            code = code.slice(0, head.b) + '\n  <meta charset="utf-8">' + code.slice(head.b);
        } else if (!field.checked && meta) code = removeElementFromCode(code, meta);
    } else if (field.id === 'd-viewport') {
        const meta = findMetaElement('viewport');
        if (field.checked && !meta) code = addToHead(code, '<meta name="viewport" content="width=device-width, initial-scale=1">');
        else if (!field.checked && meta) code = removeElementFromCode(code, meta);
    } else return;
    setSettingCode(code, false);
}

/**
 * Writes a typed title, description or author into the code once typing pauses.
 * @param {HTMLElement} field - the field typed in.
 * @returns {void}
 */
function writeTypedSetting(field) {
    if (!/^d-(title|desc|author)$/.test(field.id)) return;
    clearTimeout(fieldTimers.get(field));
    fieldTimers.set(field, setTimeout(() => {
        if (field.id === 'd-title') setSettingCode(setTitleInCode(state.code, field.value), false);
        else setSettingCode(setMetaInCode(state.code, field.id === 'd-desc' ? 'description' : 'author', field.value), false);
    }, TYPING_DELAY));
}

/**
 * Runs a button of the Document tab: make the code a complete page, link a stylesheet of the
 * document, or show a linked stylesheet in the code.
 * @param {MouseEvent} event - the click.
 * @returns {void}
 */
function handleSettingsClick(event) {
    if (event.target.id === 'make-full') {
        setSettingCode(createBlankPage().replace('\n\n</body>', `\n${state.code.trim().split('\n').map(line => '  ' + line).join('\n')}\n</body>`), 'The code is now a complete page');
    }
    if (event.target.id === 'd-link') {
        const name = getElement('#d-sheet').value;
        if (name) setSettingCode(addToHead(state.code, `<link rel="stylesheet" href="${name}">`), `"${name}" is linked`);
    }
    const sheetButton = event.target.closest('[data-sheet]');
    if (!sheetButton) return;
    const sheet = getElementsByPlace().get(+sheetButton.dataset.sheet);
    if (!sheet) return;
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(sheet.a, true, sheet.b);
}

/**
 * Sets code changed by a setting as one undo step, keeping the cursor where it was in the text
 * around the change.
 * @param {string} code - the changed code.
 * @param {string|false} message - a message to show, false for none.
 * @returns {void}
 */
function setSettingCode(code, message) {
    if (code === state.code) return;
    const textarea = ui.ta, selectionStart = textarea.selectionStart, selectionEnd = textarea.selectionEnd;
    const changeStart = getFirstDifference(state.code, code);
    const delta = code.length - state.code.length;
    addTypingStep();
    setCode(code);
    textarea.setSelectionRange(selectionStart > changeStart ? selectionStart + delta : selectionStart, selectionEnd > changeStart ? selectionEnd + delta : selectionEnd);
    if (message) showToast(message);
}

/**
 * Returns where two texts first differ.
 * @param {string} first - one text.
 * @param {string} second - the other.
 * @returns {number} the index of the first difference (the shorter length when one starts the other).
 */
function getFirstDifference(first, second) {
    let index = 0;
    while (index < first.length && first[index] === second[index]) index++;
    return index;
}
