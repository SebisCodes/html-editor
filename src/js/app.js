/**
 * HTML editor: the code on the left, the page in the middle, the document settings beside them.
 * This file starts the editor and wires its areas together; each area has its own module
 * (state.js describes the shared state).
 *
 * The code is the single source of truth: the preview is made from it (html.js), and the
 * settings, the insert buttons and the text edited in the preview change the code. Every
 * element of the preview carries data-hp, the place of its start tag in the code, so a click
 * in the preview leads to the code and the cursor in the code to the preview. The preview is a
 * frame without scripts (sandbox="allow-same-origin", src/preview.html with a policy that allows
 * no script): the page's elements are put into it, its files are shown from blob: addresses in
 * place of their names, and links do not navigate.
 *
 * Start-up steps:
 *   1. the interface language (the AI prompt stays English) and the line wrap of the code;
 *   2. connect the code view, the preview, the side panel, the documents, opening files, the
 *      keyboard, the layout, the Export dialog, the dialogs and the controls of template
 *      placeholders, in the order their listeners take events;
 *   3. take the stored settings and open the last document (or the welcome example);
 *   4. draw everything, and again once the document's files are read;
 *   5. start the AI Assistant, the WebMCP tools, the AI status, "Open in another editor" and
 *      sync.js (webhook, embedding, ?src=);
 *   6. offer the test hook window.htmlEditor.
 */

import { createI18n } from './i18n.js?v=26';
import { createWrap } from './wrap.js?v=5';
import { createAiStatus } from './aistatus.js?v=9';
import { createSync, VIEWER } from './sync.js?v=24';
import './export-menu.js?v=6';
import { startConvert } from './convert-to.js?v=14';
import { START } from './samples.js?v=3';
import { store } from './files.js?v=10';
import { assets } from './assets.js?v=6';
import { createAi } from './ai.js?v=10';
import { createMcp } from './mcp.js?v=4';
import { formatHtml } from './html-tidy.js?v=4';
import { state, ui, areas, PREFIX, getElement, showToast } from './state.js?v=2';
import { getSettings, startStorageSync } from './storage.js?v=5';
import { renderCode, moveCodeLayers, showCodePosition, startCodeView } from './code-view.js?v=5';
import { setCode, addHistoryStep, undo, redo } from './history.js?v=5';
import { renderPreview, startPreviewFrame, startPreviewTimer } from './preview.js?v=5';
import { startPictureMoving } from './picture-move.js?v=5';
import { startProblems } from './problems.js?v=5';
import { startTyping } from './typing.js?v=5';
import { renderInsertPanel, startInsertPanel } from './insert-panel.js?v=5';
import { startFilesTab } from './files-tab.js?v=5';
import { startSettingsPanel } from './settings-panel.js?v=5';
import { startOutline } from './outline.js?v=5';
import { showFileName, openDocument, createDocumentsDialog, startDocumentButtons } from './documents.js?v=5';
import { showFilePicker, startFileImport } from './file-import.js?v=5';
import { startKeyboard } from './keyboard.js?v=5';
import { showSplit, showPreviewWidth, startPreviewWidth, startLayout, startDialogs } from './layout.js?v=5';
import { startExportDialog } from './export-dialog.js?v=5';
import { runPrint, getPlainText } from './export.js?v=5';
import { startTemplateControls } from './template-panel.js?v=2';
import { createTemplateExamples } from './template-examples.js?v=1';
import { receiveDocument, importExternalDocument } from './incoming.js?v=5';
import {
    getPromptState, getProblemList, getAgentElements, getFileList, openFileByName, createFile, addHtml, updateText, showLine,
} from './agent-api.js?v=5';

/** The widths the preview can have. */
const PREVIEW_WIDTHS = /^(fill|768|390)$/;
/** How often a file that could not be stored is reported, at most, in milliseconds. */
const NOT_STORED_INTERVAL = 60000;
let notStoredWarnedAt = 0;

startEditor();

/**
 * Starts the editor (the flow of the steps in the header).
 * @returns {void}
 */
function startEditor() {
    startLanguageAndWrap();
    connectAreas();
    applyMemoryForPageFiles();
    openStartDocument();
    renderStart();
    window.htmlEditor = createTestHook();
}

/**
 * Starts the interface language (translated at run time, see i18n.js) and the line wrap of
 * the code view (wrap.js), which draws the line numbers.
 * @returns {void}
 */
function startLanguageAndWrap() {
    areas.i18n = createI18n({
        prefix: 'htmleditor',
        roots: '.header, .views, #work, #ai-receive, #toast, .storage-hint, dialog',
        skip: '',
    });
    areas.lineWrap = createWrap({
        prefix: PREFIX, ta: ui.ta, layers: [ui.hl, ui.marks], gutter: ui.gutter, button: document.getElementById('btn-wrap'),
        onChange: () => { renderCode(); moveCodeLayers(); },
    });
}

/**
 * Connects the areas of the page, in the order their listeners take events.
 * @returns {void}
 */
function connectAreas() {
    startStorageSync();
    startCodeView();
    startPreviewFrame();
    startPictureMoving();
    startPreviewWidth();
    startProblems();
    startTyping();
    startInsertPanel();
    startFilesTab();
    startSettingsPanel();
    startOutline();
    connectTidyButton();
    areas.files = createDocumentsDialog(showFilePicker);
    startDocumentButtons();
    startFileImport();
    startKeyboard();
    startLayout();
    startExportDialog();
    startDialogs();
    startTemplateControls();
}

/**
 * Connects the Tidy button: re-indents the code as one undo step.
 * @returns {void}
 */
function connectTidyButton() {
    getElement('#btn-format').addEventListener('click', formatCodeAsStep);
}

/**
 * Re-indents the code as one undo step and tells the user, also when it is tidy already.
 * @returns {void}
 */
function formatCodeAsStep() {
    const tidied = formatHtml(state.code);
    if (tidied === state.code) { showToast('The code is tidy already'); return; }
    setCode(tidied);
    showToast('Code tidied up');
}

/**
 * Keeps the files of documents from a page in memory like the documents; a file that could
 * not be stored is kept until the page closes, and the user is told (at most once a minute).
 * @returns {void}
 */
function applyMemoryForPageFiles() {
    assets.setMemoryOnlyRule(id => VIEWER || store.isInMemory(id));
    assets.setNotStoredHandler(showNotStoredWarning);
}

/**
 * Tells the user that a file could not be stored in the browser, at most once a minute.
 * @returns {void}
 */
function showNotStoredWarning() {
    const now = Date.now();
    if (now - notStoredWarnedAt < NOT_STORED_INTERVAL) return;
    notStoredWarnedAt = now;
    showToast('The picture could not be stored in this browser (storage full or blocked) - it is kept only until the page is closed: download the document to keep it');
}

/**
 * Takes the stored settings and opens the last document, or the welcome example when
 * "My documents" is empty; with the storage blocked, the example without saving.
 * @returns {void}
 */
function openStartDocument() {
    const settings = getSettings();
    if (settings) {
        if (settings.split) state.split = settings.split;
        if (settings.width && PREVIEW_WIDTHS.test(settings.width)) state.previewWidth = settings.width;
    }
    showSplit();
    showPreviewWidth();
    let code = null;
    try {
        if (!store.list().length) store.create(START.name, START.code);
        const entry = store.getEntry(settings?.file) || store.getSortedEntries()[0];
        code = store.code(entry.id);
        if (code != null) { state.fileId = entry.id; state.name = entry.name; state.savedCode = code; state.assets = assets.getCached(entry.id); }
    } catch (e) { /* storage blocked: one document without saving */ }
    if (code == null) { code = START.code; state.name = START.name; }
    state.code = code;
}

/**
 * Draws the start document, then reads its files, draws again, makes its first undo step and
 * starts the AI and sync.
 * @returns {void}
 */
function renderStart() {
    ui.ta.value = state.code;
    showFileName();
    renderInsertPanel();
    renderPreview();
    Promise.resolve(state.fileId ? assets.get(state.fileId).then(files => { state.assets = files; }) : null).then(renderStartDocument);
}

/**
 * Draws the start document again with its files, makes its first undo step and starts the AI
 * and sync.
 * @returns {void}
 */
function renderStartDocument() {
    renderInsertPanel();
    renderPreview();
    addHistoryStep();
    moveCodeLayers();
    startAiAndSync();
}

/**
 * Starts the AI Assistant, the WebMCP tools, the AI status, "Open in another editor" and
 * sync.js. The callbacks reach the areas through `areas`, so each may start after the ones
 * it calls.
 * @returns {void}
 */
function startAiAndSync() {
    areas.ai = createAi({
        getState: getPromptState,
        receiveDocument: async (...args) => { setTimeout(() => areas.aiStatus.addDelivery('link')); await receiveDocument(...args); return state.fileId; },
        tryOpenDocument: id => { if (!store.getEntry(id)) return false; openDocument(id); return true; },
        showToast,
        getRemote: () => areas.sync?.getAiSettings() || null,
        fetchKey: () => (areas.sync ? areas.sync.fetchKey() : Promise.resolve(null)),
        hasValidKey: () => !!areas.sync?.hasValidKey(),
        handleAiClick: openEditorDialog => (areas.sync ? areas.sync.handleAiClick(openEditorDialog) : openEditorDialog()),
        getKeyDecline: () => areas.sync?.getKeyDecline() || '',
    });
    const agent = createMcp({
        onUse: () => areas.aiStatus.addDelivery('agent'),
        getState: getPromptState,
        getProblems: getProblemList,
        getElements: getAgentElements,
        getFiles: getFileList,
        openFileByName,
        createFile,
        receiveDocument,
        addHtml,
        updateText,
        showLine,
        undo,
    });
    areas.aiStatus = createAiStatus({
        prefix: PREFIX, btn: document.getElementById('btn-ai'), box: document.getElementById('ai-status'),
        remote: () => areas.sync?.getAiSettings() || null, agent: () => agent,
    });
    startConvert({ editor: 'html', code: () => state.code, name: () => state.name, toast: showToast, t: text => areas.i18n.translate(text), hasFiles: () => Object.keys(state.assets || {}).length > 0 });
    areas.sync = createSync(createSyncEditor());
}

/**
 * Creates what sync.js gets from the editor; the property names are sync.js's contract.
 * @returns {object} the adapter.
 */
function createSyncEditor() {
    return {
        onAiResult: () => areas.aiStatus.addDelivery('page'),
        onAiEnd: () => areas.aiStatus.resetDelivery(),
        prefix: PREFIX, editor: 'html', word: 'document', files: true,
        tidy: code => formatHtml(code),
        current: () => ({ id: state.fileId, name: state.name, content: state.code, assets: state.assets }),
        load: importExternalDocument,
        toast: showToast,
        hookFor: id => store.getEntry(id)?.hook || null,
        setHookFor: (id, hook) => { try { store.setEntryFields(id, { hook }); } catch (e) { showToast('The browser storage is full'); } },
        onAi: () => areas.ai?.updateRemote(),
        parseTemplate: message => createTemplateExamples(message),
        onTemplate: () => startPreviewTimer(),
    };
}

/**
 * Creates the hook for automated UI tests (window.htmlEditor); its keys are the ones the tests call.
 * @returns {object} the state and the functions the tests call.
 */
function createTestHook() {
    return {
        state, store, assets, setCode, undo, redo, renderPreview, receive: receiveDocument, revealInCode: showCodePosition,
        sync: () => areas.sync, preview: () => state.previewDocument, tidy: formatHtml, print: runPrint, templateText: getPlainText,
    };
}
