/**
 * The code with a picture moved where it was dropped (picture-drop.js finds the place). Code on
 * lines of its own moves as whole lines, indented as the target; code within a line takes one
 * space next to it along. Two pictures alone in their table cells change places. Cells, rows
 * and the elements around stay as they are.
 */

import { state } from './state.js?v=2';
import { getCodeEnd, getLineStart, isBlank } from './picture-drop.js?v=7';

/**
 * The code with the picture moved.
 * @typedef {object} MovedCode
 * @property {string} code - the new code.
 * @property {number} a - where the moved code starts.
 * @property {number} b - where it ends.
 */

/**
 * Returns the code with the picture moved to a place.
 * @param {import('./picture-drop.js').PictureMove} move - the move.
 * @param {import('./picture-drop.js').DropPlace} place - where it lands.
 * @returns {MovedCode|null} the new code, null when nothing changes.
 */
export function getMovedCode(move, place) {
    return place.kind === 'swap' ? getSwappedCode(move, place.tgt) : getRelocatedCode(move, place);
}

/**
 * Returns the code with two pictures changed in place.
 * @param {import('./picture-drop.js').PictureMove} move - the move.
 * @param {import('./html.js').HtmlElement} target - the other picture's code.
 * @returns {MovedCode|null} the new code, null when nothing changes.
 */
function getSwappedCode(move, target) {
    const code = state.code;
    const [first, second] = move.inner.a < target.a ? [move.inner, target] : [target, move.inner];
    const firstEnd = getCodeEnd(first), secondEnd = getCodeEnd(second);
    const swapped = code.slice(0, first.a) + code.slice(second.a, secondEnd) + code.slice(firstEnd, second.a) + code.slice(first.a, firstEnd) + code.slice(secondEnd);
    const length = getCodeEnd(move.inner) - move.inner.a;
    const start = move.inner === first ? second.a + (secondEnd - second.a) - (firstEnd - first.a) : first.a;
    return swapped === code ? null : { code: swapped, a: start, b: start + length };
}

/**
 * Returns the code with the picture's code cut out and put in at the place.
 * @param {import('./picture-drop.js').PictureMove} move - the move.
 * @param {import('./picture-drop.js').DropPlace} place - where it lands ("block" or "beside").
 * @returns {MovedCode|null} the new code, null when nothing changes or the place is inside its own code.
 */
function getRelocatedCode(move, place) {
    const code = state.code;
    const cut = getCutRange(move.src);
    const insertion = getInsertion(place);
    if (insertion.at > cut.start && insertion.at < cut.end) return null;                    // inside its own code
    const inner = place.kind === 'block' ? move.src : move.inner;
    const body = code.slice(inner.a, getCodeEnd(inner)).split('\n').map((line, index) => index && line.startsWith(cut.indent) ? insertion.indent + line.slice(cut.indent.length) : line).join('\n');
    const inserted = insertion.lead + body + insertion.tail;
    const at = insertion.at;
    const moved = at <= cut.start ? code.slice(0, at) + inserted + code.slice(at, cut.start) + code.slice(cut.end)
        : code.slice(0, cut.start) + code.slice(cut.end, at) + inserted + code.slice(at);
    if (moved === code) return null;
    const start = (at <= cut.start ? at : at - (cut.end - cut.start)) + insertion.lead.length;
    return { code: moved, a: start, b: start + body.length };
}

/**
 * Returns the code cut out of its place: whole lines when the picture's code stands on lines
 * of its own, else the code with one space next to it.
 * @param {import('./html.js').HtmlElement} source - the code that moves.
 * @returns {{start: number, end: number, indent: string}} the range and the indentation of its first line.
 */
function getCutRange(source) {
    const code = state.code;
    const end = getCodeEnd(source), lineStart = getLineStart(source.a);
    let lineEnd = code.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = code.length;
    const ownLines = isBlank(code.slice(lineStart, source.a)) && isBlank(code.slice(end, lineEnd));
    let cutStart = ownLines ? lineStart : source.a, cutEnd = ownLines ? Math.min(lineEnd + 1, code.length) : end;
    if (!ownLines) {
        if (/[ \t]/.test(code[cutStart - 1] || '')) cutStart--;
        else if (/[ \t]/.test(code[cutEnd] || '')) cutEnd++;
    }
    return { start: cutStart, end: cutEnd, indent: /^[ \t]*/.exec(code.slice(lineStart, source.a))[0] };
}

/**
 * Returns where the code goes in: on a line of its own before or after the target when that
 * stands on its own line(s), else right before or after it (beside a picture with a space).
 * @param {import('./picture-drop.js').DropPlace} place - where it lands.
 * @returns {{at: number, lead: string, tail: string, indent: string}} the place, what goes before and after the code, the indentation of its lines.
 */
function getInsertion(place) {
    const code = state.code, target = place.tgt;
    const targetEnd = getCodeEnd(target), lineStart = getLineStart(target.a);
    const lineEnd = code.indexOf('\n', targetEnd);
    const ownStart = isBlank(code.slice(lineStart, target.a)), indent = ownStart ? code.slice(lineStart, target.a) : '';
    const ownEnd = lineEnd >= 0 ? isBlank(code.slice(targetEnd, lineEnd)) : isBlank(code.slice(targetEnd));
    const separator = place.kind === 'block' ? '' : ' ';
    if (!place.after && ownStart && (place.kind === 'block' || ownEnd)) return { at: lineStart, lead: indent, tail: '\n', indent };
    if (place.after && ownEnd && (place.kind === 'block' || ownStart)) {
        return lineEnd >= 0 ? { at: lineEnd + 1, lead: indent, tail: '\n', indent } : { at: code.length, lead: '\n' + indent, tail: '', indent };
    }
    return place.after ? { at: targetEnd, lead: separator, tail: '', indent } : { at: target.a, lead: '', tail: separator, indent };
}
