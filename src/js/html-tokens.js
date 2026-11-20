/**
 * HTML tokens with their places in the code, entities and escaping.
 *
 * parseTokens() reads the code as a browser's tokenizer does, as far as the editor needs it:
 * text, start tags with their attributes, end tags, comments, declarations (doctype) and the
 * raw content of script, style, textarea and title. Every token keeps its start (a) and end
 * (b) as offsets in the code, so the views can lead from the page back to the code.
 *
 * Its steps, for each "<" in the code:
 *   1. the text before it becomes a text token;
 *   2. a comment, a declaration, an end tag or a start tag is read from it ("<" alone is text);
 *   3. after the start tag of script, style, textarea or title, its content up to the end tag
 *      is one raw token (inside svg and math these elements are read as any other).
 *
 * The file is longer than 300 lines: the tokenizer, the entities and the escaping are one
 * reading of the format, used together by the tree, the highlighting and the edits in place.
 */

/** Elements without an end tag. */
export const VOID = new Set('area base br col embed hr img input link meta param source track wbr keygen'.split(' '));
/** Elements whose content is text up to their end tag. */
const RAW = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']);
/** Elements whose content is text with entities up to their end tag. */
const RCDATA = new Set(['textarea', 'title']);
/** An entity as HTML reads it: numeric, hexadecimal or named, with or without ";". */
const ENTITY = /&(?:#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)/g;
/** How far an end tag's name is looked for. */
const END_TAG_LOOKAHEAD = 120;
const COMMENT_START = '<!--';
const COMMENT_END = '-->';
/** Entities read once, by their text. */
const entityCache = new Map();
let entityDecoder = null;

/**
 * An attribute of a start tag with its places in the code.
 * @typedef {object} HtmlAttribute
 * @property {string} name - the name, in lower case.
 * @property {number} a - where the name starts.
 * @property {number} nb - where the name ends.
 * @property {number} b - where the attribute ends (after its value and closing quote).
 * @property {number} va - where the value starts, -1 without a value.
 * @property {number} vb - where the value ends, -1 without a value.
 * @property {string} q - the quote around the value: '"', "'" or "".
 * @property {string} value - the value as written (entities not read).
 */

/**
 * A token of the code.
 * @typedef {object} HtmlToken
 * @property {string} t - the kind: "text", "start", "end", "comment", "doctype" or "raw".
 * @property {number} a - where it starts in the code.
 * @property {number} b - where it ends.
 * @property {string} [name] - the element name of a start, end or raw token, in lower case.
 * @property {number} [nameEnd] - where the name of a start or end tag ends.
 * @property {HtmlAttribute[]} [attrs] - the attributes of a start tag.
 * @property {boolean} [self] - true for a start tag written with "/>".
 * @property {boolean} [open] - true when the code never closes the token (">", "-->", a quote).
 * @property {boolean} [rc] - true for the raw content of textarea and title (entities count).
 * @property {boolean} [unclosedRaw] - true for a script, style, textarea … start tag without its end tag.
 */

/**
 * Returns text with the characters of markup written as entities (&, <, > and ").
 * @param {*} text - the text.
 * @returns {string} the escaped text.
 */
export function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Returns typed text as HTML text: the characters that would start markup are entities.
 * @param {*} text - the text.
 * @returns {string} the text with &, < and > escaped.
 */
export function escapeText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Returns text for an attribute value in double quotes.
 * @param {*} text - the text.
 * @returns {string} the text with &, ", < and > escaped.
 */
export function escapeAttribute(text) {
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Reads the code as tokens (the steps in the header).
 * @param {string} source - the HTML code.
 * @returns {HtmlToken[]} the tokens in code order.
 */
export function parseTokens(source) {
    const reader = { source, tokens: [], position: 0, textStart: 0, foreignDepth: 0 };
    while (reader.position < source.length) {
        const tagStart = source.indexOf('<', reader.position);
        if (tagStart < 0) break;
        readMarkup(reader, tagStart);
    }
    addTextToken(reader, source.length);
    return reader.tokens;
}

/**
 * The state of parseTokens() while it reads.
 * @typedef {object} TokenReader
 * @property {string} source - the code.
 * @property {HtmlToken[]} tokens - the tokens read so far.
 * @property {number} position - where reading goes on.
 * @property {number} textStart - where the text since the last token starts.
 * @property {number} foreignDepth - how many svg and math elements are open.
 */

/**
 * Reads the markup that starts with a "<" and moves the reader past it.
 * @param {TokenReader} reader - the reader.
 * @param {number} tagStart - the place of the "<".
 * @returns {void}
 */
function readMarkup(reader, tagStart) {
    const { source } = reader;
    const next = source[tagStart + 1] || '';
    if (source.startsWith(COMMENT_START, tagStart)) readComment(reader, tagStart);
    else if (next === '!' || next === '?') readDeclaration(reader, tagStart);
    else if (next === '/' && /[A-Za-z]/.test(source[tagStart + 2] || '')) readEndTag(reader, tagStart);
    else if (!/[A-Za-z]/.test(next)) reader.position = tagStart + 1;        // a lone "<" is text
    else readStartTag(reader, tagStart);
}

/**
 * Adds the text since the last token as a text token, when there is any.
 * @param {TokenReader} reader - the reader.
 * @param {number} end - where the text ends.
 * @returns {void}
 */
function addTextToken(reader, end) {
    if (end > reader.textStart) reader.tokens.push({ t: 'text', a: reader.textStart, b: end });
}

/**
 * Reads a comment up to "-->" (or to the end of the code).
 * @param {TokenReader} reader - the reader.
 * @param {number} tagStart - the place of "<!--".
 * @returns {void}
 */
function readComment(reader, tagStart) {
    addTextToken(reader, tagStart);
    const length = reader.source.length;
    const end = reader.source.indexOf(COMMENT_END, tagStart + COMMENT_START.length);
    const tokenEnd = end < 0 ? length : end + COMMENT_END.length;
    reader.tokens.push({ t: 'comment', a: tagStart, b: tokenEnd, open: end < 0 });
    reader.position = reader.textStart = tokenEnd;
}

/**
 * Reads a declaration ("<!DOCTYPE …>", "<?…>") up to ">".
 * @param {TokenReader} reader - the reader.
 * @param {number} tagStart - the place of "<".
 * @returns {void}
 */
function readDeclaration(reader, tagStart) {
    addTextToken(reader, tagStart);
    const length = reader.source.length;
    const end = reader.source.indexOf('>', tagStart);
    reader.tokens.push({ t: 'doctype', a: tagStart, b: end < 0 ? length : end + 1, open: end < 0 });
    reader.position = reader.textStart = end < 0 ? length : end + 1;
}

/**
 * Reads an end tag; the end of svg or math leaves foreign content.
 * @param {TokenReader} reader - the reader.
 * @param {number} tagStart - the place of "</".
 * @returns {void}
 */
function readEndTag(reader, tagStart) {
    const { source, tokens } = reader;
    addTextToken(reader, tagStart);
    const match = /^<\/([^\s/>]+)/.exec(source.slice(tagStart, tagStart + END_TAG_LOOKAHEAD));
    const end = source.indexOf('>', tagStart);
    const name = match[1].toLowerCase();
    tokens.push({ t: 'end', a: tagStart, b: end < 0 ? source.length : end + 1, name, nameEnd: tagStart + 2 + match[1].length, open: end < 0 });
    if (reader.foreignDepth && (name === 'svg' || name === 'math')) reader.foreignDepth--;
    reader.position = reader.textStart = end < 0 ? source.length : end + 1;
}

/**
 * Reads a start tag; svg and math start foreign content, script, style … are followed by
 * their raw content.
 * @param {TokenReader} reader - the reader.
 * @param {number} tagStart - the place of "<".
 * @returns {void}
 */
function readStartTag(reader, tagStart) {
    addTextToken(reader, tagStart);
    const token = parseStartTag(reader.source, tagStart);
    reader.tokens.push(token);
    reader.position = reader.textStart = token.b;
    if (token.name === 'svg' || token.name === 'math') {
        if (!token.self) reader.foreignDepth++;
        return;
    }
    if (!reader.foreignDepth && (RAW.has(token.name) || RCDATA.has(token.name)) && !token.open) readRawContent(reader, token);
}

/**
 * Reads the content of script, style, textarea … up to its end tag as one raw token.
 * @param {TokenReader} reader - the reader, after the start tag.
 * @param {HtmlToken} token - the start tag; marked unclosedRaw when its end tag is missing.
 * @returns {void}
 */
function readRawContent(reader, token) {
    const { source } = reader;
    const endTag = new RegExp('</' + token.name + '(?=[\\s/>])', 'ig');
    endTag.lastIndex = reader.position;
    const match = endTag.exec(source);
    const end = match ? match.index : source.length;
    if (end > reader.position) reader.tokens.push({ t: 'raw', a: reader.position, b: end, name: token.name, rc: RCDATA.has(token.name) });
    if (!match) token.unclosedRaw = true;
    reader.position = reader.textStart = end;
}

/**
 * Reads one start tag: its name and attributes with the places of their names and values.
 * @param {string} source - the code.
 * @param {number} tagStart - the place of "<".
 * @returns {HtmlToken} the start tag token.
 */
function parseStartTag(source, tagStart) {
    const length = source.length;
    let position = tagStart + 1;
    while (position < length && !/[\s/>]/.test(source[position])) position++;
    const token = { t: 'start', a: tagStart, name: source.slice(tagStart + 1, position).toLowerCase(), nameEnd: position, attrs: [], self: false };
    for (;;) {
        while (position < length && /\s/.test(source[position])) position++;
        if (position >= length) { token.open = true; break; }
        if (source[position] === '>') { position++; break; }
        if (source[position] === '/' && source[position + 1] === '>') { token.self = true; position += 2; break; }
        if (source[position] === '/') { position++; continue; }
        const attribute = parseAttribute(source, position, token);
        token.attrs.push(attribute);
        position = attribute.b;
    }
    token.b = position;
    return token;
}

/**
 * Reads one attribute of a start tag; an unclosed quote marks the tag as open.
 * @param {string} source - the code.
 * @param {number} nameStart - where the attribute's name starts.
 * @param {HtmlToken} token - the start tag the attribute belongs to.
 * @returns {HtmlAttribute} the attribute.
 */
function parseAttribute(source, nameStart, token) {
    const length = source.length;
    let position = nameStart + 1;
    while (position < length && !/[\s/>=]/.test(source[position])) position++;
    const attribute = { name: source.slice(nameStart, position).toLowerCase(), a: nameStart, nb: position, b: position, va: -1, vb: -1, q: '' };
    let next = position;
    while (next < length && /\s/.test(source[next])) next++;
    if (source[next] === '=') readAttributeValue(source, next + 1, attribute, token);
    attribute.value = attribute.va < 0 ? '' : source.slice(attribute.va, attribute.vb);
    return attribute;
}

/**
 * Reads the value of an attribute after its "=": quoted or up to the next space or ">".
 * @param {string} source - the code.
 * @param {number} start - the place after "=".
 * @param {HtmlAttribute} attribute - the attribute; gets the places of its value and its end.
 * @param {HtmlToken} token - the start tag; marked open when the quote is never closed.
 * @returns {void}
 */
function readAttributeValue(source, start, attribute, token) {
    const length = source.length;
    let position = start;
    while (position < length && /\s/.test(source[position])) position++;
    const quote = source[position];
    if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, position + 1);
        attribute.q = quote;
        attribute.va = position + 1;
        attribute.vb = end < 0 ? length : end;
        attribute.b = end < 0 ? length : end + 1;
        if (end < 0) token.open = true;
        return;
    }
    attribute.va = position;
    while (position < length && !/[\s>]/.test(source[position])) position++;
    attribute.vb = position;
    attribute.b = position;
}

/**
 * Finds an attribute of a start tag by its name.
 * @param {HtmlToken|null} token - the start tag.
 * @param {string} name - the attribute's name in lower case.
 * @returns {HtmlAttribute|null} the first attribute of that name, null when there is none.
 */
export function findAttribute(token, name) {
    return token && token.attrs ? token.attrs.find(attribute => attribute.name === name) || null : null;
}

/**
 * Returns the value of an attribute with its entities read.
 * @param {HtmlToken|null} token - the start tag.
 * @param {string} name - the attribute's name in lower case.
 * @returns {string|null} the value, null when the tag has no such attribute.
 */
export function getAttributeValue(token, name) {
    const attribute = findAttribute(token, name);
    return attribute ? getDecodedText(attribute.value) : null;
}

/**
 * Returns an entity as the browser reads it in text, from the browser's own table. A query
 * that fills a cache.
 * @param {string} entity - the entity as written ("&amp;", "&#169;", "&copy").
 * @returns {string} its characters, or the entity itself when the browser does not know it.
 */
function getEntityText(entity) {
    let text = entityCache.get(entity);
    if (text === undefined) {
        entityDecoder ??= document.implementation.createHTMLDocument('').createElement('textarea');
        entityDecoder.innerHTML = entity;
        text = entityDecoder.value;
        entityCache.set(entity, text);
    }
    return text;
}

/**
 * Returns text with its entities read.
 * @param {*} text - HTML text.
 * @returns {string} the text as the page shows it (white space unchanged).
 */
export function getDecodedText(text) {
    return String(text).replace(ENTITY, getEntityText);
}

/**
 * The text of a part of the code as the page shows it, with the place of each character.
 * @typedef {object} DecodedRange
 * @property {string} text - the text with its entities read.
 * @property {number[]} starts - for each character (and once more for the end) the place in the code where it starts.
 * @property {number[]} group - for each character the index of the first character of its entity; characters of one entity are only changed together.
 */

/**
 * Returns the text of code[start, end) as the page shows it, with the place in the code
 * where each character starts.
 * @param {string} source - the code.
 * @param {number} start - where the part starts.
 * @param {number} end - where the part ends.
 * @returns {DecodedRange} the text, the places and the entity groups.
 */
export function getDecodedRange(source, start, end) {
    const raw = source.slice(start, end);
    const range = { text: '', starts: [], group: [] };
    let last = 0, match;
    ENTITY.lastIndex = 0;
    while ((match = ENTITY.exec(raw))) {
        addPlainCharacters(range, raw.slice(last, match.index), start + last);
        const decoded = getEntityText(match[0]);
        if (decoded === match[0]) addPlainCharacters(range, decoded, start + match.index);
        else addEntityCharacters(range, decoded, start + match.index);
        last = match.index + match[0].length;
    }
    addPlainCharacters(range, raw.slice(last), start + last);
    range.starts.push(end);
    range.group.push(range.text.length);
    return range;
}

/**
 * Adds characters written as they are: each is its own group.
 * @param {DecodedRange} range - the range being built.
 * @param {string} text - the characters.
 * @param {number} place - where the first one is in the code.
 * @returns {void}
 */
function addPlainCharacters(range, text, place) {
    for (let k = 0; k < text.length; k++) {
        range.group.push(range.text.length);
        range.starts.push(place + k);
        range.text += text[k];
    }
}

/**
 * Adds the characters of one entity as one group, one entry per UTF-16 unit, as the text is
 * indexed (an emoji from &#128512; is two).
 * @param {DecodedRange} range - the range being built.
 * @param {string} decoded - the entity's characters.
 * @param {number} place - where the entity is in the code.
 * @returns {void}
 */
function addEntityCharacters(range, decoded, place) {
    const groupStart = range.text.length;
    for (let k = 0; k < decoded.length; k++) {
        range.group.push(groupStart);
        range.starts.push(place);
    }
    range.text += decoded;
}

/**
 * Returns the code of a text with its entities marked for highlighting.
 * @param {string} text - HTML text.
 * @param {function(string, string): string} formatSpan - wraps a part in a span of a class.
 * @returns {string} the text as HTML, entities the browser knows in an "e" span.
 */
export function highlightEntities(text, formatSpan) {
    let out = '', last = 0, match;
    ENTITY.lastIndex = 0;
    while ((match = ENTITY.exec(text))) {
        out += escapeHtml(text.slice(last, match.index)) + (getEntityText(match[0]) !== match[0] ? formatSpan('e', match[0]) : escapeHtml(match[0]));
        last = match.index + match[0].length;
    }
    return out + escapeHtml(text.slice(last));
}
