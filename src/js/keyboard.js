/**
 * The editor's keyboard shortcuts, in the editor and in the preview. Ctrl/Cmd+S saves, +E opens
 * Export, +O "My documents", +P prints; Escape closes the "New" menu. Inside a page (iframe or
 * own window) F5 and Ctrl+R in the preview go to the editor, where sync.js asks the page. Undo,
 * Redo and "?" (help) pause while the user types into a field or a dialog is open.
 */

import { openDialog } from './dialogs.js?v=5';
import { ui, areas, getElement } from './state.js?v=2';
import { undo, redo } from './history.js?v=6';
import { saveQuickly, openExportDialog } from './export-dialog.js?v=6';
import { runPrint } from './export.js?v=6';
import { setNewMenuOpen, isNewMenuOpen } from './documents.js?v=6';

/** Fields the user types into: shortcuts without Ctrl pause there, and pasting goes into them. */
export const TYPING_FIELDS = 'textarea, select, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=button])';

/**
 * Connects the shortcuts of the editor page.
 * @returns {void}
 */
export function startKeyboard() {
    window.addEventListener('keydown', event => handleShortcut(event));
}

/**
 * Runs the shortcut of a key (a keydown handler of the editor and the preview).
 * @param {KeyboardEvent} event - the key.
 * @param {boolean} [inEdit] - true while text is edited in the preview (it counts as typing).
 * @returns {void}
 */
export function handleShortcut(event, inEdit = false) {
    const active = document.activeElement;
    const typing = inEdit || (active && active !== ui.frame && active.matches(TYPING_FIELDS));
    const modifier = event.ctrlKey || event.metaKey;
    if (runCommandShortcut(event, modifier)) return;
    if (sendReload(event, modifier)) return;
    if (typing || getElement('dialog[open]')) return;
    if (modifier && (event.key === 'z' || event.key === 'Z')) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (modifier && event.key === 'y') { event.preventDefault(); redo(); return; }
    if (modifier) return;
    if (event.key === '?') openDialog(getElement('#help'));
}

/**
 * Runs the shortcuts that work everywhere: save, Export, "My documents", print, and Escape for
 * the "New" menu. A command that returns whether it took place.
 * @param {KeyboardEvent} event - the key.
 * @param {boolean} modifier - true with Ctrl or Cmd.
 * @returns {boolean} true when the key was such a shortcut.
 */
function runCommandShortcut(event, modifier) {
    const commands = { s: saveQuickly, e: openExportDialog, o: () => areas.files.open(), p: runPrint };
    if (modifier && Object.hasOwn(commands, event.key)) { event.preventDefault(); commands[event.key](); return true; }
    if (event.key === 'Escape' && isNewMenuOpen()) { setNewMenuOpen(false); return true; }
    return false;
}

/**
 * Hands F5 and Ctrl/Cmd+R pressed in the preview to the editor's window inside a page, where
 * sync.js asks the page. A command that returns whether it took place.
 * @param {KeyboardEvent} event - the key.
 * @param {boolean} modifier - true with Ctrl or Cmd.
 * @returns {boolean} true when the key was handed on.
 */
function sendReload(event, modifier) {
    const sync = areas.sync;
    const reload = event.key === 'F5' || (modifier && !event.altKey && (event.key === 'r' || event.key === 'R'));
    if (event.view === window || !reload || !sync || !(sync.framed || sync.ownWindow)) return false;
    event.preventDefault();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, cancelable: true, view: window }));
    return true;
}
