/**
 * What the user does in the preview: nothing there navigates or sends a form; a click leads to
 * the element's place in the code; a click into text edits it in place (text-edit.js); a
 * picture can be dragged to another place (picture-move.js); the editor's shortcuts work;
 * files dropped on it are opened.
 *
 * connectPreviewDocument() runs once for each new document of the preview frame.
 */

import { disableViewerEdits } from './sync.js?v=26';
import { state, NARROW_SCREEN } from './state.js?v=2';
import { showCodePosition } from './code-view.js?v=10';
import { showCodeElementNow } from './preview.js?v=10';
import { startTextEdit, stopTextEdit } from './text-edit.js?v=10';
import { getCaretAtPoint } from './preview-caret.js?v=2';
import { connectPictureMoving, isMoveClick, stopMoveOnEscape } from './picture-move.js?v=10';
import { handlePictureClick } from './picture-remove.js?v=1';
import { handleShortcut } from './keyboard.js?v=10';
import { openFiles } from './file-import.js?v=10';
import { showPane } from './layout.js?v=10';

/** Elements of the page that would navigate or send a form on a click. */
const NAVIGATING = 'a[href], area[href], button, input[type=submit], input[type=image], input[type=reset]';
/** Elements a click does not edit as text. */
const NOT_TEXT = 'button, input, select, textarea, summary, option, img, video, audio';

/**
 * Connects the events of a new preview document.
 * @param {Document} frameDocument - the document of the preview frame.
 * @returns {void}
 */
export function connectPreviewDocument(frameDocument) {
    disableViewerEdits(frameDocument);
    frameDocument.addEventListener('submit', event => event.preventDefault(), true);
    frameDocument.addEventListener('auxclick', event => { if (event.target.closest?.(NAVIGATING)) event.preventDefault(); }, true);
    connectPictureMoving(frameDocument);
    frameDocument.addEventListener('click', event => showClickedElement(frameDocument, event));
    // pointerup, not click: when a click ends the edit of another text, the preview is made
    // anew and the text under the pointer is a new node.
    frameDocument.addEventListener('pointerup', event => startEditAtPointer(frameDocument, event));
    frameDocument.addEventListener('keydown', event => handlePreviewKey(frameDocument, event));
    frameDocument.addEventListener('focusout', event => { if (state.textEdit && event.target === state.textEdit.span) stopTextEdit(true); });
    frameDocument.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
    frameDocument.addEventListener('drop', event => {
        if (event.dataTransfer.files.length) { event.preventDefault(); openFiles([...event.dataTransfer.files]); }
    });
}

/**
 * Leads a click in the preview to the place of the clicked element in the code; a click on a
 * picture selects it (picture-remove.js); links do not navigate, and the click that ends moving
 * a picture or selects text does nothing.
 * @param {Document} frameDocument - the preview document.
 * @param {MouseEvent} event - the click.
 * @returns {void}
 */
function showClickedElement(frameDocument, event) {
    if (event.target.closest?.(NAVIGATING)) event.preventDefault();
    if (isMoveClick()) { event.stopPropagation(); return; }
    if (state.textEdit || event.target.closest?.('[data-htmleditor-edit]')) return;
    if (handlePictureClick(event)) return;
    const selection = frameDocument.getSelection();
    if (selection && !selection.isCollapsed) return;                    // the user selects text
    const element = event.target.closest?.('[data-hp]');
    if (!element) return;
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(+element.getAttribute('data-hp'));
    showCodeElementNow();
}

/**
 * Starts editing the text under the pointer, unless text is being edited or selected or the
 * pointer is on a control or a picture.
 * @param {Document} frameDocument - the preview document.
 * @param {PointerEvent} event - the pointerup.
 * @returns {void}
 */
function startEditAtPointer(frameDocument, event) {
    if (event.button !== 0 || state.textEdit) return;
    const selection = frameDocument.getSelection();
    if (selection && !selection.isCollapsed) return;
    if (event.target.closest?.(NOT_TEXT)) return;
    const caret = getCaretAtPoint(event.clientX, event.clientY);
    if (caret && caret.node.nodeType === Node.TEXT_NODE) startTextEdit(caret.node, caret.offset);
}

/**
 * Handles a key in the preview: Escape while a picture moves cancels it; while text is edited
 * Ctrl+Enter keeps the edit, Enter makes a new paragraph, Shift+Enter a new line (in the text
 * now, in the code when the edit ends), Escape cancels; the editor's shortcuts work as anywhere.
 * @param {Document} frameDocument - the preview document.
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function handlePreviewKey(frameDocument, event) {
    if (stopMoveOnEscape(event)) return;
    const edit = state.textEdit;
    if (edit && event.target === edit.span) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); stopTextEdit(true); return; }
        if (event.key === 'Enter') { event.preventDefault(); frameDocument.execCommand('insertText', false, event.shiftKey ? '\n' : '\n\n'); return; }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopTextEdit(false); return; }
    }
    handleShortcut(event, !!state.textEdit);
}
