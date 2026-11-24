/**
 * Moving pictures in the preview: a picture can be dragged to another place of the page
 * (picture-drop.js finds the place and the new code). A line shows where it lands, or an
 * outline the picture it changes places with. On release its code moves there as one undo
 * step.
 *
 * The steps of a move:
 *   1. pointerdown on a picture notes the move; a mouse captures the pointer, a finger waits:
 *      it first rests on the picture for a moment (a swipe still scrolls the page, a tap is a click);
 *   2. after a few pixels of movement (or the finger's rest) the move starts: the picture is
 *      dimmed, the drop line follows the pointer, near the top or bottom the preview scrolls;
 *   3. on release the code changes, unless the code changed meanwhile; Escape cancels, and the
 *      click after a move is no click. While a finger moves a picture the page does not scroll,
 *      and its long press shows no menu.
 */

import { state, ui, showToast, getNumberInRange } from './state.js?v=2';
import { setCode, addTypingStep } from './history.js?v=6';
import { renderPreview, showCodeElementNow, isPreviewScheduled } from './preview.js?v=6';
import { showCodePosition } from './code-view.js?v=6';
import { findPictureCode, getDropPlace } from './picture-drop.js?v=6';
import { getMovedCode } from './picture-code.js?v=6';

/** Pixels a mouse moves before a press becomes a move. */
const DRAG_MIN = 4;
/** Milliseconds a finger rests on a picture before it moves it. */
const PRESS_TIME = 400;
/** Pixels a finger may move while it rests; more is a swipe. */
const PRESS_SLOP = 8;
/** Milliseconds after a move in which a click is no click. */
const MOVE_CLICK_TIME = 400;
/** The band at the top and bottom of the preview that scrolls, at most this many pixels. */
const EDGE_SIZE = 48;
/** The most pixels the preview scrolls per frame near an edge. */
const EDGE_STEP = 24;
/** The thinnest drop line in pixels. */
const LINE_SIZE = 4;

/**
 * A picture being moved.
 * @typedef {object} ActiveMove
 * @property {Element} el - the element of the preview that moves.
 * @property {import('./html.js').HtmlElement} src - the code that moves to a block place.
 * @property {import('./html.js').HtmlElement} inner - the code that moves beside another picture.
 * @property {string} code - the code when the move started.
 * @property {boolean} stale - true when the preview was older than the code at the start.
 * @property {number} x0 - where the pointer went down (x).
 * @property {number} y0 - where the pointer went down (y).
 * @property {number} x - the pointer's x in the preview.
 * @property {number} y - the pointer's y in the preview.
 * @property {number} id - the pointer's id.
 * @property {boolean} touch - true for a finger.
 * @property {boolean} on - true once the move started.
 * @property {boolean} [done] - true once it ended or was cancelled.
 * @property {import('./picture-drop.js').DropPlace|null} place - where it lands.
 * @property {number} timer - the timer of a finger's rest.
 */

/** @type {ActiveMove|null} */
let moving = null;
let movedAt = 0;
let dropLine = null;

/**
 * Creates the drop line over the preview and follows the pointer and the keys in the editor
 * (a browser that does not keep the captured pointer in the frame sends those there).
 * @returns {void}
 */
export function startPictureMoving() {
    dropLine = document.createElement('div');
    dropLine.className = 'picture-target';
    dropLine.hidden = true;
    dropLine.setAttribute('aria-hidden', 'true');
    ui.stage.append(dropLine);
    window.addEventListener('keydown', stopMoveOnEscape, true);
    window.addEventListener('pointermove', movePicture);
    window.addEventListener('pointerup', stopMove);
    window.addEventListener('pointercancel', stopMove);
    window.addEventListener('touchmove', stopTouchScroll, { passive: false });
}

/**
 * Follows the pointer in a new preview document: its own pointer events come first.
 * @param {Document} frameDocument - the preview document.
 * @returns {void}
 */
export function connectPictureMoving(frameDocument) {
    frameDocument.addEventListener('pointerdown', startPicturePress, true);
    frameDocument.addEventListener('pointermove', movePicture, true);
    frameDocument.addEventListener('pointerup', stopMove, true);
    frameDocument.addEventListener('pointercancel', stopMove, true);
    frameDocument.addEventListener('touchmove', stopTouchScroll, { passive: false, capture: true });
    frameDocument.addEventListener('contextmenu', event => { if (moving?.touch) event.preventDefault(); }, true);
    frameDocument.addEventListener('dragstart', event => { if (event.target.closest?.('img[data-hp]')) event.preventDefault(); });
}

/**
 * Tells whether a click comes right after a move (and is no click).
 * @returns {boolean} true within a moment after a move ended.
 */
export function isMoveClick() {
    return !!movedAt && performance.now() - movedAt < MOVE_CLICK_TIME;
}

/**
 * Keeps the page from scrolling while a finger moves a picture (a touchmove handler).
 * @param {TouchEvent} event - the touchmove.
 * @returns {void}
 */
function stopTouchScroll(event) {
    if (moving?.on && !moving.done) event.preventDefault();
}

/**
 * Notes a press on a picture of the preview as a possible move (a pointerdown handler): a
 * mouse captures the pointer and selects no text, a finger starts its rest.
 * @param {PointerEvent} event - the pointerdown.
 * @returns {void}
 */
function startPicturePress(event) {
    movedAt = 0;
    if (event.button !== 0 || !event.isPrimary || state.textEdit || moving) return;
    const picture = event.target.closest?.('img[data-hp]');
    if (!picture || !state.parsed) return;
    const source = findPictureCode(picture), inner = findPictureCode(picture, false);
    if (!source || !inner) return;
    const touch = event.pointerType === 'touch';
    if (!touch) event.preventDefault();                                             // no text selection, no dragging of the picture file
    const move = moving = {
        el: state.previewDocument.querySelector(`[data-hp="${source.a}"]`) || picture, src: source, inner, code: state.code, stale: isPreviewScheduled(),
        x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, id: event.pointerId, touch, on: false, place: null, timer: 0,
    };
    if (touch) move.timer = setTimeout(() => { if (moving === move && !move.on) startMoving(move); }, PRESS_TIME);
    else try { picture.setPointerCapture(event.pointerId); } catch (e) { /* then it follows the pointer inside the preview */ }
}

/**
 * Starts the move: dims the picture, shows the drop line and scrolls near the edges.
 * @param {ActiveMove} move - the move.
 * @returns {void}
 */
function startMoving(move) {
    move.on = true;
    move.el.setAttribute('data-htmleditor-moving', '');
    state.previewDocument.documentElement.setAttribute('data-htmleditor-drag', '');
    move.place = getDropPlace(move, move.x, move.y);
    showDropLine(move.place);
    requestAnimationFrame(moveViewAtEdge);
}

/**
 * Returns the point of a pointer event in the preview's coordinates, also when the pointer is
 * outside it (a browser that does not keep the captured pointer in the frame sends those to the editor).
 * @param {PointerEvent} event - the event.
 * @returns {number[]} [x, y] in the preview.
 */
function getFramePoint(event) {
    if (event.view !== window) return [event.clientX, event.clientY];
    const frame = ui.frame.getBoundingClientRect();
    return [event.clientX - frame.left - ui.frame.clientLeft, event.clientY - frame.top - ui.frame.clientTop];
}

/**
 * Follows the pointer (a pointermove handler): starts the move after a few pixels (a finger
 * that moves before its rest is a swipe: the page scrolls), then moves the drop line.
 * @param {PointerEvent} event - the pointermove.
 * @returns {void}
 */
function movePicture(event) {
    const move = moving;
    if (!move || event.pointerId !== move.id || move.done) return;
    [move.x, move.y] = getFramePoint(event);
    if (!move.on) {
        const distance = Math.hypot(move.x - move.x0, move.y - move.y0);
        if (move.touch) {
            if (distance >= PRESS_SLOP) { clearTimeout(move.timer); moving = null; }
            return;
        }
        if (distance < DRAG_MIN) return;
        startMoving(move);
    }
    move.place = getDropPlace(move, move.x, move.y);
    showDropLine(move.place);
}

/**
 * Scrolls the preview while the pointer is near its top or bottom, the faster the nearer; runs
 * each frame while the move lasts.
 * @returns {void}
 */
function moveViewAtEdge() {
    const move = moving;
    if (!move || !move.on || move.done || !state.previewDocument) return;
    const height = state.previewDocument.defaultView.innerHeight, edge = Math.min(EDGE_SIZE, height / 4);
    const depth = move.y < edge ? move.y - edge : move.y > height - edge ? move.y - (height - edge) : 0;
    const scrolling = state.previewDocument.scrollingElement;
    if (depth && scrolling) {
        const before = scrolling.scrollTop;
        scrolling.scrollTop += getNumberInRange(depth / 2, -EDGE_STEP, EDGE_STEP);
        if (scrolling.scrollTop !== before) { move.place = getDropPlace(move, move.x, move.y); showDropLine(move.place); }
    }
    requestAnimationFrame(moveViewAtEdge);
}

/**
 * Shows the line where the picture lands over the preview, or the outline of the picture it
 * changes places with; null hides both.
 * @param {import('./picture-drop.js').DropPlace|null} place - where it lands.
 * @returns {void}
 */
function showDropLine(place) {
    const swapped = state.previewDocument?.querySelector('[data-htmleditor-swap]');
    if (swapped && swapped !== place?.el) swapped.removeAttribute('data-htmleditor-swap');
    if (!place || place.kind === 'swap') {
        dropLine.hidden = true;
        if (place) place.el.setAttribute('data-htmleditor-swap', '');
        return;
    }
    const frame = ui.frame.getBoundingClientRect(), stage = ui.stage.getBoundingClientRect(), line = place.line;
    const x = getNumberInRange(line.x, 0, frame.width - LINE_SIZE), y = getNumberInRange(line.y, 0, frame.height - LINE_SIZE);
    const width = getNumberInRange(line.x + line.w, 0, frame.width) - x, height = getNumberInRange(line.y + line.h, 0, frame.height) - y;
    dropLine.style.transform = `translate(${frame.left - stage.left + x}px, ${frame.top - stage.top + y}px)`;
    dropLine.style.width = Math.max(LINE_SIZE, width) + 'px';
    dropLine.style.height = Math.max(LINE_SIZE, height) + 'px';
    dropLine.hidden = false;
}

/**
 * Ends the look of a move: no drop line, the picture at full opacity.
 * @param {ActiveMove} move - the move.
 * @returns {void}
 */
function stopMoving(move) {
    move.done = true;
    showDropLine(null);
    move.el.removeAttribute('data-htmleditor-moving');
    state.previewDocument?.documentElement.removeAttribute('data-htmleditor-drag');
}

/**
 * Ends a press or a move (a pointerup and pointercancel handler): a press without movement is
 * a click; a move writes the moved code as one undo step, unless the code changed meanwhile.
 * @param {PointerEvent} event - the pointerup or pointercancel.
 * @returns {void}
 */
function stopMove(event) {
    const move = moving;
    if (!move || event.pointerId !== move.id) return;
    moving = null;
    clearTimeout(move.timer);
    if (!move.on) return;                                                           // a click
    movedAt = performance.now();
    event.stopPropagation();
    if (move.done) return;                                                          // cancelled with Escape
    stopMoving(move);
    if (event.type === 'pointercancel' || !move.place) return;
    if (move.stale || state.code !== move.code) { showToast('The code changed meanwhile - the picture was not moved'); renderPreview(); return; }
    const moved = getMovedCode(move, move.place);
    if (!moved) return;
    addTypingStep();
    setCode(moved.code);
    showCodePosition(moved.a, true, moved.b);
    showCodeElementNow();
}

/**
 * Cancels a move on Escape (a keydown handler, and called by the preview's key handler first).
 * A command that returns whether it took place: the caller then does nothing else.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true when the key cancelled a move.
 */
export function stopMoveOnEscape(event) {
    if (event.key !== 'Escape' || !moving?.on || moving.done) return false;
    event.preventDefault();
    event.stopPropagation();
    stopMoving(moving);
    return true;
}
