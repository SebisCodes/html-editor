/**
 * Where a picture dragged in the preview lands, and the code with the picture moved there.
 *
 * A picture lands before or after the block under the pointer (a paragraph, heading, list,
 * figure …), whichever half is nearer; inside a <div>, <section>, <li> … between its blocks.
 * Over another picture it lands beside that one, left or right (above or below where the
 * pictures stand one under the other); two pictures that are each alone in a table cell change
 * places when one is dropped on the middle of the other.
 *
 * What moves is the <figure> the picture is in, else the <img> with a <picture>, <a> or <p>
 * around it that holds nothing else (beside another picture without the <p>, which goes with
 * it when it is left empty). picture-code.js writes the move into the code.
 */

import { state } from './state.js?v=2';
import { getElementsByPlace } from './preview.js?v=9';

/** Elements a picture can go into, between their blocks. */
const BOXES = /^(body|div|section|article|main|aside|header|footer|nav|blockquote|li|dd|td|th|details|form|fieldset|center)$/;
/** How deep the search for a block under the pointer goes. */
const MAX_BOX_DEPTH = 40;
/** A vertical distance counts this much more than a horizontal one when the nearest block is chosen. */
const VERTICAL_WEIGHT = 4;
/** The thickness of the drop line in pixels. */
const LINE_SIZE = 4;
/** Half the thickness of the drop line: the offset that centers the line on the edge it marks. */
const LINE_OFFSET = LINE_SIZE / 2;
/** A drop on another picture swaps the two when the point is this share of its width from its middle, or closer. */
const SWAP_SHARE = 1 / 4;

/**
 * A picture being moved (picture-move.js).
 * @typedef {object} PictureMove
 * @property {Element} el - the element of the preview that moves (the figure, or the picture with what goes along).
 * @property {import('./html.js').HtmlElement} src - the code that moves to a block place.
 * @property {import('./html.js').HtmlElement} inner - the code that moves beside another picture.
 */

/**
 * Where a picture lands.
 * @typedef {object} DropPlace
 * @property {string} kind - "block" (before or after a block), "beside" (another picture) or "swap" (change places).
 * @property {import('./html.js').HtmlElement} tgt - the target's code.
 * @property {Element} el - the target in the preview.
 * @property {boolean} [after] - true after the target, false before it.
 * @property {DOMRect} r - the target's box.
 * @property {{x: number, y: number, w: number, h: number}} [line] - where the drop line is drawn.
 */

/**
 * Returns the end of an element's code, without the white space before an implied end tag.
 * @param {import('./html.js').HtmlElement} element - the element.
 * @returns {number} the end.
 */
export function getCodeEnd(element) {
    let end = element.e;
    while (end > element.b && /\s/.test(state.code[end - 1])) end--;
    return end;
}

/**
 * Returns where the line of a place starts.
 * @param {number} place - the place in the code.
 * @returns {number} the line's start.
 */
export function getLineStart(place) {
    return state.code.lastIndexOf('\n', place - 1) + 1;
}

/**
 * Tells whether code holds nothing but white space and comments.
 * @param {string} code - the code.
 * @returns {boolean} true for blank code.
 */
export function isBlank(code) {
    return !/\S/.test(code.replace(/<!--[\s\S]*?-->/g, ''));
}

/**
 * Tells whether an element holds nothing but another element (besides the <source>s of a <picture>).
 * @param {import('./html.js').HtmlElement} parent - the element around.
 * @param {import('./html.js').HtmlElement} element - the element inside.
 * @returns {boolean} true when it holds only that element.
 */
function hasOnlyElement(parent, element) {
    return isBlank((state.code.slice(parent.ca, element.a) + state.code.slice(getCodeEnd(element), parent.cb)).replace(/<source\b[^>]*>/gi, ''));
}

/**
 * Returns the code that moves with a picture: the <figure> it is in, else the <img> with the
 * <picture> and <a> (and with block: the <p>) around it that hold nothing else.
 * @param {Element} picture - the picture in the preview.
 * @param {boolean} [block] - true to take a <p> that holds only the picture along.
 * @returns {import('./html.js').HtmlElement|null} the code that moves.
 */
export function findPictureCode(picture, block = true) {
    const elements = getElementsByPlace();
    const figure = picture.closest('figure[data-hp]');
    if (figure) return elements.get(+figure.getAttribute('data-hp')) || null;
    let element = elements.get(+picture.getAttribute('data-hp'));
    const around = block ? /^(picture|a|p)$/ : /^(picture|a)$/;
    while (element && element.parent && around.test(element.parent.name) && hasOnlyElement(element.parent, element)) element = element.parent;
    return element || null;
}

/**
 * Tells whether an element is alone in a table cell.
 * @param {import('./html.js').HtmlElement} element - the element.
 * @returns {boolean} true when the cell holds only it.
 */
function isAloneInCell(element) {
    return !!element.parent && /^(td|th)$/.test(element.parent.name) && hasOnlyElement(element.parent, element);
}

/**
 * Returns the blocks of a box of the preview that the picture can go before or after: shown,
 * not positioned out of the flow, not the moving picture.
 * @param {PictureMove} move - the move.
 * @param {Element} box - the box.
 * @returns {Array<[Element, DOMRect]>} the blocks with their boxes.
 */
function getDropBlocks(move, box) {
    const blocks = [];
    for (const child of box.children) {
        if (!child.hasAttribute('data-hp') || child === move.el || child.contains(move.el)) continue;
        const style = state.previewDocument.defaultView.getComputedStyle(child);
        if (style.display === 'none' || style.position === 'fixed' || style.position === 'absolute') continue;
        const rect = child.getBoundingClientRect();
        if (rect.width || rect.height) blocks.push([child, rect]);
    }
    return blocks;
}

/**
 * Returns where the picture lands for a point of the preview: beside another picture under the
 * point, or before or after the nearest block.
 * @param {PictureMove} move - the move.
 * @param {number} x - the point's x in the preview.
 * @param {number} y - the point's y in the preview.
 * @returns {DropPlace|null} the place, null when there is none.
 */
export function getDropPlace(move, x, y) {
    const besidePicture = getPictureTarget(move, x, y);
    if (besidePicture) return besidePicture;
    let box = state.previewDocument.body;
    for (let depth = 0; box && depth < MAX_BOX_DEPTH; depth++) {
        const blocks = getDropBlocks(move, box);
        if (!blocks.length) return null;
        const { block, rect, distance } = findNearestBlock(blocks, x, y);
        if (distance === 0 && BOXES.test(block.localName) && getDropBlocks(move, block).length) { box = block; continue; }
        return createBlockPlace(block, rect, y);
    }
    return null;
}

/**
 * Returns the block nearest to a point (a vertical distance counts four times).
 * @param {Array<[Element, DOMRect]>} blocks - the blocks with their boxes.
 * @param {number} x - the point's x.
 * @param {number} y - the point's y.
 * @returns {{block: Element, rect: DOMRect, distance: number}} the nearest block and its distance.
 */
function findNearestBlock(blocks, x, y) {
    let nearest = blocks[0], nearestDistance = Infinity;
    for (const [block, rect] of blocks) {
        const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
        const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
        if (dy * VERTICAL_WEIGHT + dx < nearestDistance) { nearestDistance = dy * VERTICAL_WEIGHT + dx; nearest = [block, rect]; }
    }
    return { block: nearest[0], rect: nearest[1], distance: nearestDistance };
}

/**
 * Returns the place before or after a block, by the half of it the point is on; the line is
 * drawn in the middle of its margin.
 * @param {Element} block - the block in the preview.
 * @param {DOMRect} rect - its box.
 * @param {number} y - the point's y.
 * @returns {DropPlace|null} the place, null when the block's code is not known.
 */
function createBlockPlace(block, rect, y) {
    const after = y > rect.top + rect.height / 2, style = state.previewDocument.defaultView.getComputedStyle(block);
    const lineY = after ? rect.bottom + parseFloat(style.marginBottom) / 2 : rect.top - parseFloat(style.marginTop) / 2;
    const target = getElementsByPlace().get(+block.getAttribute('data-hp'));
    return target ? { kind: 'block', tgt: target, el: block, after, r: rect, line: { x: rect.left, y: lineY - LINE_OFFSET, w: rect.width, h: LINE_SIZE } } : null;
}

/**
 * Returns the place over another picture: beside it to the left or right, or above or below
 * when the pictures around it stand one under the other; or a swap of two pictures alone in
 * their table cells when the point is on the middle of the other.
 * @param {PictureMove} move - the move.
 * @param {number} x - the point's x.
 * @param {number} y - the point's y.
 * @returns {DropPlace|null} the place, null when no other picture is under the point.
 */
function getPictureTarget(move, x, y) {
    const previewDocument = state.previewDocument;
    const picture = previewDocument.elementsFromPoint(x, y).find(node => node.localName === 'img' && node.hasAttribute('data-hp') && !move.el.contains(node));
    const target = picture && findPictureCode(picture, false);
    if (!target || (target.a < move.src.e && move.src.a < target.e)) return null;
    if (move.inner.name === 'figure' && target.name !== 'figure') return null;          // a figure does not go into a line of pictures
    const element = previewDocument.querySelector(`[data-hp="${target.a}"]`) || picture;
    const rect = element.getBoundingClientRect();
    if (isAloneInCell(move.inner) && isAloneInCell(target) && Math.abs(x - (rect.left + rect.width / 2)) < rect.width * SWAP_SHARE) return { kind: 'swap', tgt: target, el: element, r: rect };
    const stacked = isStacked(move, element, rect);
    const after = stacked ? y > rect.top + rect.height / 2 : x > rect.left + rect.width / 2;
    const line = stacked
        ? { x: rect.left, y: (after ? rect.bottom : rect.top) - LINE_OFFSET, w: rect.width, h: LINE_SIZE }
        : { x: (after ? rect.right : rect.left) - LINE_OFFSET, y: rect.top, w: LINE_SIZE, h: rect.height };
    return { kind: 'beside', tgt: target, after, el: element, r: rect, line };
}

/**
 * Tells whether the pictures around a target stand one under the other: none of them shares
 * a row with it; without others, when the target is not inline.
 * @param {PictureMove} move - the move.
 * @param {Element} element - the target picture in the preview.
 * @param {DOMRect} rect - its box.
 * @returns {boolean} true for pictures one under the other.
 */
function isStacked(move, element, rect) {
    const others = [...(element.parentElement?.children || [])]
        .filter(other => other !== element && other !== move.el && (other.localName === 'img' || (other.matches('picture, a, figure') && other.querySelector('img'))))
        .map(other => other.getBoundingClientRect()).filter(other => other.width && other.height);
    if (!others.length) return !/^inline/.test(state.previewDocument.defaultView.getComputedStyle(element).display);
    return !others.some(other => Math.min(other.bottom, rect.bottom) - Math.max(other.top, rect.top) > Math.min(other.height, rect.height) / 2);
}
