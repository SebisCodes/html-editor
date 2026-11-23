/**
 * The example view of the HTML editor: the template filled with the page's examples
 * (template-expansion.js), each example written for its place in HTML, and the source the
 * preview reads, with every element marked with its place in the code.
 *
 * buildExampleSource() runs these steps:
 *   1. find the place of every tag in the code: text, raw text (style, script, textarea …), an
 *      attribute's value, a comment, or the markup itself;
 *   2. fill the template: text and attribute values get the characters of markup as entities, CSS
 *      only plain words and numbers, an event attribute, a script or the markup itself nothing;
 *   3. read the filled text and mark every start tag with the place of its element in the code
 *      (data-hp) and in the filled text (data-hv); an attribute that names a file or address and held a placeholder in the code
 *      (or holds filled text) is renamed to data-htmleditor-held-<name>, and the CSS of a style
 *      element that held one is written with only local addresses, before the browser reads the
 *      source: such an address can only show an example picture or a file of the document.
 */

import { getTemplateTags, hasTemplatePlaceholder } from './template-tags.js?v=1';
import { expandTemplate, getCodeOffsetByViewOffset, hasFillInRange } from './template-expansion.js?v=1';
import { parse } from './html.js?v=7';
import { findAttribute } from './html-tokens.js?v=3';

/** The prefix of an attribute held back from the browser until the preview resolves it. */
export const HELD_PREFIX = 'data-htmleditor-held-';
/** Marks a style element whose CSS was written with only local addresses before reading. */
export const HELD_CSS_ATTRIBUTE = 'data-htmleditor-held-css';
/** The attributes that name a file or an address the browser may load or go to, or hold CSS or a page. */
export const REFERENCE_ATTRIBUTES = new Set(['src', 'srcset', 'href', 'xlink:href', 'poster', 'data', 'background', 'action', 'formaction', 'ping', 'srcdoc', 'imagesrcset', 'style', 'lowsrc', 'dynsrc', 'manifest', 'codebase', 'archive', 'longdesc', 'cite', 'profile']);
/** What CSS keeps of an example: letters, digits, spaces and # % . , _ + -. */
const CSS_UNSAFE = /[^\p{L}\p{N} #%.,_+-]/gu;
/** The characters of an attribute value written as entities. */
const ATTRIBUTE_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '=': '&#61;', '`': '&#96;' };
/** The characters of text written as entities. */
const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/**
 * Where a tag stands in the code.
 * @typedef {object} HtmlTagPlace
 * @property {string} kind - "text", "rawtext", "css", "attribute", "comment" or "drop" (script, markup).
 * @property {string} [name] - attribute: the attribute's name in lower case.
 * @property {string} [quote] - attribute: the quote around the value ('"', "'" or "").
 */

/**
 * Fills the template with the examples (steps 1 and 2 of the header).
 * @param {string} code - the template.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read (tags in brace form).
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @param {?import('./template-examples.js').TemplateExamples} examples - the page's examples.
 * @returns {import('./template-expansion.js').TemplateView} the filled text and its map.
 * @throws {import('./template-expansion.js').TemplateExpansionError} when the filling goes past its limits.
 */
export function buildHtmlView(code, parsed, syntax, examples) {
    const places = getTagPlaces(parsed, getTemplateTags(code, syntax));
    return expandTemplate(code, syntax, { examples, writeFill: (tag, fill, before) => writeHtmlFill(places.get(tag.start), fill, before) });
}

/**
 * Returns the place of every tag, by the tag's start: the token of the code that holds it.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags, in order.
 * @returns {Map<number, HtmlTagPlace>} the places.
 */
export function getTagPlaces(parsed, tags) {
    const places = new Map();
    const tokens = parsed.toks;
    let index = 0;
    for (const tag of tags) {
        while (index < tokens.length && tokens[index].b <= tag.start) index++;
        const token = tokens[index] && tokens[index].a <= tag.start ? tokens[index] : null;
        places.set(tag.start, getTokenPlace(token, tag));
    }
    return places;
}

/**
 * Returns the place of a tag inside one token.
 * @param {?import('./html-tokens.js').HtmlToken} token - the token that holds the tag, or null.
 * @param {import('./template-tags.js').TemplateTag} tag - the tag.
 * @returns {HtmlTagPlace} the place.
 */
function getTokenPlace(token, tag) {
    if (!token || token.t === 'text') return { kind: 'text' };
    if (token.t === 'comment') return { kind: 'comment' };
    if (token.t === 'raw') return { kind: token.name === 'style' ? 'css' : token.name === 'script' ? 'drop' : token.rc ? 'text' : 'rawtext' };
    if (token.t !== 'start') return { kind: 'drop' };
    const attribute = (token.attrs || []).find(item => item.va >= 0 && item.va <= tag.start && tag.end <= item.vb);
    return attribute ? { kind: 'attribute', name: attribute.name, quote: attribute.q } : { kind: 'drop' };
}

/**
 * Writes a tag's fill for its place in HTML.
 * @param {?HtmlTagPlace} place - where the tag stands.
 * @param {import('./template-expansion.js').TagFill} fill - what it is filled with.
 * @param {string} [before=''] - the filled text just before the fill.
 * @returns {string} the HTML of the fill.
 */
export function writeHtmlFill(place, fill, before = '') {
    const text = fill.text;
    switch (place ? place.kind : 'text') {
        case 'attribute': return writeAttributeFill(place, text);
        case 'css': return text.replace(CSS_UNSAFE, '');
        case 'rawtext': return text.replace(/</g, '');
        case 'comment': return text.replace(/[-<>!]/g, '');
        case 'drop': return '';
        default: return writeTextFill(text, /<\/?[A-Za-z0-9:-]*$/.test(before));
    }
}

/**
 * Writes a fill in text: the characters of markup as entities, and right after "<" or "</" and the
 * letters of a tag name in the filled text (also where they only stand after sections were left
 * out) the first character too, so the fill never starts or continues markup.
 * @param {string} text - the fill's text.
 * @param {boolean} isAfterOpening - true when "<" or "</" (with the letters of a tag name) stands right before the fill.
 * @returns {string} the HTML of the fill.
 */
function writeTextFill(text, isAfterOpening) {
    const escaped = text.replace(/[&<>]/g, character => TEXT_ESCAPES[character]);
    if (!isAfterOpening || !escaped || escaped[0] === '&') return escaped;
    const first = String.fromCodePoint(escaped.codePointAt(0));
    return `&#${first.codePointAt(0)};` + escaped.slice(first.length);
}

/**
 * Writes a fill inside an attribute's value: nothing in an event attribute, plain CSS in style,
 * else the text with the characters of markup and quotes as entities (and spaces too without quotes).
 * @param {HtmlTagPlace} place - the attribute's place.
 * @param {string} text - the fill's text.
 * @returns {string} the value's part.
 */
function writeAttributeFill(place, text) {
    if (/^on/.test(place.name)) return '';
    const value = place.name === 'style' ? text.replace(CSS_UNSAFE, '') : text;
    const escaped = value.replace(/[&<>"'=`]/g, character => ATTRIBUTE_ESCAPES[character]);
    return place.quote ? escaped : escaped.replace(/\s/g, character => `&#${character.charCodeAt(0)};`);
}

/**
 * Builds the source the preview reads for the example view (step 3 of the header).
 * @param {string} code - the template.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @param {import('./template-expansion.js').TemplateView} view - the filled text and its map.
 * @param {function(string): string} getHeldCss - writes CSS with only local addresses.
 * @returns {string} the source with data-hp in every start tag and the held attributes renamed.
 */
export function buildExampleSource(code, parsed, view, getHeldCss) {
    const viewParsed = parse(view.text, { isTemplate: false });
    const elementsByPlace = new Map(parsed.elements.map(element => [element.a, element]));
    const edits = [];
    for (const element of viewParsed.elements) {
        const codeElement = elementsByPlace.get(getCodeOffsetByViewOffset(view.map, element.a)) || null;
        edits.push({ at: element.tok.nameEnd, end: element.tok.nameEnd, text: ` data-hp="${getCodeOffsetByViewOffset(view.map, element.a)}" data-hv="${element.a}"` });
        for (const attribute of element.tok.attrs || []) {
            if (isHeldAttribute(code, view, attribute, codeElement)) edits.push({ at: attribute.a, end: attribute.a, text: HELD_PREFIX });
        }
        if (element.name === 'style' && element.cb > element.ca && isHeldContent(code, view, element, codeElement)) {
            edits.push({ at: element.tok.nameEnd, end: element.tok.nameEnd, text: ` ${HELD_CSS_ATTRIBUTE}` });
            edits.push({ at: element.ca, end: element.cb, text: getHeldCss(view.text.slice(element.ca, element.cb)).replace(/<\//g, '<\\/') });
        }
    }
    return applySourceEdits(view.text, edits);
}

/**
 * Tells whether an attribute of the filled text is held back: it names a file or an address (or
 * holds CSS or a page), and in the code it held a placeholder, or it holds filled text, or its
 * element or the attribute is not found in the code.
 * @param {string} code - the template.
 * @param {import('./template-expansion.js').TemplateView} view - the filled text and its map.
 * @param {import('./html-tokens.js').HtmlAttribute} attribute - the attribute in the filled text.
 * @param {?import('./html.js').HtmlElement} codeElement - its element in the code, or null.
 * @returns {boolean} true when the attribute is held back.
 */
function isHeldAttribute(code, view, attribute, codeElement) {
    if (!REFERENCE_ATTRIBUTES.has(attribute.name) || attribute.va < 0) return false;
    if (hasFillInRange(view.map, attribute.va, attribute.vb)) return true;
    const codeAttribute = codeElement ? findAttribute(codeElement.tok, attribute.name) : null;
    return !codeAttribute || codeAttribute.va < 0 || hasTemplatePlaceholder(code.slice(codeAttribute.va, codeAttribute.vb));
}

/**
 * Tells whether the content of a style element of the filled text is held back: it holds filled
 * text, or its content in the code held a placeholder, or its element is not found in the code.
 * @param {string} code - the template.
 * @param {import('./template-expansion.js').TemplateView} view - the filled text and its map.
 * @param {import('./html.js').HtmlElement} element - the style element in the filled text.
 * @param {?import('./html.js').HtmlElement} codeElement - its element in the code, or null.
 * @returns {boolean} true when the content is held back.
 */
function isHeldContent(code, view, element, codeElement) {
    if (hasFillInRange(view.map, element.ca, element.cb)) return true;
    return !codeElement || hasTemplatePlaceholder(code.slice(codeElement.ca, codeElement.cb));
}

/**
 * An edit of the filled text: an insertion (end equal to at) or a replacement.
 * @typedef {object} SourceEdit
 * @property {number} at - where it starts.
 * @property {number} end - where the replaced text ends.
 * @property {string} text - the new text.
 */

/**
 * Applies edits to a text: insertions and replacements at places of the text.
 * @param {string} text - the text.
 * @param {SourceEdit[]} edits - the edits; replacements do not overlap.
 * @returns {string} the edited text.
 */
function applySourceEdits(text, edits) {
    edits.sort((first, second) => first.at - second.at || first.end - second.end);
    let result = '', last = 0;
    for (const edit of edits) {
        if (edit.at < last) continue;
        result += text.slice(last, edit.at) + edit.text;
        last = edit.end;
    }
    return result + text.slice(last);
}
