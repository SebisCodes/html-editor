/**
 * Changes of the page's head as the document settings make them: an attribute of a start tag,
 * a line before </head>, an element removed with its line, the title and the meta tags. Each
 * function returns the changed code; the caller sets it.
 */

import { escapeText, escapeAttribute, findAttribute, getAttributeValue } from './html-tokens.js?v=3';
import { state } from './state.js?v=2';

/**
 * Returns the first element of a name.
 * @param {string} name - the element name.
 * @returns {import('./html.js').HtmlElement|null} the element, null when there is none.
 */
export function findFirstElement(name) {
    return state.parsed?.elements.find(element => element.name === name) || null;
}

/**
 * Returns the meta tag of a name ("description", "author", "viewport").
 * @param {string} name - the meta tag's name, in lower case.
 * @returns {import('./html.js').HtmlElement|null} the element, null when there is none.
 */
export function findMetaElement(name) {
    return state.parsed?.elements.find(element => element.name === 'meta' && (getAttributeValue(element.tok, 'name') || '').toLowerCase() === name) || null;
}

/**
 * Returns the code with an attribute of a start tag set, added or (value null) removed.
 * @param {string} code - the code.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @param {string} name - the attribute.
 * @param {string|null} value - its value; null removes it.
 * @returns {string} the changed code.
 */
export function setAttributeInCode(code, token, name, value) {
    const attribute = findAttribute(token, name);
    if (attribute) {
        if (value == null) {
            let start = attribute.a;
            while (start > 0 && /[ \t\n]/.test(code[start - 1])) start--;
            return code.slice(0, start) + code.slice(attribute.b);
        }
        return code.slice(0, attribute.a) + `${code.slice(attribute.a, attribute.nb)}="${escapeAttribute(value)}"` + code.slice(attribute.b);
    }
    if (value == null) return code;
    return code.slice(0, token.nameEnd) + ` ${name}="${escapeAttribute(value)}"` + code.slice(token.nameEnd);
}

/**
 * Returns the code with a line added to the head: before </head>, one level deeper than it.
 * @param {string} code - the code.
 * @param {string} line - the line.
 * @returns {string} the changed code (unchanged without </head>).
 */
export function addToHead(code, line) {
    const headEnd = /<\/head\s*>/i.exec(code);
    if (!headEnd) return code;
    const lineStart = code.lastIndexOf('\n', headEnd.index - 1) + 1;
    const before = code.slice(lineStart, headEnd.index);
    if (!before.trim()) return code.slice(0, lineStart) + before + '  ' + line + '\n' + before + code.slice(headEnd.index);
    return code.slice(0, headEnd.index) + line + code.slice(headEnd.index);
}

/**
 * Returns the code without an element (with its line, if it stands alone on it).
 * @param {string} code - the code.
 * @param {import('./html.js').HtmlElement} element - the element.
 * @returns {string} the changed code.
 */
export function removeElementFromCode(code, element) {
    let start = element.a, end = element.e;
    const lineStart = code.lastIndexOf('\n', start - 1) + 1, lineEnd = code.indexOf('\n', end);
    if (!code.slice(lineStart, start).trim() && !code.slice(end, lineEnd < 0 ? code.length : lineEnd).trim()) {
        start = lineStart;
        end = lineEnd < 0 ? code.length : lineEnd + 1;
    }
    return code.slice(0, start) + code.slice(end);
}

/**
 * Returns the code with the page's title set (a <title> added to the head when there is none).
 * @param {string} code - the code.
 * @param {string} value - the title.
 * @returns {string} the changed code.
 */
export function setTitleInCode(code, value) {
    const title = findFirstElement('title');
    if (title) return code.slice(0, title.ca) + escapeText(value) + code.slice(title.cb);
    return addToHead(code, `<title>${escapeText(value)}</title>`);
}

/**
 * Returns the code with a meta tag set; an empty value removes it.
 * @param {string} code - the code.
 * @param {string} name - the meta tag's name ("description", "author").
 * @param {string} value - its content.
 * @returns {string} the changed code.
 */
export function setMetaInCode(code, name, value) {
    const meta = findMetaElement(name);
    if (meta) return value.trim() ? setAttributeInCode(code, meta.tok, 'content', value) : removeElementFromCode(code, meta);
    return value.trim() ? addToHead(code, `<meta name="${name}" content="${escapeAttribute(value)}">`) : code;
}
