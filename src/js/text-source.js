/**
 * Where a text of the preview is in the code, for editing it in place. The text lies between
 * the start tags of the marked elements before and after it; of the texts of the code there,
 * the one with the same characters (an entity counts as its character) is it. Texts in style,
 * textarea, title, select, svg, math and the like are not edited in place.
 */

import { getDecodedRange } from './html-tokens.js?v=3';
import { state } from './state.js?v=2';

/** Elements whose text is not edited in place. */
const NOT_EDITABLE = 'style, textarea, title, select, option, noscript, svg, math, iframe, object, template, [contenteditable="true"]';

/**
 * Where a text of the preview is in the code.
 * @typedef {object} TextSource
 * @property {number} a - where the text starts in the code.
 * @property {number} b - where it ends.
 * @property {import('./html-tokens.js').DecodedRange} d - its decoded text with the places of the characters.
 */

/**
 * Returns where a text of the preview is in the code. The text lies between the start tags of
 * the marked elements before and after it; of the texts of the code there, the one with the
 * same characters is it (the same text more than once: counted in order).
 * @param {Node} node - a text node of the preview.
 * @returns {TextSource|null} the place, null when the text is not in the code as shown.
 */
export function getTextSource(node) {
    const previewDocument = state.previewDocument;
    if (!previewDocument || !node || node.nodeType !== Node.TEXT_NODE || !previewDocument.body || !previewDocument.body.contains(node) || !state.parsed) return null;
    const parent = node.parentElement;
    if (!parent || parent.closest(NOT_EDITABLE)) return null;
    if (!node.data.trim()) return null;
    const previous = findPreviousMarked(node);
    const list = state.previewElements;
    const from = previous >= 0 ? +list[previous].getAttribute('data-hp') : 0;
    const to = previous + 1 < list.length ? +list[previous + 1].getAttribute('data-hp') : state.code.length;
    const found = findMatchingTexts(node.data, from, to, /^(PRE|LISTING)$/.test(parent.tagName));
    if (found.length <= 1) return found[0] || null;
    return found[getSameTextCountBefore(node, previous)] || null;
}

/**
 * Returns the last marked element of the preview before a node.
 * @param {Node} node - the node.
 * @returns {number} its index in state.previewElements, -1 when there is none.
 */
function findPreviousMarked(node) {
    const list = state.previewElements;
    let low = 0, high = list.length - 1, previous = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (list[middle].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) { previous = middle; low = middle + 1; } else high = middle - 1;
    }
    return previous;
}

/**
 * Returns the texts of the code between two places whose decoded text is a given text. In
 * <pre> the line break right after the start tag is not shown and does not count.
 * @param {string} text - the text as the preview shows it.
 * @param {number} from - the start of the stretch.
 * @param {number} to - its end.
 * @param {boolean} inPre - true when the text is in <pre> or <listing>.
 * @returns {TextSource[]} the matching texts in code order.
 */
function findMatchingTexts(text, from, to, inPre) {
    const code = state.code;
    const found = [];
    for (const codeText of state.parsed.texts) {
        if (codeText.a < from || codeText.b > to) continue;
        let start = codeText.a;
        if (inPre && code[start] === '\n' && code.slice(start + 1, codeText.b) && getDecodedRange(code, start + 1, codeText.b).text === text) start++;
        const decoded = getDecodedRange(code, start, codeText.b);
        if (decoded.text === text) found.push({ a: start, b: codeText.b, d: decoded });
    }
    return found;
}

/**
 * Counts the text nodes with the same text before a node, after the last marked element.
 * @param {Node} node - the text node.
 * @param {number} previous - the index of the last marked element before it, -1 for none.
 * @returns {number} how many come before it.
 */
function getSameTextCountBefore(node, previous) {
    const previewDocument = state.previewDocument;
    const list = state.previewElements;
    const walker = previewDocument.createTreeWalker(previewDocument.body, NodeFilter.SHOW_TEXT);
    let count = 0, other;
    while ((other = walker.nextNode()) && other !== node) {
        if (other.data === node.data && (previous < 0 || list[previous].compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)) count++;
    }
    return count;
}
