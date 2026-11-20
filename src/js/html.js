/**
 * HTML for the editor: the element tree as a browser builds it (with the end tags HTML lets
 * out), the problems found on the way, the headings, the ids, the texts and the files the page
 * refers to. Tokens and entities are in html-tokens.js, highlighting in html-highlight.js,
 * tidying in html-tidy.js.
 *
 * Positions are offsets in the code. The preview marks every element with the place of its
 * start tag, so a click in the preview leads to the code and the cursor in the code to the
 * preview.
 *
 * parse() runs these steps:
 *   1. read the code as tokens;
 *   2. build the tree token by token: implied end tags close elements, every start tag is
 *      checked (unknown or obsolete names, attributes given twice, ids used twice, pictures
 *      without alt) and its references to files are noted, end tags close what they match;
 *   3. report what is never closed and a missing doctype;
 *   4. add the files used in <style> elements and list the headings.
 *
 * This file stays one module of more than 300 lines: the tree rules (implied end tags, foreign
 * content, what each step reports) belong together, and splitting them would scatter one
 * reading of the format.
 */

import { VOID, parseTokens, findAttribute, getAttributeValue, getDecodedText } from './html-tokens.js?v=3';

/** Element names a browser knows. */
const KNOWN = new Set(('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup '
    + 'data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header '
    + 'hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup '
    + 'option output p param picture pre progress q rp rt ruby s samp script search section select slot small source span strong style '
    + 'sub summary sup svg table tbody td template textarea tfoot th thead time title tr track u ul var video wbr math').split(' '));
/** Obsolete element names: current HTML does not have them. */
const OBSOLETE = new Set('acronym applet basefont big blink center dir font frame frameset marquee nobr noembed noframes plaintext rb rtc strike tt xmp'.split(' '));
/** Elements whose end tag HTML lets out: the next element or the parent's end closes them. */
const OPTIONAL = new Set('html head body p li dt dd option optgroup tr td th thead tbody tfoot colgroup caption rb rt rtc rp'.split(' '));
/** Start tags that close an open <p>. */
const CLOSES_P = new Set('address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section search table ul'.split(' '));
/** What a start tag closes first: name -> [names closed, names that stop the search]. */
const IMPLIED = {
    li: [['li'], ['ul', 'ol', 'menu']],
    dt: [['dt', 'dd'], ['dl']], dd: [['dt', 'dd'], ['dl']],
    option: [['option'], ['select', 'datalist', 'optgroup']], optgroup: [['option', 'optgroup'], ['select']],
    tr: [['tr', 'td', 'th'], ['table', 'thead', 'tbody', 'tfoot']],
    td: [['td', 'th'], ['tr', 'table']], th: [['td', 'th'], ['tr', 'table']],
    thead: [['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup'], ['table']],
    tbody: [['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup'], ['table']],
    tfoot: [['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup'], ['table']],
    rt: [['rt', 'rp'], ['ruby']], rp: [['rt', 'rp'], ['ruby']],
};
/** Elements that stay in the head; any other element closes it. */
const HEAD_ONLY = new Set(['title', 'meta', 'link', 'base', 'style', 'script', 'noscript', 'template']);
/** Attributes whose value is a file of the page. */
const FILE_ATTRIBUTES = { src: 1, poster: 1, data: 1 };
/** A reference that is no file of the document: an address with a scheme, //, /, #, ?, a template or nothing. */
const OUTSIDE_REF = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i;
/** The start of a DOCTYPE in any case. */
const DOCTYPE_START = /^<!doctype/i;
const DOCTYPE_START_LENGTH = '<!doctype'.length;
/** url(…) and @import "…" in CSS. */
const CSS_REF = /url\(\s*(["']?)([^"')\s]*)\1\s*\)|@import\s+(["'])([^"']+)\3/g;

/**
 * An element of the tree with its places in the code.
 * @typedef {object} HtmlElement
 * @property {string} name - the element name in lower case.
 * @property {number} a - where its start tag starts.
 * @property {number} b - where its start tag ends.
 * @property {number} ca - where its content starts.
 * @property {number} cb - where its content ends.
 * @property {number} e - where the element ends (after its end tag, or where it was closed).
 * @property {import('./html-tokens.js').HtmlToken} tok - its start tag.
 * @property {number} depth - its depth in the tree (the children of <html> count as 0).
 * @property {HtmlElement|null} parent - the element around it.
 */

/**
 * A problem found in the code.
 * @typedef {object} HtmlProblem
 * @property {number} pos - its place in the code.
 * @property {string} kind - "error" or "warn".
 * @property {string} msg - the message.
 */

/**
 * A heading of the page.
 * @typedef {object} HtmlHeading
 * @property {number} level - 1 to 6.
 * @property {string} title - its text ("…" when empty).
 * @property {number} pos - where its start tag starts.
 * @property {string} id - its id, "" without one.
 */

/**
 * A reference of the page to a file or an address.
 * @typedef {object} HtmlRef
 * @property {string} value - the address as written.
 * @property {number} a - where it starts in the code.
 * @property {number} b - where it ends.
 * @property {string} kind - "file" for a file the page uses, "link" for a link.
 * @property {string} tag - the element (or "css") it is in.
 */

/**
 * Everything the views need from the code.
 * @typedef {object} ParsedHtml
 * @property {import('./html-tokens.js').HtmlToken[]} toks - the tokens.
 * @property {HtmlElement[]} elements - the elements in code order.
 * @property {HtmlProblem[]} problems - the problems sorted by place.
 * @property {HtmlHeading[]} outline - the headings.
 * @property {HtmlRef[]} refs - the files and addresses the page refers to.
 * @property {{a: number, b: number}[]} texts - the text tokens outside raw content (for editing in the preview).
 * @property {Map<string, number>} ids - the place of each id's first start tag.
 * @property {number[]} depthAt - per token index the indentation depth for tidying.
 * @property {boolean} complete - true when the code has an <html> element.
 * @property {boolean} seenBody - true when the code has a <body> start tag.
 */

/**
 * The state of parse() while it builds the tree.
 * @typedef {object} TreeBuilder
 * @property {string} source - the code.
 * @property {import('./html-tokens.js').HtmlToken[]} tokens - the tokens.
 * @property {HtmlProblem[]} problems - the problems found so far.
 * @property {HtmlElement[]} elements - the elements so far.
 * @property {HtmlRef[]} refs - the references so far.
 * @property {{a: number, b: number}[]} texts - the text tokens so far.
 * @property {Map<string, number>} ids - the ids so far.
 * @property {HtmlElement[]} stack - the open elements.
 * @property {number[]} depthAt - the depth of each token read.
 * @property {Set<string>} late - end tags whose element was closed early by a misnesting.
 * @property {Map<string, number>} opened - how many elements of each name are open, so depth and the search for an open element stay cheap in deep nesting.
 * @property {boolean} hasHtml - true once an <html> start tag is read.
 * @property {boolean} doctype - true once <!DOCTYPE …> is read.
 * @property {number} foreign - how many svg and math elements are open.
 * @property {boolean} seenBody - true once a <body> start tag is read.
 */

/**
 * Reads the code (the steps in the header).
 * @param {string} source - the HTML code.
 * @returns {ParsedHtml} the tree, the problems and the rest the views need.
 */
export function parse(source) {
    const builder = createTreeBuilder(source);
    builder.tokens.forEach((token, tokenIndex) => readTreeToken(builder, token, tokenIndex));
    closeTree(builder);
    addStyleRefs(builder);
    const outline = getOutline(source, builder.elements);
    builder.problems.sort((x, y) => x.pos - y.pos);
    return {
        toks: builder.tokens, elements: builder.elements, problems: builder.problems, outline, refs: builder.refs,
        texts: builder.texts, ids: builder.ids, depthAt: builder.depthAt, complete: builder.hasHtml, seenBody: builder.seenBody,
    };
}

/**
 * Creates the empty state of the tree for a code.
 * @param {string} source - the code.
 * @returns {TreeBuilder} the state with the code's tokens.
 */
function createTreeBuilder(source) {
    const tokens = parseTokens(source);
    return {
        source, tokens, problems: [], elements: [], refs: [], texts: [], ids: new Map(), stack: [],
        depthAt: new Array(tokens.length), late: new Set(), opened: new Map(),
        hasHtml: false, doctype: false, foreign: 0, seenBody: false,
    };
}

/**
 * Adds a problem.
 * @param {TreeBuilder} builder - the tree state.
 * @param {number} place - where the problem is.
 * @param {string} kind - "error" or "warn".
 * @param {string} message - the message.
 * @returns {void}
 */
function addProblem(builder, place, kind, message) {
    builder.problems.push({ pos: place, kind, msg: message });
}

/**
 * Returns the depth of the next element: the open elements, the <html> element not counted.
 * @param {TreeBuilder} builder - the tree state.
 * @returns {number} the depth.
 */
function getDepth(builder) {
    return builder.stack.length - (builder.opened.get('html') || 0);
}

/**
 * Returns the place of the innermost open element with one of the names.
 * @param {TreeBuilder} builder - the tree state.
 * @param {string[]} names - the element names.
 * @returns {number} its index in the stack, -1 when none is open.
 */
function findOpenElement(builder, names) {
    if (!names.some(name => builder.opened.get(name))) return -1;
    for (let k = builder.stack.length - 1; k >= 0; k--) if (names.includes(builder.stack[k].name)) return k;
    return -1;
}

/**
 * Closes the open elements down to a place of the stack.
 * @param {TreeBuilder} builder - the tree state.
 * @param {number} stackIndex - the index of the outermost element to close.
 * @param {number} place - where the elements end without an end tag of their own.
 * @param {import('./html-tokens.js').HtmlToken} [endToken] - the end tag that closes the outermost one.
 * @returns {void}
 */
function closeElements(builder, stackIndex, place, endToken) {
    while (builder.stack.length > stackIndex) {
        const element = builder.stack.pop();
        builder.opened.set(element.name, (builder.opened.get(element.name) || 0) - 1);
        const byEndTag = endToken && builder.stack.length === stackIndex;
        element.cb = byEndTag ? endToken.a : place;
        element.e = byEndTag ? endToken.b : place;
        if (element.name === 'svg' || element.name === 'math') builder.foreign = Math.max(0, builder.foreign - 1);
    }
}

/**
 * Reads one token into the tree.
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the token.
 * @param {number} tokenIndex - its index.
 * @returns {void}
 */
function readTreeToken(builder, token, tokenIndex) {
    if (token.t === 'start') { readStartToken(builder, token, tokenIndex); return; }
    if (token.t === 'end') { readEndToken(builder, token, tokenIndex); return; }
    if (token.t === 'doctype' && DOCTYPE_START.test(builder.source.slice(token.a, token.a + DOCTYPE_START_LENGTH))) builder.doctype = true;
    if (token.t === 'comment' && token.open) addProblem(builder, token.a, 'error', 'The comment <!-- is never closed - add -->');
    if (token.t === 'text') builder.texts.push({ a: token.a, b: token.b });
    builder.depthAt[tokenIndex] = getDepth(builder);
}

/**
 * Reads a start tag: closes what it implies, checks it, notes its files and opens its element.
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @param {number} tokenIndex - its index.
 * @returns {void}
 */
function readStartToken(builder, token, tokenIndex) {
    const name = token.name;
    if (token.open) addProblem(builder, token.a, 'error', `The tag <${name} is never closed with >`);
    if (name === 'html') builder.hasHtml = true;
    if (name === 'body') builder.seenBody = true;
    if (!builder.foreign) {
        closeImpliedElements(builder, token);
        checkElementName(builder, token);
    }
    checkAttributes(builder, token);
    addAttributeRefs(builder, token);
    openElement(builder, token, tokenIndex);
}

/**
 * Closes the elements a start tag ends: an open <p> before a block, the previous <li>,
 * <td> …, and the head before anything of the body.
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @returns {void}
 */
function closeImpliedElements(builder, token) {
    const name = token.name;
    if (CLOSES_P.has(name)) {
        const paragraph = findOpenElement(builder, ['p']);
        if (paragraph >= 0 && !builder.stack.slice(paragraph + 1).some(element => /^(button|table|td|th)$/.test(element.name))) closeElements(builder, paragraph, token.a);
    }
    if (IMPLIED[name]) closeImpliedSibling(builder, IMPLIED[name], token.a);
    if (name === 'body' || (!HEAD_ONLY.has(name) && name !== 'html' && name !== 'head')) {
        const head = findOpenElement(builder, ['head']);
        if (head >= 0) closeElements(builder, head, token.a);
    }
}

/**
 * Closes the sibling a start tag implies (the previous <li>, <td> …), searching only through
 * elements whose end tag HTML lets out.
 * @param {TreeBuilder} builder - the tree state.
 * @param {string[][]} implied - [names closed, names that stop the search].
 * @param {number} place - where the start tag is.
 * @returns {void}
 */
function closeImpliedSibling(builder, implied, place) {
    const [closed, stops] = implied;
    for (let k = builder.stack.length - 1; k >= 0; k--) {
        if (stops.includes(builder.stack[k].name)) break;
        if (closed.includes(builder.stack[k].name)) { closeElements(builder, k, place); break; }
        if (!OPTIONAL.has(builder.stack[k].name)) break;
    }
}

/**
 * Reports an unknown or obsolete element name (custom elements with "-" are fine).
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @returns {void}
 */
function checkElementName(builder, token) {
    const name = token.name;
    if (KNOWN.has(name) || name.includes('-')) return;
    if (OBSOLETE.has(name)) addProblem(builder, token.a, 'warn', `<${name}> is obsolete - use CSS or a current element instead`);
    else addProblem(builder, token.a, 'warn', `Unknown element <${name}>`);
}

/**
 * Reports attributes given twice, an id used twice and a picture without alt.
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @returns {void}
 */
function checkAttributes(builder, token) {
    const name = token.name;
    const seen = new Set();
    for (const attribute of token.attrs) {
        if (seen.has(attribute.name)) addProblem(builder, attribute.a, 'warn', `The attribute ${attribute.name} is given twice in <${name}> - the browser uses the first one`);
        seen.add(attribute.name);
    }
    const id = getAttributeValue(token, 'id');
    if (id) {
        if (builder.ids.has(id)) addProblem(builder, findAttribute(token, 'id').a, 'error', `The id "${id}" is used twice`);
        else builder.ids.set(id, token.a);
    }
    if (name === 'img' && !builder.foreign && !findAttribute(token, 'alt')) addProblem(builder, token.a, 'warn', '<img> without alt - describe the picture (alt="…"), or alt="" if it only decorates');
}

/**
 * Notes the files and links a start tag refers to: src, poster, data, the href of stylesheets,
 * links and SVG images, srcset and url() in a style attribute.
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @returns {void}
 */
function addAttributeRefs(builder, token) {
    const name = token.name;
    for (const attribute of token.attrs) {
        if (attribute.va < 0) continue;
        const isFileHref = attribute.name === 'href' && (name === 'link' || name === 'image' || name === 'use');
        if (FILE_ATTRIBUTES[attribute.name] || isFileHref || attribute.name === 'xlink:href') builder.refs.push(createAttributeRef(attribute, name === 'iframe' ? 'link' : 'file', name));
        else if (attribute.name === 'href' && (name === 'a' || name === 'area')) builder.refs.push(createAttributeRef(attribute, 'link', name));
        else if (attribute.name === 'srcset') for (const ref of getSrcsetRefs(attribute)) builder.refs.push({ ...ref, kind: 'file', tag: name });
        else if (attribute.name === 'style') builder.refs.push(...findCssRefs(attribute.value, attribute.va));
    }
}

/**
 * Creates the reference of an attribute's value, without the white space around it.
 * @param {import('./html-tokens.js').HtmlAttribute} attribute - the attribute.
 * @param {string} kind - "file" or "link".
 * @param {string} tag - the element name.
 * @returns {HtmlRef} the reference.
 */
function createAttributeRef(attribute, kind, tag) {
    const value = attribute.value;
    return { value: value.trim(), a: attribute.va + (value.length - value.trimStart().length), b: attribute.va + value.trimEnd().length, kind, tag };
}

/**
 * Returns the file names of a srcset ("a.png 1x, b.png 2x") with their places.
 * @param {import('./html-tokens.js').HtmlAttribute} attribute - the srcset attribute.
 * @returns {{value: string, a: number, b: number}[]} the file names.
 */
function getSrcsetRefs(attribute) {
    const refs = [];
    const candidate = /([^\s,][^\s,]*)(?:\s+[^,]*)?/g;
    let match;
    while ((match = candidate.exec(attribute.value))) refs.push({ value: match[1], a: attribute.va + match.index, b: attribute.va + match.index + match[1].length });
    return refs;
}

/**
 * Adds the element of a start tag to the tree and opens it, unless it is void (or closes itself
 * in svg and math); a "/>" on another element and a missing end tag of raw content are reported.
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the start tag.
 * @param {number} tokenIndex - its index.
 * @returns {void}
 */
function openElement(builder, token, tokenIndex) {
    const name = token.name;
    const element = { name, a: token.a, b: token.b, ca: token.b, cb: token.b, e: token.b, tok: token, depth: getDepth(builder), parent: builder.stack[builder.stack.length - 1] || null };
    builder.elements.push(element);
    builder.depthAt[tokenIndex] = getDepth(builder);
    if (VOID.has(name) || (token.self && builder.foreign)) return;
    if (token.self && !builder.foreign) addProblem(builder, token.a, 'warn', `<${name}/> - in HTML only void elements (like <br>) close themselves; add </${name}>`);
    builder.stack.push(element);
    builder.opened.set(name, (builder.opened.get(name) || 0) + 1);
    if (name === 'svg' || name === 'math') builder.foreign++;
    if (token.unclosedRaw) addProblem(builder, token.a, 'error', `<${name}> is never closed - add </${name}>`);
}

/**
 * Reads an end tag: closes its element and reports what was open inside it, or reports the
 * end tag when its element is not open.
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the end tag.
 * @param {number} tokenIndex - its index.
 * @returns {void}
 */
function readEndToken(builder, token, tokenIndex) {
    const stackIndex = findOpenElement(builder, [token.name]);
    if (stackIndex < 0) checkStrayEndTag(builder, token);
    else {
        checkUnclosedInside(builder, token, stackIndex);
        closeElements(builder, stackIndex, token.a, token);
    }
    builder.depthAt[tokenIndex] = getDepth(builder);
}

/**
 * Reports an end tag without an open element: none for one whose element a misnesting closed
 * early or whose end tag HTML lets out (except </p>).
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the end tag.
 * @returns {void}
 */
function checkStrayEndTag(builder, token) {
    const name = token.name;
    if (builder.late.has(name)) builder.late.delete(name);
    else if (VOID.has(name)) addProblem(builder, token.a, 'warn', `</${name}> - <${name}> has no end tag`);
    else if (!OPTIONAL.has(name) || name === 'p') addProblem(builder, token.a, 'error', `</${name}> without an opening <${name}>`);
}

/**
 * Reports the elements still open inside the element an end tag closes (misnesting), except
 * those whose end tag HTML lets out and those in svg or math.
 * @param {TreeBuilder} builder - the tree state.
 * @param {import('./html-tokens.js').HtmlToken} token - the end tag.
 * @param {number} stackIndex - the index of its element in the stack.
 * @returns {void}
 */
function checkUnclosedInside(builder, token, stackIndex) {
    const name = token.name;
    for (let j = builder.stack.length - 1; j > stackIndex; j--) {
        const inner = builder.stack[j].name;
        if (OPTIONAL.has(inner) || builder.foreign) continue;
        if (name === 'body' || name === 'html') addProblem(builder, builder.stack[j].a, 'error', `<${inner}> is never closed - add </${inner}>`);
        else addProblem(builder, token.a, 'error', `<${inner}> is not closed before </${name}> - add </${inner}> first`);
        builder.late.add(inner);
    }
}

/**
 * Reports the elements never closed, closes them at the end of the code and reports a page
 * without doctype.
 * @param {TreeBuilder} builder - the tree state.
 * @returns {void}
 */
function closeTree(builder) {
    for (const element of builder.stack) {
        if (!OPTIONAL.has(element.name) && !element.tok.unclosedRaw) addProblem(builder, element.a, 'error', `<${element.name}> is never closed - add </${element.name}>`);
    }
    closeElements(builder, 0, builder.source.length);
    if (builder.hasHtml && !builder.doctype) addProblem(builder, 0, 'warn', 'No <!DOCTYPE html> at the top - browsers show the page in an older mode (quirks mode)');
}

/**
 * Adds the files in url() and @import of every <style> element.
 * @param {TreeBuilder} builder - the tree state.
 * @returns {void}
 */
function addStyleRefs(builder) {
    for (const token of builder.tokens) {
        if (token.t === 'raw' && token.name === 'style') builder.refs.push(...findCssRefs(builder.source.slice(token.a, token.b), token.a));
    }
}

/**
 * Returns the headings of the page with their text.
 * @param {string} source - the code.
 * @param {HtmlElement[]} elements - the elements.
 * @returns {HtmlHeading[]} the headings in code order.
 */
function getOutline(source, elements) {
    const outline = [];
    for (const element of elements) {
        const match = /^h([1-6])$/.exec(element.name);
        if (!match) continue;
        const title = getDecodedText(source.slice(element.ca, element.cb).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
        outline.push({ level: +match[1], title: title || '…', pos: element.a, id: getAttributeValue(element.tok, 'id') || '' });
    }
    return outline;
}

/**
 * Finds the files in url(…) and @import "…" of CSS, with their places; comments are skipped.
 * @param {string} css - the CSS.
 * @param {number} [offset] - where the CSS starts in the code.
 * @returns {HtmlRef[]} the references.
 */
export function findCssRefs(css, offset = 0) {
    const refs = [];
    const reference = new RegExp(CSS_REF.source, 'g');
    const withoutComments = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, comment => ' '.repeat(comment.length));
    let match;
    while ((match = reference.exec(withoutComments))) {
        const value = match[2] ?? match[4];
        const at = match.index + (match[2] != null ? match[0].indexOf(value, 4) : match[0].indexOf(match[3]) + 1);
        refs.push({ value, a: offset + at, b: offset + at + value.length, kind: 'file', tag: 'css' });
    }
    return refs;
}

/**
 * Tells whether a reference is no file of the document: an address with a scheme, //, /, #,
 * ?, a template ({ } < >) or nothing.
 * @param {string} ref - the reference.
 * @returns {boolean} true when it is outside the document.
 */
export function isOutsideRef(ref) {
    return OUTSIDE_REF.test(ref) || /[{}<>]/.test(ref) || !ref.trim();
}

/**
 * Returns the path of a reference without ?query, #hash and leading "./", URL escapes read.
 * @param {*} ref - the reference.
 * @returns {string} the path.
 */
export function getRefPath(ref) {
    let path = String(ref).trim().replace(/[?#].*$/, '');
    try { path = decodeURI(path); } catch (e) { /* keep it as it is */ }
    return path.replace(/^(\.\/)+/, '');
}

/**
 * Tells whether a reference in the code means a file: the same name, or the same last part
 * of a path ("img/logo.png" means "logo.png"), ignoring case, "./", ?query and #hash.
 * @param {string} ref - the reference.
 * @param {string} fileName - the file's name.
 * @returns {boolean} true when the reference means the file.
 */
export function isRefTo(ref, fileName) {
    const path = getRefPath(ref).toLowerCase(), name = fileName.toLowerCase();
    return path === name || path.split('/').pop() === name;
}
