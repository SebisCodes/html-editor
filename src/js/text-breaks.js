/**
 * Line breaks typed while editing a text in the preview, written as HTML: two or more line
 * breaks are a new paragraph, one a new line (<br>).
 *
 * A new paragraph splits the block the text is in (p, li, h1-h6, dt, dd): the inline elements
 * around the text are closed and opened again after the new start tag (without their id);
 * after the end of a heading it is a <p> (the heading's end tag is then written as </p>). Text
 * in no such block gets <br><br>. Breaks at the start or end of the block's text make no empty
 * paragraph and are left out.
 */

import { escapeText } from './html-tokens.js?v=3';
import { state } from './state.js?v=2';

/** Blocks a new paragraph splits. */
const SPLIT = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd']);
/** Inline elements that are closed and opened again around a split. */
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp',
    'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'del', 'ins', 'font', 'label']);
const INDENT = '  ';

/**
 * The edited text as HTML.
 * @typedef {object} BreaksHtml
 * @property {string} text - the HTML of the changed part.
 * @property {number[]|null} [endTag] - [start, end] of the heading's end tag to be written as </p>, null otherwise.
 * @property {boolean} [bare] - true when a new paragraph starts at the end of the change: the space that stood at the split goes.
 */

/**
 * Where the edited text stands: the block it splits and the inline elements around it.
 * @typedef {object} BreakPlace
 * @property {Element|null} block - the first element around the text that is not inline.
 * @property {Element[]} chain - the inline elements from the text out to the block.
 * @property {import('./html.js').HtmlElement|null} blockElement - the block's element in the code, when it is one that splits.
 * @property {Array<import('./html.js').HtmlElement|null>} chainElements - the inline elements in the code.
 * @property {string} indent - the indentation of the block's line.
 */

/**
 * Returns the changed part of an edited text as HTML (see the header).
 * @param {HTMLElement} span - the editable span around the text in the preview.
 * @param {string} text - the changed part of the text.
 * @param {boolean} atStart - true when the change starts at the start of the text node.
 * @param {string} rest - the edited text after the change.
 * @returns {BreaksHtml} the HTML.
 */
export function formatBreaks(span, text, atStart, rest) {
    if (!text.includes('\n')) return { text: escapeBreakText(text) };
    const place = getBreakPlace(span);
    const around = getTextAround(span, place.block || span.parentElement);
    let breaks = text.replace(/\n{3,}/g, '\n\n');
    if (atStart && !around.before) breaks = breaks.replace(/^\n+/, '');
    if (!(around.after + rest.trim())) breaks = breaks.replace(/\n+$/, '');
    const parts = breaks.split(/(\n+)/);
    const split = !!place.blockElement && place.chainElements.every(Boolean);
    const heading = split && /^h[1-6]$/.test(place.block.localName) && !(around.after + rest.trim());
    const html = formatBreakParts(parts, place, split, heading);
    // A new paragraph starts without the space that stood at the split.
    const bare = split && parts.length > 1 && parts[parts.length - 1] === '' && parts[parts.length - 2].length > 1;
    return { text: html, endTag: heading && breaks.includes('\n\n') ? [place.blockElement.cb, place.blockElement.e] : null, bare };
}

/**
 * Returns typed text as HTML text; a no-break space (as an editable element types it at the
 * end of a line) is written as a normal space.
 * @param {string} text - the text.
 * @returns {string} the escaped text.
 */
function escapeBreakText(text) {
    return escapeText(text.replace(/\u00a0/g, ' '));
}

/**
 * Returns where the edited text stands: its block, the inline elements around it and their
 * elements in the code.
 * @param {HTMLElement} span - the editable span.
 * @returns {BreakPlace} the place.
 */
function getBreakPlace(span) {
    const chain = [];
    let block = span.parentElement;
    while (block && INLINE.has(block.localName)) { chain.push(block); block = block.parentElement; }
    const blockElement = block && SPLIT.has(block.localName) ? findCodeElement(block) : null;
    const marked = span.closest('[data-hp]');
    const indentFrom = blockElement ? blockElement.a : marked ? +marked.getAttribute('data-hp') : 0;
    return { block, chain, blockElement, chainElements: chain.map(findCodeElement), indent: /^[ \t]*/.exec(getLineBefore(indentFrom))[0] };
}

/**
 * Returns the element of the code a preview element was made from.
 * @param {Element|null} node - the preview element.
 * @returns {import('./html.js').HtmlElement|null} the element, null when it carries no place.
 */
function findCodeElement(node) {
    const place = node?.getAttribute('data-hp');
    return place == null ? null : state.parsed.elements.find(element => element.a === +place) || null;
}

/**
 * Returns the code of a line from its start up to a place.
 * @param {number} place - the place in the code.
 * @returns {string} the line's code before the place.
 */
function getLineBefore(place) {
    return state.code.slice(state.code.lastIndexOf('\n', place - 1) + 1, place);
}

/**
 * Returns what the block holds before and after the edited text node: it decides whether a
 * break there makes an empty paragraph.
 * @param {HTMLElement} span - the editable span.
 * @param {Element} around - the block, or the element around the span.
 * @returns {{before: string, after: string}} the trimmed texts.
 */
function getTextAround(span, around) {
    const range = span.ownerDocument.createRange();
    range.selectNodeContents(around);
    range.setEndBefore(span);
    const before = range.toString().trim();
    range.selectNodeContents(around);
    range.setStartAfter(span);
    return { before, after: range.toString().trim() };
}

/**
 * Returns the parts of the edited text as HTML: text escaped, one break as <br>, two as a new
 * paragraph (or <br><br> where the block does not split).
 * @param {string[]} parts - text and runs of line breaks, alternating.
 * @param {BreakPlace} place - where the text stands.
 * @param {boolean} split - true when the block and every inline element around the text are in the code.
 * @param {boolean} heading - true when the new paragraph after a heading's end is a <p>.
 * @returns {string} the HTML.
 */
function formatBreakParts(parts, place, split, heading) {
    let current = split ? place.block.localName : null, html = '';
    for (const [index, part] of parts.entries()) {
        if (!(index % 2)) { html += escapeBreakText(part); continue; }
        if (part.length === 1) { html += '<br>\n' + place.indent + INDENT; continue; }
        if (!split) { html += '<br><br>\n' + place.indent + INDENT; continue; }
        const next = heading ? 'p' : place.block.localName;
        html += formatParagraphSplit(place, current, next);
        current = next;
    }
    return html;
}

/**
 * Returns the HTML that ends a paragraph and starts the next: the inline elements closed, the
 * block's end tag, a new line and the start tags opened again (without their id).
 * @param {BreakPlace} place - where the text stands.
 * @param {string} current - the name of the block being ended.
 * @param {string} next - the name of the new block.
 * @returns {string} the HTML.
 */
function formatParagraphSplit(place, current, next) {
    const closing = place.chain.map(element => `</${element.localName}>`).join('');
    const opening = next === place.block.localName ? getStartTagWithoutId(place.blockElement) : '<p>';
    return closing + `</${current}>\n` + place.indent + opening + [...place.chainElements].reverse().map(getStartTagWithoutId).join('');
}

/**
 * Returns the start tag of an element as written, without its id.
 * @param {import('./html.js').HtmlElement} element - the element.
 * @returns {string} the start tag.
 */
function getStartTagWithoutId(element) {
    return state.code.slice(element.a, element.b).replace(/\s+id\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
}
