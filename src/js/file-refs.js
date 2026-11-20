/**
 * Which reference of the code means which file of the document, and the blob: addresses that
 * show the files in the preview. A reference means a file by its name or by the last part of
 * its path ("img/logo.png" means "logo.png"); addresses outside the document (https:, /, #,
 * data: …) mean no file.
 */

import { getRefPath, isOutsideRef, isRefTo } from './html.js?v=6';
import { getMediaType, getDataUrlBytes, getDataUrlText } from './assets.js?v=6';
import { state } from './state.js?v=2';

/** url(…) and @import "…" in CSS. */
const CSS_REF = /url\(\s*(["']?)([^"')\s]*)\1\s*\)|@import\s+(["'])([^"']+)\3/g;
/** The blob: address of each file for the preview, made again when the files change. */
let blobUrls = new Map();
let blobUrlsFiles = null;

/**
 * Returns the file of the document a reference means.
 * @param {string} ref - the reference as written.
 * @returns {string|null} the file's name, null when it means no file of the document.
 */
export function findFileForRef(ref) {
    if (!ref || isOutsideRef(ref)) return null;
    const names = Object.keys(state.assets);
    const path = getRefPath(ref).toLowerCase();
    return names.find(name => name.toLowerCase() === path) || names.find(name => isRefTo(ref, name)) || null;
}

/**
 * Returns the references of the code to files the document does not have.
 * @returns {import('./html.js').HtmlRef[]} the references, in code order.
 */
export function getMissingRefs() {
    if (!state.parsed) return [];
    return state.parsed.refs.filter(ref => ref.kind === 'file' && ref.value && !isOutsideRef(ref.value) && !findFileForRef(ref.value));
}

/**
 * Returns the places where the code uses a file.
 * @param {string} name - the file's name.
 * @returns {import('./html.js').HtmlRef[]} the references that mean it.
 */
export function getFileUses(name) {
    return state.parsed ? state.parsed.refs.filter(ref => ref.value && !isOutsideRef(ref.value) && isRefTo(ref.value, name)) : [];
}

/**
 * Returns the blob: address of a file for the preview; a stylesheet's own url()s point to the
 * other files. A query that fills a cache: the addresses are made once per set
 * of files, the old ones are revoked.
 * @param {string} name - the file's name.
 * @returns {string} the address ("" while a stylesheet that imports itself is being made).
 */
function getBlobUrl(name) {
    if (blobUrlsFiles !== state.assets) {
        for (const url of blobUrls.values()) URL.revokeObjectURL(url);
        blobUrls = new Map();
        blobUrlsFiles = state.assets;
    }
    let url = blobUrls.get(name);
    if (!url) {
        const dataUrl = state.assets[name];
        const type = getMediaType(name) || /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'application/octet-stream';
        blobUrls.set(name, '');                       // a stylesheet that imports itself
        url = URL.createObjectURL(type === 'text/css' ? new Blob([getPreviewCss(getDataUrlText(dataUrl))], { type }) : new Blob([getDataUrlBytes(dataUrl)], { type }));
        blobUrls.set(name, url);
    }
    return url;
}

/**
 * Returns a reference as the preview uses it.
 * @param {string|null} value - the reference as written.
 * @returns {string|null} the file's blob: address, null to leave it (an address outside the document), "" for a missing file.
 */
export function getPreviewRef(value) {
    if (value == null || isOutsideRef(value)) return null;
    const name = findFileForRef(value);
    return name ? getBlobUrl(name) : '';
}

/**
 * Returns CSS with its url() and @import of the document's files as blob: addresses.
 * @param {string} css - the CSS.
 * @returns {string} the CSS for the preview.
 */
export function getPreviewCss(css) {
    return css.replace(new RegExp(CSS_REF.source, 'g'), (whole, quote, url, importQuote, imported) => {
        const previewRef = getPreviewRef(url ?? imported);
        if (previewRef === null) return whole;
        return url != null ? `url("${previewRef}")` : `@import "${previewRef}"`;
    });
}

/**
 * Returns CSS with its url() and @import of the document's files written in place as data:
 * URIs (for the page as one file), stylesheets with their own files inside, up to a depth.
 * @param {string} css - the CSS.
 * @param {number} depth - how deep in imported stylesheets this CSS is.
 * @param {function(string, number): string} getFileDataUri - returns a file as a data: URI.
 * @returns {string} the CSS with the files inside.
 */
export function getInlineCss(css, depth, getFileDataUri) {
    return css.replace(new RegExp(CSS_REF.source, 'g'), (whole, quote, url, importQuote, imported) => {
        const name = findFileForRef(url ?? imported);
        if (!name) return whole;
        const dataUri = getFileDataUri(name, depth + 1);
        return url != null ? `url("${dataUri}")` : `@import "${dataUri}"`;
    });
}
