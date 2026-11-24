/**
 * Which reference of the code means which file of the document, and the blob: addresses that
 * show the files in the preview. A reference means a file by its name or by the last part of
 * its path ("img/logo.png" means "logo.png"); addresses outside the document (https:, /, #,
 * data: …) mean no file.
 */

import { getRefPath, isOutsideRef, isRefTo } from './html.js?v=8';
import { getMediaType, getDataUrlBytes, getDataUrlText } from './assets.js?v=6';
import { state } from './state.js?v=2';
import { hasTemplatePlaceholder, buildTemplatePicture } from './template-tags.js?v=2';
import { buildEscapeSafeCss, buildCssWithAddresses, IMPORT_ADDRESS } from './css-references.js?v=2';

/** An empty stylesheet, in the place of an imported one whose address holds a placeholder. */
const EMPTY_STYLESHEET = 'data:text/css,';
/** A data address: a stylesheet given as one can name further addresses in an encoding of its own. */
export const DATA_ADDRESS = /^\s*data:/i;
/** A data address anywhere in CSS. */
const DATA_IN_CSS = /data:/i;
/** url(…) and @import "…" in CSS. */
const CSS_REF = /url\(\s*(["']?)([^"')\s]*)\1\s*\)|@import\s*(["'])([^"']+)\3/g;
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
 * Builds a CSS text for the preview: pieces with an escape that could spell an address are left
 * out (css-references.js), and in CSS that holds a placeholder or a data address every url(),
 * string of image-set() and @import whose address holds a placeholder names a placeholder
 * picture or an empty stylesheet, as does an @import of a data address, so the preview requests
 * nothing for them; such CSS is read with each comment as a space.
 * @param {string} css - the CSS.
 * @returns {string} the CSS with the placeholder addresses in their preview form; the CSS itself when nothing is held.
 */
function buildPlaceholderCss(css) {
    const safe = buildEscapeSafeCss(css);
    return hasTemplatePlaceholder(safe) || DATA_IN_CSS.test(safe) ? buildCssWithAddresses(safe, getPlaceholderAddress) : safe;
}

/**
 * Returns the address the preview writes for an address of CSS: an @import of a data address or
 * of an address with a placeholder an empty stylesheet, any other address with a placeholder the
 * placeholder picture.
 * @param {string} address - the address as written.
 * @param {string} kind - IMPORT_ADDRESS or the kind of a picture or font (css-references.js).
 * @returns {?string} the address to write, null to keep the address as written.
 */
function getPlaceholderAddress(address, kind) {
    if (kind === IMPORT_ADDRESS && DATA_ADDRESS.test(address)) return EMPTY_STYLESHEET;
    if (!hasTemplatePlaceholder(address)) return null;
    return kind === IMPORT_ADDRESS ? EMPTY_STYLESHEET : buildTemplatePicture(address);
}

/**
 * Returns CSS with its url() and @import of the document's files as blob: addresses; an address
 * that holds a placeholder becomes a placeholder picture or an empty stylesheet.
 * @param {string} css - the CSS.
 * @returns {string} the CSS for the preview.
 */
export function getPreviewCss(css) {
    return buildPlaceholderCss(css).replace(new RegExp(CSS_REF.source, 'g'), (whole, quote, url, importQuote, imported) => {
        const previewRef = getPreviewRef(url ?? imported);
        if (previewRef === null) return whole;
        return url != null ? `url("${previewRef}")` : `@import "${previewRef}"`;
    });
}

/**
 * Returns the local address of a reference the example view of a template held back: an example
 * picture by its name, else a file of the document. Nothing else is loaded for it.
 * @param {string} value - the reference as the filled text holds it.
 * @param {function(string): ?string} getExampleAddress - returns the blob: address of an example picture by name.
 * @returns {?string} the blob: address, or null when the reference means neither.
 */
export function getHeldPreviewRef(value, getExampleAddress) {
    const address = String(value).trim();
    const example = getExampleAddress(address);
    if (example) return example;
    return getPreviewRef(address) || null;
}

/**
 * Returns CSS the example view of a template held back, with only local addresses: each url(),
 * string of image-set() and @import an example picture or a file of the document, else a
 * placeholder picture or an empty stylesheet. The CSS is read as css-references.js reads it:
 * pieces with an escape that could spell an address are left out, a comment reads as a space,
 * an @import of another form is left out and a url( left open at the end counts as well.
 * @param {string} css - the CSS as the filled text holds it.
 * @param {function(string): ?string} getExampleAddress - returns the blob: address of an example picture by name.
 * @returns {string} the CSS for the preview.
 */
export function getHeldPreviewCss(css, getExampleAddress) {
    return buildCssWithAddresses(css, (address, kind) => getHeldPreviewRef(address, getExampleAddress)
        || (kind === IMPORT_ADDRESS ? EMPTY_STYLESHEET : buildTemplatePicture(address)));
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
