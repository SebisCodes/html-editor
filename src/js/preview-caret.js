/**
 * The text position under a point of the preview, for editing text in place.
 *
 * getCaretAtPoint() looks at the boxes of the characters of the element under the point.
 * Unlike caretPositionFromPoint this also holds in pages shown with CSS zoom. Beside the
 * characters (right of a line's end, in the space between lines) the nearest character within
 * about a line counts, so a click right of a line's end lands at its end. Where no character is
 * that near, the browser's own caret position is taken.
 */

import { state } from './state.js?v=2';

/**
 * A place in a text node.
 * @typedef {object} TextCaret
 * @property {Node} node - the text node.
 * @property {number} offset - the place in its text.
 */

/**
 * Returns the text position under the pointer in the preview.
 * @param {number} x - the pointer's x in the preview's coordinates.
 * @param {number} y - the pointer's y in the preview's coordinates.
 * @returns {TextCaret|null} the place, null when there is none.
 */
export function getCaretAtPoint(x, y) {
    const previewDocument = state.previewDocument;
    const element = previewDocument.elementFromPoint(x, y);
    const caret = element && findCharacterAt(element, x, y);
    if (caret) return caret;
    if (previewDocument.caretPositionFromPoint) {
        const position = previewDocument.caretPositionFromPoint(x, y);
        return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    const range = previewDocument.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/**
 * Finds the text position under a point inside an element from the boxes of its characters:
 * the place before the character under the point, or after it when the point is on its right
 * half; beside the characters the nearest one within about a line.
 * @param {Element} element - the element under the point.
 * @param {number} x - the point's x.
 * @param {number} y - the point's y.
 * @returns {TextCaret|null} the place, null when no character of the element is that near.
 */
function findCharacterAt(element, x, y) {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = element.ownerDocument.createRange();
    let nearest = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.length; i++) {
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const measured = getCharacterDistance(range.getClientRects(), node, i, x, y);
            if (!measured) continue;
            if (measured.onIt) return measured.caret;
            if (!nearest || measured.dy < nearest.dy || (measured.dy === nearest.dy && measured.dx < nearest.dx)) nearest = measured;
        }
    }
    return nearest ? nearest.caret : null;
}

/**
 * How near a character is to a point.
 * @typedef {object} CharacterDistance
 * @property {boolean} onIt - true when the point is on the character.
 * @property {TextCaret} caret - the place before or after the character, by the half the point is on.
 * @property {number} [dy] - the vertical distance to its box.
 * @property {number} [dx] - the horizontal distance to its box.
 */

/**
 * Returns how near one character is to a point: its nearest box on the point's line.
 * @param {DOMRectList} boxes - the boxes of the character.
 * @param {Node} node - its text node.
 * @param {number} index - its place in the text.
 * @param {number} x - the point's x.
 * @param {number} y - the point's y.
 * @returns {CharacterDistance|null} the distance, null when no box is within a line.
 */
function getCharacterDistance(boxes, node, index, x, y) {
    let best = null;
    for (const box of boxes) {
        const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
        if (dy > box.height) continue;                                       // another line
        const offset = x < box.left + box.width / 2 ? index : index + 1;
        if (!dy && x >= box.left && x <= box.right) return { onIt: true, caret: { node, offset } };
        const dx = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
        if (!best || dy < best.dy || (dy === best.dy && dx < best.dx)) best = { onIt: false, caret: { node, offset }, dy, dx };
    }
    return best;
}
