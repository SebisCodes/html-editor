/**
 * Highlighting of HTML with its CSS and JavaScript for the code view: the code comes back as
 * HTML with spans of the classes the stylesheet colors (k names, a attributes, s strings,
 * e entities and numbers, c comments, d declarations and at-rules, p punctuation).
 *
 * highlight() runs these steps for each token of the code:
 *   1. text with its entities, comments and declarations as they are;
 *   2. start tags with their attributes (CSS in style="", JavaScript in on… attributes);
 *   3. the content of <style> as CSS, of a JavaScript <script> as JavaScript, of textarea and
 *      title as text.
 */

import { parseTokens, escapeHtml, getAttributeValue, highlightEntities } from './html-tokens.js?v=3';

const JS_WORDS = 'async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield';
/** Comments, strings, numbers and key words of JavaScript. */
const JS_TOKEN = new RegExp('(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))|("(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?|`(?:\\\\[\\s\\S]|[^`\\\\])*`?)|\\b(0[xX][\\da-fA-F]+|\\d[\\d_]*\\.?\\d*(?:[eE][+-]?\\d+)?)\\b|\\b(' + JS_WORDS.split(' ').join('|') + ')\\b', 'g');
/** Colors and numbers with their units in a CSS value. */
const CSS_VALUE_PART = /(#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt|cm|mm|ch)?\b)|([^#\d.-]+|[#\d.-])/g;
/** How far a ":" looks ahead to tell a nested selector ("a:hover {") from a property. */
const CSS_LOOKAHEAD = 400;

/**
 * Returns a part of the code in a span of a class; nothing for an empty part.
 * @param {string} className - the class.
 * @param {string} text - the code.
 * @returns {string} the escaped code in its span.
 */
function formatSpan(className, text) {
    return text ? `<span class="${className}">${escapeHtml(text)}</span>` : '';
}

/**
 * Returns the code highlighted (the steps in the header).
 * @param {string} source - the HTML code.
 * @returns {string} the code as HTML with spans.
 */
export function highlight(source) {
    let out = '';
    let scriptKind = 'js';
    for (const token of parseTokens(source)) {
        const text = source.slice(token.a, token.b);
        if (token.t === 'text') out += highlightEntities(text, formatSpan);
        else if (token.t === 'comment') out += formatSpan('c', text);
        else if (token.t === 'doctype') out += formatSpan('d', text);
        else if (token.t === 'end') out += formatSpan('p', '</') + formatSpan('k', source.slice(token.a + 2, token.nameEnd)) + formatSpan('p', source.slice(token.nameEnd, token.b));
        else if (token.t === 'start') {
            out += highlightTag(source, token);
            if (token.name === 'script') scriptKind = getScriptKind(token);
        } else if (token.t === 'raw') out += highlightRaw(token, text, scriptKind);
    }
    return out;
}

/**
 * Returns whether a script element holds JavaScript (no type, a JavaScript, module or JSON
 * type) or other text.
 * @param {import('./html-tokens.js').HtmlToken} token - the script's start tag.
 * @returns {string} "js" or "text".
 */
function getScriptKind(token) {
    const type = (getAttributeValue(token, 'type') || '').toLowerCase();
    return !type || /javascript|module|json/.test(type) ? 'js' : 'text';
}

/**
 * Returns the raw content of an element highlighted by its kind.
 * @param {import('./html-tokens.js').HtmlToken} token - the raw token.
 * @param {string} text - its code.
 * @param {string} scriptKind - "js" or "text", for the content of a script.
 * @returns {string} the highlighted content.
 */
function highlightRaw(token, text, scriptKind) {
    if (token.name === 'style') return highlightCss(text);
    if (token.name === 'script' && scriptKind === 'js') return highlightJavaScript(text);
    return token.rc ? highlightEntities(text, formatSpan) : escapeHtml(text);
}

/**
 * Returns a start tag highlighted: name, attributes and their values.
 * @param {string} source - the code.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @returns {string} the highlighted tag.
 */
function highlightTag(source, token) {
    let out = formatSpan('p', '<') + formatSpan('k', source.slice(token.a + 1, token.nameEnd));
    let last = token.nameEnd;
    for (const attribute of token.attrs) {
        out += escapeHtml(source.slice(last, attribute.a)) + formatSpan('a', source.slice(attribute.a, attribute.nb));
        if (attribute.va >= 0) out += highlightAttributeValue(source, token, attribute);
        last = attribute.b;
    }
    return out + formatSpan('p', source.slice(last, token.b));
}

/**
 * Returns the "=" and the value of an attribute highlighted: CSS in style, JavaScript in on…
 * attributes, text with entities in the others.
 * @param {string} source - the code.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @param {import('./html-tokens.js').HtmlAttribute} attribute - the attribute.
 * @returns {string} the highlighted value with its quotes.
 */
function highlightAttributeValue(source, token, attribute) {
    const value = source.slice(attribute.va, attribute.vb);
    const equals = formatSpan('p', source.slice(attribute.nb, attribute.va - (attribute.q ? 1 : 0)));
    const inner = attribute.name === 'style' ? highlightCss(value, true) : /^on/.test(attribute.name) ? highlightJavaScript(value) : `<span class="s">${highlightEntities(value, formatSpan)}</span>`;
    if (!attribute.q) return equals + inner;
    const quote = `<span class="s">${escapeHtml(attribute.q)}</span>`;
    return equals + quote + inner + (attribute.vb < token.b ? quote : '');
}

/**
 * Returns JavaScript highlighted: comments, strings, numbers and key words.
 * @param {string} script - the JavaScript.
 * @returns {string} the highlighted code.
 */
export function highlightJavaScript(script) {
    let out = '', last = 0, match;
    JS_TOKEN.lastIndex = 0;
    while ((match = JS_TOKEN.exec(script))) {
        out += escapeHtml(script.slice(last, match.index));
        out += formatSpan(match[1] ? 'c' : match[2] ? 's' : match[3] ? 'e' : 'k', match[0]);
        last = match.index + match[0].length;
        if (!match[0]) JS_TOKEN.lastIndex++;
    }
    return out + escapeHtml(script.slice(last));
}

/**
 * The state of highlightCss() while it reads.
 * @typedef {object} CssReader
 * @property {string} css - the CSS.
 * @property {number} position - the character being read.
 * @property {string} out - the highlighted code so far.
 * @property {number} depth - how many blocks are open.
 * @property {string} mode - what the characters collected belong to: "sel", "prop" or "val".
 * @property {string} buffer - the characters collected since the last mark.
 */

/**
 * Returns CSS highlighted: selectors, properties, values, at-rules, comments and strings.
 * @param {string} css - the CSS.
 * @param {boolean} [inBlock] - true for a declaration list (a style attribute).
 * @returns {string} the highlighted code.
 */
export function highlightCss(css, inBlock = false) {
    const reader = { css, position: 0, out: '', depth: inBlock ? 1 : 0, mode: inBlock ? 'prop' : 'sel', buffer: '' };
    while (reader.position < css.length) readCssCharacter(reader);
    addCssBuffer(reader);
    return reader.out;
}

/**
 * Reads the character at the reader's place: a comment, a string, a block mark, the end of a
 * declaration, the ":" of a property, or a character of the part being collected.
 * @param {CssReader} reader - the reader.
 * @returns {void}
 */
function readCssCharacter(reader) {
    const character = reader.css[reader.position];
    if (character === '/' && reader.css[reader.position + 1] === '*') { readCssComment(reader); return; }
    if (character === '"' || character === "'") { readCssString(reader, character); return; }
    if (character === '{') { addCssMark(reader, character, 'prop'); reader.depth++; return; }
    if (character === '}') {
        reader.depth = Math.max(0, reader.depth - 1);
        addCssMark(reader, character, reader.depth ? 'prop' : 'sel');
        return;
    }
    if (character === ';') { addCssMark(reader, character, reader.depth ? 'prop' : 'sel'); return; }
    if (character === ':' && reader.mode === 'prop' && !isNestedSelector(reader)) { addCssMark(reader, character, 'val'); return; }
    if (character === ':' && reader.mode === 'prop') reader.mode = 'sel';
    reader.buffer += character;
    reader.position++;
}

/**
 * Tells whether a ":" in a declaration list starts a nested selector ("a:hover {"): a "{"
 * comes before the next ";" or "}".
 * @param {CssReader} reader - the reader, at the ":".
 * @returns {boolean} true for a nested selector.
 */
function isNestedSelector(reader) {
    const rest = reader.css.slice(reader.position, reader.position + CSS_LOOKAHEAD);
    const next = rest.search(/[{;}]/);
    return next >= 0 && rest[next] === '{';
}

/**
 * Adds the collected part and a punctuation mark, and switches to what follows the mark.
 * @param {CssReader} reader - the reader, at the mark.
 * @param {string} mark - the character.
 * @param {string} nextMode - "sel", "prop" or "val".
 * @returns {void}
 */
function addCssMark(reader, mark, nextMode) {
    addCssBuffer(reader);
    reader.out += formatSpan('p', mark);
    reader.mode = nextMode;
    reader.position++;
}

/**
 * Adds a comment up to its end.
 * @param {CssReader} reader - the reader, at "/*".
 * @returns {void}
 */
function readCssComment(reader) {
    addCssBuffer(reader);
    const close = reader.css.indexOf('*/', reader.position + 2);
    const end = close < 0 ? reader.css.length : close + 2;
    reader.out += formatSpan('c', reader.css.slice(reader.position, end));
    reader.position = end;
}

/**
 * Adds a string up to its closing quote or the end of its line.
 * @param {CssReader} reader - the reader, at the quote.
 * @param {string} quote - the quote.
 * @returns {void}
 */
function readCssString(reader, quote) {
    addCssBuffer(reader);
    const { css } = reader;
    let end = reader.position + 1;
    while (end < css.length && css[end] !== quote && css[end] !== '\n') {
        if (css[end] === '\\') end++;
        end++;
    }
    reader.out += formatSpan('s', css.slice(reader.position, end + 1));
    reader.position = end + 1;
}

/**
 * Adds the collected characters as a selector (or at-rule), a property or a value.
 * @param {CssReader} reader - the reader.
 * @returns {void}
 */
function addCssBuffer(reader) {
    const text = reader.buffer;
    if (!text) return;
    if (reader.mode === 'sel') reader.out += /^\s*@/.test(text) ? text.replace(/^(\s*)(@[\w-]+)([\s\S]*)$/, (whole, space, rule, rest) => escapeHtml(space) + formatSpan('d', rule) + escapeHtml(rest)) : formatSpan('k', text);
    else if (reader.mode === 'prop') reader.out += formatSpan('a', text);
    else reader.out += text.replace(CSS_VALUE_PART, (whole, number, rest) => (number ? formatSpan('e', number) : escapeHtml(rest)));
    reader.buffer = '';
}
