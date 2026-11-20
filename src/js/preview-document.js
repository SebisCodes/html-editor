/**
 * The page as a document for the preview and for printing: every start tag marked with its
 * place in the code, nothing that could run or leave the frame, the document's files in place
 * of their names.
 *
 * createPreviewDocument() runs these steps:
 *   1. write data-hp="<place of the start tag>" into every start tag of the code;
 *   2. let the browser's DOMParser read the page (no script runs there);
 *   3. take out scripts, <base> and meta refresh, on… attributes and javascript:, vbscript:
 *      and data:text/html addresses;
 *   4. put the document's files in as blob: addresses (src, poster, data of object, href of
 *      stylesheets and SVG images, srcset, url() in style attributes and <style>); a missing
 *      file's attribute is removed.
 * The code keeps everything as it was written.
 */

import { getPreviewRef, getPreviewCss } from './file-refs.js?v=3';

/** Attributes that hold an address that could run script. */
const ADDRESS_ATTRIBUTE = /^(href|src|action|formaction|xlink:href|data)$/i;
/** Addresses that run script or show a page of their own. */
const ACTIVE_ADDRESS = /^\s*(javascript|vbscript|data:text\/html)/i;
/** A file name of a srcset: a run of characters other than spaces and commas. */
const SRCSET_CANDIDATE = /([^\s,][^\s,]*)/g;

/**
 * Returns the page as a document for the preview (the steps in the header).
 * @param {string} code - the code.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @returns {Document} the document, not yet in the frame.
 */
export function createPreviewDocument(code, parsed) {
    const previewDocument = new DOMParser().parseFromString(getMarkedCode(code, parsed), 'text/html');
    previewDocument.querySelectorAll('script, base, meta[http-equiv="refresh" i]').forEach(element => element.remove());
    for (const element of previewDocument.querySelectorAll('*')) {
        removeActiveAttributes(element);
        setFileAddresses(element);
    }
    return previewDocument;
}

/**
 * Returns the code with data-hp, the place of the start tag, in every start tag.
 * @param {string} code - the code.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @returns {string} the marked code.
 */
function getMarkedCode(code, parsed) {
    let marked = '', last = 0;
    for (const element of parsed.elements) {
        marked += code.slice(last, element.tok.nameEnd) + ` data-hp="${element.a}"`;
        last = element.tok.nameEnd;
    }
    return marked + code.slice(last);
}

/**
 * Removes the on… attributes and the addresses that would run script.
 * @param {Element} element - an element of the preview document.
 * @returns {void}
 */
function removeActiveAttributes(element) {
    for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) || (ACTIVE_ADDRESS.test(attribute.value) && ADDRESS_ATTRIBUTE.test(attribute.name))) element.removeAttribute(attribute.name);
    }
}

/**
 * Puts the document's files into an element's attributes and styles as blob: addresses.
 * @param {Element} element - an element of the preview document.
 * @returns {void}
 */
function setFileAddresses(element) {
    const tag = element.localName;
    if (element.hasAttribute('src') && tag !== 'iframe') setFileAddress(element, 'src');
    if (element.hasAttribute('poster')) setFileAddress(element, 'poster');
    if (element.hasAttribute('data') && tag === 'object') setFileAddress(element, 'data');
    if (tag === 'link' && element.hasAttribute('href')) setFileAddress(element, 'href');
    if ((tag === 'image' || tag === 'use') && element.hasAttribute('href')) setFileAddress(element, 'href');
    if (element.hasAttribute('xlink:href')) setFileAddress(element, 'xlink:href');
    if (element.hasAttribute('srcset')) element.setAttribute('srcset', getPreviewSrcset(element.getAttribute('srcset')));
    if (element.hasAttribute('style')) element.setAttribute('style', getPreviewCss(element.getAttribute('style')));
    if (tag === 'style') element.textContent = getPreviewCss(element.textContent);
}

/**
 * Sets an attribute to the blob: address of the file it names; removes it for a missing file;
 * leaves an address outside the document.
 * @param {Element} element - the element.
 * @param {string} name - the attribute.
 * @returns {void}
 */
function setFileAddress(element, name) {
    const previewRef = getPreviewRef(element.getAttribute(name));
    if (previewRef === '') element.removeAttribute(name);
    else if (previewRef) element.setAttribute(name, previewRef);
}

/**
 * Returns a srcset with its file names as blob: addresses (a missing file as about:blank); the
 * width or density after a name stays.
 * @param {string} srcset - the srcset as written.
 * @returns {string} the srcset for the preview.
 */
function getPreviewSrcset(srcset) {
    return srcset.replace(SRCSET_CANDIDATE, (candidate, url, at, all) => {
        const before = all.slice(0, at);
        if (/\s\S*$/.test(before) && !/,\s*$/.test(before)) return candidate;
        const previewRef = getPreviewRef(url);
        return previewRef === null ? candidate : previewRef || 'about:blank';
    });
}
