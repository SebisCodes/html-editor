/**
 * The page as a document for the preview and for printing: every start tag marked with its
 * place in the code, nothing that could run or leave the frame, the document's files in place
 * of their names.
 *
 * createPreviewDocument() runs these steps:
 *   1. write data-hp="<place of the start tag>" into every start tag of the code;
 *   2. let the browser's DOMParser read the page (no script runs there);
 *   3. take out scripts, <base> and meta refresh, on… attributes and javascript:, vbscript:
 *      and data:text/html addresses;
 *   4. show a reference that holds a placeholder ({{…}} or <<…>>) as a placeholder picture, or
 *      take it out, so the preview loads nothing for it (CSS url() and @import: file-refs.js;
 *      an SVG attribute read as CSS with an escape that could spell an address, and an animation
 *      value with a placeholder, are taken out);
 *   5. put the document's files in as blob: addresses (src, poster, data of object, href of
 *      stylesheets and SVG images, srcset, url() in style attributes and <style>); a missing
 *      file's attribute is removed;
 *   6. with a template syntax (the template view), show every placeholder tag of the text, of
 *      textarea and title and of attribute values that name no address as its text as written.
 * With a template syntax the browser reads a source of the same length: each tag of a text
 * as a marker that carries the tag's number (template-markers.js), every other tag in safe brace
 * form, and section tags that stand where a table or a select takes no text as spaces.
 * createExamplePreviewDocument() reads the source of the example view (html-examples.js) the
 * same way and then resolves the attributes held back there: an example picture or a file of
 * the document as a blob: address, anything else as a placeholder picture or not at all.
 * The code keeps everything as it was written.
 */

import { getPreviewRef, getPreviewCss, getHeldPreviewRef, getHeldPreviewCss, DATA_ADDRESS } from './file-refs.js?v=7';
import { hasTemplatePlaceholder, buildTemplatePicture, getTemplateTags } from './template-tags.js?v=2';
import { createTemplateMarking, buildTemplateMarker, setMarkedTags } from './template-markers.js?v=1';
import { HELD_PREFIX, HELD_CSS_ATTRIBUTE, REFERENCE_ATTRIBUTES, getTagPlaces as getTagTokenPlaces } from './html-examples.js?v=2';
import { findAttribute, getDecodedText } from './html-tokens.js?v=3';
import { isEscapedCssValue } from './css-references.js?v=2';

/** Attributes that hold an address that could run script. */
const ADDRESS_ATTRIBUTE = /^(href|src|action|formaction|xlink:href|data)$/i;
/** Addresses that run script or show a page of their own. */
const ACTIVE_ADDRESS = /^\s*(javascript|vbscript|data:text\/html)/i;
/** Elements that show the picture their address names. */
const PICTURE_ELEMENTS = new Set(['img', 'input', 'image', 'use']);
/** Elements where the browser moves text out (a table, a select): section tags there stay out of the preview. */
const NO_TEXT_ELEMENTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'optgroup']);
/** The attributes a reference with a placeholder is taken out of (pictures show a placeholder picture). */
const PLACEHOLDER_ATTRIBUTES = ['src', 'poster', 'data', 'href', 'xlink:href', 'background', 'action', 'formaction', 'ping', 'lowsrc', 'dynsrc', 'longdesc', 'cite', 'manifest', 'codebase', 'archive', 'profile', 'imagesrcset'];
/** A CSS function that names an address, in an attribute other than style (SVG paints, filters, masks). */
const CSS_ADDRESS = /url\s*\(/i;
/** The namespace of SVG elements, whose attributes other than addresses can be read as CSS. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** SVG elements that change an attribute over time, and the attributes that hold the values they set. */
const ANIMATION_ELEMENTS = new Set(['set', 'animate', 'animateColor', 'animateMotion', 'animateTransform']);
const ANIMATION_VALUES = ['to', 'from', 'by', 'values'];
/** SVG elements whose href the browser loads (feImage paints the picture it names). */
const LOADED_HREF_ELEMENTS = ['link', 'image', 'use', 'feImage'];
/** A file name of a srcset: a run of characters other than spaces and commas. */
const SRCSET_CANDIDATE = /([^\s,][^\s,]*)/g;

/**
 * Returns the page as a document for the preview (the steps in the header).
 * @param {string} code - the code.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @param {?import('./template-tags.js').TemplateSyntax} [templateSyntax=null] - the template syntax of the placeholders, or null for plain HTML.
 * @returns {Document} the document, not yet in the frame.
 */
export function createPreviewDocument(code, parsed, templateSyntax = null) {
    const tags = templateSyntax ? getTemplateTags(code, templateSyntax) : [];
    const marking = tags.length ? createTemplateMarking(code, tags) : null;
    const source = tags.length ? buildTemplatePreviewSource(code, parsed, tags, marking) : code;
    const previewDocument = readPreviewSource(getMarkedCode(source, parsed), null);
    if (marking) {
        setMarkedTags(previewDocument.documentElement, marking);
        previewDocument.querySelectorAll('*').forEach(setPlaceholderCssValues);
    }
    return previewDocument;
}

/**
 * What the example view checks its references against: the code and its elements by place.
 * @typedef {object} ExampleContext
 * @property {string} code - the template.
 * @property {Map<number, import('./html.js').HtmlElement>} elements - the elements of the code by the place of their start tag.
 * @property {function(string): ?string} getExampleAddress - returns the blob: address of an example picture by name.
 */

/**
 * Returns the example view of a template as a document for the preview: the source of
 * html-examples.js read and cleaned like the code, and every reference checked against the code
 * as the browser read it: an element the code does not hold at its data-hp, or a reference whose
 * value is not the code's own value without a placeholder, is held back and resolved to local
 * pictures and files only.
 * @param {string} source - the filled text with data-hp and the held attributes renamed.
 * @param {string} code - the template.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @param {?import('./template-examples.js').TemplateExamples} examples - the page's examples, for their pictures.
 * @returns {Document} the document, not yet in the frame.
 */
export function createExamplePreviewDocument(source, code, parsed, examples) {
    const elements = new Map(parsed.elements.map(element => [element.a, element]));
    return readPreviewSource(source, { code, elements, getExampleAddress: name => (examples ? examples.getPictureAddress(name) : null) });
}

/**
 * Lets the browser read a source and cleans it (steps 2 to 5 of the header); with an example
 * view, resolves the held attributes last.
 * @param {string} source - the marked source.
 * @param {?ExampleContext} example - the code to check references against in the example view; null outside it.
 * @returns {Document} the document.
 */
function readPreviewSource(source, example) {
    const previewDocument = new DOMParser().parseFromString(source, 'text/html');
    previewDocument.querySelectorAll('script, base, meta[http-equiv="refresh" i]').forEach(element => element.remove());
    for (const element of previewDocument.querySelectorAll('*')) {
        removeActiveAttributes(element);
        if (example) disableChangedReferences(element, example);
        setPlaceholderAddresses(element);
        setPlaceholderCssValues(element);
        setFileAddresses(element);
        if (example) setHeldAddresses(element, example.getExampleAddress);
    }
    return previewDocument;
}

/**
 * Holds back the references of an element of the example view that are not the code's own: an
 * element the code does not hold at its data-hp holds back every reference; otherwise a reference
 * whose code attribute is missing, holds a placeholder or differs from it. CSS of a style element
 * that differs from the code gets only local addresses; another attribute with url() or a CSS
 * escape, or a value of an SVG animation, that differs from the code is taken out.
 * @param {Element} element - an element of the preview document.
 * @param {ExampleContext} example - the code to check against.
 * @returns {void}
 */
function disableChangedReferences(element, example) {
    const codeElement = element.hasAttribute('data-hp') ? example.elements.get(+element.getAttribute('data-hp')) || null : null;
    for (const attribute of [...element.attributes]) {
        const name = attribute.name;
        if (name.startsWith(HELD_PREFIX) || isCodeValue(example.code, codeElement, name, attribute.value)) continue;
        if (REFERENCE_ATTRIBUTES.has(name)) { element.setAttribute(HELD_PREFIX + name, attribute.value); element.removeAttribute(name); }
        else if (CSS_ADDRESS.test(attribute.value) || isEscapedCssValue(attribute.value) || isAnimationValue(element, name)) element.removeAttribute(name);
    }
    if (element.localName === 'style' && !element.hasAttribute(HELD_CSS_ATTRIBUTE) && !isCodeContent(example.code, codeElement, element.textContent)) {
        element.textContent = getHeldPreviewCss(element.textContent, example.getExampleAddress);
    }
}

/**
 * Tells whether an attribute's value is the code's own value for it, without a placeholder.
 * @param {string} code - the template.
 * @param {?import('./html.js').HtmlElement} codeElement - the element in the code, or null.
 * @param {string} name - the attribute's name.
 * @param {string} value - its value as the browser read it.
 * @returns {boolean} true when the code's element has the attribute with this value and no placeholder.
 */
function isCodeValue(code, codeElement, name, value) {
    const codeAttribute = codeElement ? findAttribute(codeElement.tok, name) : null;
    if (!codeAttribute) return false;
    const raw = codeAttribute.va >= 0 ? code.slice(codeAttribute.va, codeAttribute.vb) : '';
    return !hasTemplatePlaceholder(raw) && getDecodedText(raw) === value;
}

/**
 * Tells whether the text of a style element is the code's own text, without a placeholder.
 * @param {string} code - the template.
 * @param {?import('./html.js').HtmlElement} codeElement - the element in the code, or null.
 * @param {string} text - the element's text as the browser read it.
 * @returns {boolean} true when the code's element holds this text and no placeholder.
 */
function isCodeContent(code, codeElement, text) {
    if (!codeElement) return false;
    const raw = code.slice(codeElement.ca, codeElement.cb);
    return !hasTemplatePlaceholder(raw) && raw.replace(/\r\n?/g, '\n') === text;
}

/**
 * Resolves the attributes the example view held back (data-htmleditor-held-<name>): CSS with
 * only local addresses, a srcset with its local pictures, an address as an example picture or a
 * file of the document, else a placeholder picture (pictures), about:blank (frames) or nothing.
 * @param {Element} element - an element of the preview document.
 * @param {function(string): ?string} getExampleAddress - returns the blob: address of an example picture by name.
 * @returns {void}
 */
function setHeldAddresses(element, getExampleAddress) {
    for (const attribute of [...element.attributes]) {
        if (!attribute.name.startsWith(HELD_PREFIX)) continue;
        const name = attribute.name.slice(HELD_PREFIX.length), value = attribute.value;
        element.removeAttribute(attribute.name);
        if (name === 'style') { element.setAttribute('style', getHeldPreviewCss(value, getExampleAddress)); continue; }
        if (name === 'srcset' || name === 'imagesrcset') { setHeldSrcset(element, name, value, getExampleAddress); continue; }
        const address = getHeldPreviewRef(value, getExampleAddress);
        const showsPicture = PICTURE_ELEMENTS.has(element.localName) || name === 'poster';
        if (address && name !== 'srcdoc') element.setAttribute(name, address);
        else if (showsPicture && (name === 'src' || name === 'poster' || name === 'href' || name === 'xlink:href')) element.setAttribute(name, buildTemplatePicture(value));
        else if (element.localName === 'iframe' && name === 'src') element.setAttribute(name, 'about:blank');
    }
}

/**
 * Sets a held srcset to its candidates that are example pictures or files of the document; a
 * picture element without any of them shows a placeholder picture.
 * @param {Element} element - the element.
 * @param {string} name - the attribute's name (srcset or imagesrcset).
 * @param {string} value - the srcset as the filled text holds it.
 * @param {function(string): ?string} getExampleAddress - returns the blob: address of an example picture by name.
 * @returns {void}
 */
function setHeldSrcset(element, name, value, getExampleAddress) {
    const candidates = value.split(',').map(candidate => candidate.trim().split(/\s+/)).filter(parts => parts[0]);
    const local = candidates.map(([address, ...rest]) => [getHeldPreviewRef(address, getExampleAddress), ...rest]).filter(parts => parts[0]);
    if (local.length) element.setAttribute(name, local.map(parts => parts.join(' ')).join(', '));
    else if (PICTURE_ELEMENTS.has(element.localName) && !element.hasAttribute('src')) element.setAttribute('src', buildTemplatePicture(value));
}

/**
 * Builds the source the browser reads for a template's preview, as long as the code: each tag in
 * a text of the page, in the text of textarea and title and in an attribute value that names no
 * address as a marker with the tag's number (written back as the tag after reading), each section
 * tag in a text where a table or a select takes no text as spaces, every other tag (addresses,
 * comments, script and style) in safe brace form.
 * @param {string} code - the code.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags of the code, in order.
 * @param {?import('./template-markers.js').TemplateMarking} marking - the markers of the tags, or null
 *     when the code holds every marker start character (the tags then stand in safe brace form).
 * @returns {string} the preview source.
 */
function buildTemplatePreviewSource(code, parsed, tags, marking) {
    const places = getTagPlaces(parsed, tags);
    const tokenPlaces = getTagTokenPlaces(parsed, tags);
    const pieces = [];
    let last = 0;
    tags.forEach((tag, index) => {
        const isMarkedElsewhere = isPlainTagPlace(tokenPlaces.get(tag.start));
        pieces.push(code.slice(last, tag.start), buildTagStandIn(tag, index, places[index], isMarkedElsewhere, marking));
        last = tag.end;
    });
    pieces.push(code.slice(last));
    return pieces.join('');
}

/**
 * Where a tag stands in the code.
 * @typedef {object} TagPlace
 * @property {boolean} isText - true when the tag stands in a text of the page.
 * @property {string} element - the name of the innermost element around the tag, empty outside every element.
 */

/**
 * Returns where each tag stands: in a text of the page, with the name of the innermost element
 * around it, or elsewhere (attribute values, comments, raw text). One ordered sweep over the
 * texts and elements of the code.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @param {import('./template-tags.js').TemplateTag[]} tags - the tags, in order.
 * @returns {TagPlace[]} the place of each tag.
 */
function getTagPlaces(parsed, tags) {
    const texts = parsed.texts, elements = parsed.elements, open = [];
    let textIndex = 0, elementIndex = 0;
    return tags.map(tag => {
        while (textIndex < texts.length && texts[textIndex].b <= tag.start) textIndex++;
        const text = texts[textIndex];
        const isText = Boolean(text) && text.a <= tag.start && tag.end <= text.b;
        while (elementIndex < elements.length && elements[elementIndex].ca <= tag.start) open.push(elements[elementIndex++]);
        for (let index = open.length - 1; index >= 0; index--) if (open[index].cb <= tag.start) open.splice(index, 1);
        const inner = open.reduce((found, element) => (!found || element.ca >= found.ca ? element : found), null);
        return { isText, element: inner ? inner.name : '' };
    });
}

/**
 * Tells whether a tag outside the page's text still shows as its text: in the text of textarea or
 * title, or in an attribute value that names no address and runs no script.
 * @param {?import('./html-examples.js').HtmlTagPlace} place - the tag's place by its token.
 * @returns {boolean} true when a marker may stand for it.
 */
function isPlainTagPlace(place) {
    if (!place) return false;
    return place.kind === 'text' || (place.kind === 'attribute' && !REFERENCE_ATTRIBUTES.has(place.name) && !/^on/.test(place.name));
}

/**
 * Builds what the preview source holds in the place of one tag, as long as the tag.
 * @param {import('./template-tags.js').TemplateTag} tag - the tag.
 * @param {number} index - the tag's number in the code.
 * @param {TagPlace} place - where the tag stands.
 * @param {boolean} isMarkedElsewhere - true for a tag outside the page's text that still shows as its text.
 * @param {?import('./template-markers.js').TemplateMarking} marking - the markers of the tags, or null.
 * @returns {string} the marker, the spaces or the safe brace form.
 */
function buildTagStandIn(tag, index, place, isMarkedElsewhere, marking) {
    if (!marking || (!place.isText && !isMarkedElsewhere)) return `{{${'_'.repeat(tag.sign.length)}${tag.name}}}`;
    if (place.isText && tag.kind !== 'value' && NO_TEXT_ELEMENTS.has(place.element)) return ' '.repeat(tag.end - tag.start);
    return buildTemplateMarker(marking, index);
}

/**
 * Shows a reference that holds a placeholder as a placeholder picture (pictures) or takes it
 * out (stylesheets, frames, media, objects, a frame's own page in srcdoc), so the preview requests
 * nothing for it; a link to a data address goes as well, since its stylesheet can name further
 * addresses in an encoding of its own.
 * @param {Element} element - an element of the preview document.
 * @returns {void}
 */
function setPlaceholderAddresses(element) {
    if (element.localName === 'link' && DATA_ADDRESS.test(element.getAttribute('href') || '')) element.removeAttribute('href');
    for (const name of PLACEHOLDER_ATTRIBUTES) {
        const value = element.getAttribute(name);
        if (!value || !hasTemplatePlaceholder(value)) continue;
        if (name === 'href' && !LOADED_HREF_ELEMENTS.includes(element.localName)) continue;
        const showsPicture = PICTURE_ELEMENTS.has(element.localName) || name === 'poster';
        if (showsPicture) element.setAttribute(name, buildTemplatePicture(value));
        else if (element.localName === 'iframe') element.setAttribute(name, 'about:blank');
        else element.removeAttribute(name);
    }
    const srcset = element.getAttribute('srcset');
    if (srcset && hasTemplatePlaceholder(srcset)) {
        element.removeAttribute('srcset');
        if (PICTURE_ELEMENTS.has(element.localName)) element.setAttribute('src', buildTemplatePicture(srcset));
    }
    if (element.hasAttribute('srcdoc') && hasTemplatePlaceholder(element.getAttribute('srcdoc'))) element.removeAttribute('srcdoc');
}

/**
 * Holds the attributes of an SVG element that are read as CSS or set by an animation: a value
 * with a CSS escape and a function or a string is taken out (css-references.js), a value that
 * holds a placeholder shows its addresses as placeholder pictures, and a value of an animation
 * that holds a placeholder is taken out, so no animation sets an address with one.
 * @param {Element} element - an element of the preview document.
 * @returns {void}
 */
function setPlaceholderCssValues(element) {
    if (element.namespaceURI !== SVG_NAMESPACE) return;
    for (const attribute of [...element.attributes]) {
        const name = attribute.name, value = attribute.value;
        if (REFERENCE_ATTRIBUTES.has(name) || name.startsWith(HELD_PREFIX)) continue;
        if (isEscapedCssValue(value) || (isAnimationValue(element, name) && hasTemplatePlaceholder(value))) element.removeAttribute(name);
        else if (CSS_ADDRESS.test(value) && hasTemplatePlaceholder(value)) element.setAttribute(name, getPreviewCss(value));
    }
}

/**
 * Tells whether an attribute holds a value an SVG animation sets (to, from, by, values).
 * @param {Element} element - the element.
 * @param {string} name - the attribute's name.
 * @returns {boolean} true for a value of an animation element.
 */
function isAnimationValue(element, name) {
    return element.namespaceURI === SVG_NAMESPACE && ANIMATION_ELEMENTS.has(element.localName) && ANIMATION_VALUES.includes(name);
}

/**
 * Returns the code with data-hp, the place of the start tag, in every start tag.
 * @param {string} code - the code.
 * @param {import('./html.js').ParsedHtml} parsed - the code as read.
 * @returns {string} the marked code.
 */
function getMarkedCode(code, parsed) {
    let marked = '', last = 0;
    for (const element of parsed.elements) {
        marked += code.slice(last, element.tok.nameEnd) + ` data-hp="${element.a}"`;
        last = element.tok.nameEnd;
    }
    return marked + code.slice(last);
}

/**
 * Removes the on… attributes and the addresses that would run script.
 * @param {Element} element - an element of the preview document.
 * @returns {void}
 */
function removeActiveAttributes(element) {
    for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) || (ACTIVE_ADDRESS.test(attribute.value) && ADDRESS_ATTRIBUTE.test(attribute.name))) element.removeAttribute(attribute.name);
    }
}

/**
 * Puts the document's files into an element's attributes and styles as blob: addresses.
 * @param {Element} element - an element of the preview document.
 * @returns {void}
 */
function setFileAddresses(element) {
    const tag = element.localName;
    if (element.hasAttribute('src') && tag !== 'iframe') setFileAddress(element, 'src');
    if (element.hasAttribute('poster')) setFileAddress(element, 'poster');
    if (element.hasAttribute('data') && tag === 'object') setFileAddress(element, 'data');
    if (tag === 'link' && element.hasAttribute('href')) setFileAddress(element, 'href');
    if ((tag === 'image' || tag === 'use') && element.hasAttribute('href')) setFileAddress(element, 'href');
    if (element.hasAttribute('xlink:href')) setFileAddress(element, 'xlink:href');
    if (element.hasAttribute('srcset')) element.setAttribute('srcset', getPreviewSrcset(element.getAttribute('srcset')));
    if (element.hasAttribute('style')) element.setAttribute('style', getPreviewCss(element.getAttribute('style')));
    if (tag === 'style') element.textContent = getPreviewCss(element.textContent);
}

/**
 * Sets an attribute to the blob: address of the file it names; removes it for a missing file;
 * leaves an address outside the document.
 * @param {Element} element - the element.
 * @param {string} name - the attribute.
 * @returns {void}
 */
function setFileAddress(element, name) {
    const previewRef = getPreviewRef(element.getAttribute(name));
    if (previewRef === '') element.removeAttribute(name);
    else if (previewRef) element.setAttribute(name, previewRef);
}

/**
 * Returns a srcset with its file names as blob: addresses (a missing file as about:blank); the
 * width or density after a name stays.
 * @param {string} srcset - the srcset as written.
 * @returns {string} the srcset for the preview.
 */
function getPreviewSrcset(srcset) {
    return srcset.replace(SRCSET_CANDIDATE, (candidate, url, at, all) => {
        const before = all.slice(0, at);
        if (/\s\S*$/.test(before) && !/,\s*$/.test(before)) return candidate;
        const previewRef = getPreviewRef(url);
        return previewRef === null ? candidate : previewRef || 'about:blank';
    });
}
