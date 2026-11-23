/**
 * Tidying the code: every line indented by the depth of its elements.
 *
 * formatHtml() runs these steps:
 *   1. the tags of block elements and of the head start lines of their own where only spaces
 *      stand between two of them (white space there does not change how the page looks);
 *   2. every line is indented by the depth of the token it starts with, two spaces a level,
 *      the children of <html> not indented, attributes on lines of their own two levels deeper;
 *   3. the content of <pre>, <textarea> and comments stays as it is; script and style keep
 *      their own indentation, moved as a block.
 * Only the space at the start of lines and the line breaks of step 1 change; tidying twice
 * gives the same code.
 */

import { parse } from './html.js?v=7';

/** Elements that start on a line of their own when tidying: blocks of the body and the elements of the head. */
const OWN_LINE = new Set(['html', 'head', 'body', 'title', 'meta', 'link', 'style', 'script', 'base', 'noscript',
    'article', 'section', 'div', 'header', 'footer', 'main', 'nav', 'aside', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'figure', 'figcaption', 'table', 'caption', 'thead', 'tbody',
    'tfoot', 'tr', 'th', 'td', 'form', 'fieldset', 'legend', 'hr', 'address', 'details', 'summary', 'pre', 'template']);
const INDENT = '  ';

/**
 * A script or style content moved as a block.
 * @typedef {object} RawBlock
 * @property {number} a - where it starts.
 * @property {number} b - where it ends.
 * @property {number} depth - the depth its lines go to.
 * @property {number} [min] - the smallest indentation of its lines after the first, found once.
 */

/**
 * The state of formatHtml() while it goes through the lines.
 * @typedef {object} TidyContext
 * @property {string} code - the code after step 1.
 * @property {import('./html.js').ParsedHtml} tree - the code read.
 * @property {number[][]} keep - ranges [a, b] whose lines stay as they are.
 * @property {RawBlock[]} raws - the script and style contents.
 * @property {number} tokenIndex - the token of the line before, where the search for the next line's token starts.
 */

/**
 * Returns the code tidied (the steps in the header).
 * @param {string} source - the HTML code.
 * @returns {string} the tidied code.
 */
export function formatHtml(source) {
    const code = splitBlockLines(source);
    const tree = parse(code);
    const context = { code, tree, keep: getKeptRanges(tree), raws: getRawBlocks(tree), tokenIndex: 0 };
    const lines = code.split('\n');
    const lineStarts = getLineStarts(lines);
    return lines.map((line, lineIndex) => formatLine(context, line, lineStarts[lineIndex])).join('\n');
}

/**
 * Puts the tags of OWN_LINE elements on lines of their own where two of them meet with
 * nothing but spaces between them (a comment next to such a tag counts as one); text and
 * inline elements stay on the line of their block. Inside <pre> and <textarea> nothing changes.
 * @param {string} source - the code.
 * @returns {string} the code with the line breaks added.
 */
function splitBlockLines(source) {
    const tree = parse(source);
    const kept = tree.elements.filter(element => element.name === 'pre' || element.name === 'textarea').map(element => [element.b, element.cb]);
    let out = '', last = 0, previous = null;
    for (const token of tree.toks) {
        if (token.t === 'text' && !source.slice(token.a, token.b).trim()) continue;
        if (previous && (isOwnLineToken(previous) || isOwnLineToken(token)) && isNearBlock(previous) && isNearBlock(token)
            && !kept.some(([start, end]) => previous.b >= start && token.a <= end)) {
            const gap = source.slice(previous.b, token.a);
            if (!gap.includes('\n')) { out += source.slice(last, previous.b) + '\n'; last = token.a; }
        }
        previous = token;
    }
    return out + source.slice(last);
}

/**
 * Tells whether a token stands on a line of its own when tidying: a doctype or a tag of an
 * OWN_LINE element.
 * @param {import('./html-tokens.js').HtmlToken} token - the token.
 * @returns {boolean} true for such a token.
 */
function isOwnLineToken(token) {
    return token.t === 'doctype' || ((token.t === 'start' || token.t === 'end') && OWN_LINE.has(token.name));
}

/**
 * Tells whether a token may get a line break next to an own-line tag: such a tag or a comment.
 * @param {import('./html-tokens.js').HtmlToken} token - the token.
 * @returns {boolean} true for such a token.
 */
function isNearBlock(token) {
    return isOwnLineToken(token) || token.t === 'comment';
}

/**
 * Returns the ranges whose lines stay as they are: the content of <pre> and <textarea>, and
 * comments.
 * @param {import('./html.js').ParsedHtml} tree - the code read.
 * @returns {number[][]} the ranges [a, b].
 */
function getKeptRanges(tree) {
    const keep = [];
    for (const element of tree.elements) if (element.name === 'pre' || element.name === 'textarea') keep.push([element.b, element.cb]);
    for (const token of tree.toks) if (token.t === 'comment') keep.push([token.a + 1, token.b]);
    return keep;
}

/**
 * Returns the script and style contents, each moved as a block one level deeper than its element.
 * @param {import('./html.js').ParsedHtml} tree - the code read.
 * @returns {RawBlock[]} the blocks.
 */
function getRawBlocks(tree) {
    const raws = [];
    tree.toks.forEach((token, tokenIndex) => {
        if (token.t === 'raw' && !token.rc) raws.push({ a: token.a, b: token.b, depth: tree.depthAt[tokenIndex] + 1 });
    });
    return raws;
}

/**
 * Returns where each line starts in the code.
 * @param {string[]} lines - the lines.
 * @returns {number[]} the offsets.
 */
function getLineStarts(lines) {
    const starts = [];
    for (let i = 0, at = 0; i < lines.length; i++) { starts.push(at); at += lines[i].length + 1; }
    return starts;
}

/**
 * Returns one line tidied: empty when it holds only spaces, unchanged in a kept range,
 * moved with its block in script or style, otherwise indented by its depth.
 * @param {TidyContext} context - the state of formatHtml().
 * @param {string} line - the line.
 * @param {number} lineStart - where it starts in the code.
 * @returns {string} the tidied line.
 */
function formatLine(context, line, lineStart) {
    const body = line.replace(/^[ \t]+/, '');
    const first = lineStart + (line.length - body.length);
    if (!body) return '';
    if (context.keep.some(([start, end]) => lineStart > start && lineStart <= end)) return line;
    const raw = context.raws.find(block => first >= block.a && first < block.b);
    if (raw) return getIndentedRawLine(context.code, raw, line, body);
    return INDENT.repeat(Math.max(0, readLineDepth(context, first))) + body;
}

/**
 * Returns a line of script or style content moved with its block: at the block's depth plus
 * what the line has more than the least indented line of the block.
 * @param {string} code - the code.
 * @param {RawBlock} raw - the block; gets its smallest indentation the first time.
 * @param {string} line - the line.
 * @param {string} body - the line without its indentation.
 * @returns {string} the moved line.
 */
function getIndentedRawLine(code, raw, line, body) {
    raw.min ??= Math.min(...code.slice(raw.a, raw.b).split('\n').slice(1).filter(rawLine => rawLine.trim()).map(rawLine => /^[ \t]*/.exec(rawLine)[0].replace(/\t/g, INDENT).length));
    const own = /^[ \t]*/.exec(line)[0].replace(/\t/g, INDENT).length;
    return ' '.repeat(raw.depth * INDENT.length + Math.max(0, own - raw.min)) + body;
}

/**
 * Returns the depth of the token a line starts in, and moves the context's token cursor there
 * (a reader that consumes its input: the lines come in order).
 * @param {TidyContext} context - the state of formatHtml().
 * @param {number} first - the place of the line's first character that is no space.
 * @returns {number} the depth: two more inside a start tag (attributes on lines of their own).
 */
function readLineDepth(context, first) {
    const { toks: tokens, depthAt } = context.tree;
    while (context.tokenIndex < tokens.length - 1 && tokens[context.tokenIndex].b <= first) context.tokenIndex++;
    const token = tokens[context.tokenIndex];
    const depth = token ? depthAt[context.tokenIndex] : 0;
    if (token && first >= token.a && first < token.b && token.t === 'start' && first > token.a) return depth + 2;
    return depth;
}
