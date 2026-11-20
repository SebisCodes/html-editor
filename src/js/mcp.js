/**
 * WebMCP: the editor offers its functions as tools to an AI agent that runs in the browser
 * (document.modelContext, in Chrome as an early preview). The tools run in this page only -
 * no server, no connector. Browsers without WebMCP skip this. Every change is a normal undo
 * step.
 *
 * The text tools work on the open document; list_files, open_file and new_file reach the
 * user's other documents ("My documents"). The tool names, descriptions and parameters are the
 * contract with the agents and stay as they are.
 *
 * createMcp() runs these steps:
 *   1. find WebMCP; without it, return null;
 *   2. wrap every tool so a call notes its time and tells the editor;
 *   3. register the tools;
 *   4. return { last() }, when an agent last used a tool (for the AI status in aistatus.js).
 */

/** The most elements list_elements lists. */
const MAX_LISTED_ELEMENTS = 400;
/** The deepest indentation of list_elements. */
const MAX_LISTED_DEPTH = 12;

/**
 * An element as list_elements describes it.
 * @typedef {object} AgentElement
 * @property {string} name - the element name.
 * @property {number} depth - its depth in the tree.
 * @property {number} line - its line.
 * @property {string} id - its id, "" without one.
 * @property {string} cls - its classes.
 * @property {string} text - the start of its text.
 */

/**
 * What the editor hands to createMcp(); the functions throw an Error with a message for
 * the agent when a call cannot be done.
 * @typedef {object} McpEditor
 * @property {function(): void} [onUse] - a tool was called.
 * @property {function(): object} getState - what the agent sees: name, sel, pictures and code.
 * @property {function(): Array<{line: number, kind: string, msg: string}>} getProblems - the problems.
 * @property {function(string): AgentElement[]} getElements - the elements, of one tag when given.
 * @property {function(): Array<{name: string, updated: number, open: boolean}>} getFiles - the documents.
 * @property {function(string): boolean} openFileByName - opens a document by name; false when there is none.
 * @property {function(string, string): (string|null)} createFile - makes and opens a document; its name, null when storage is full.
 * @property {function(string, string, object): Promise<void>} receiveDocument - takes a whole document.
 * @property {function(string, string): boolean} addHtml - inserts HTML at the end, the cursor or after a heading; false when the heading is missing.
 * @property {function(string, string, boolean): number} updateText - replaces text (the work of replace_text); how many times.
 * @property {function(number): void} showLine - shows a line of the code.
 * @property {function(): void} undo - undoes the last change.
 */

/**
 * What createMcp() returns, read by the AI status.
 * @typedef {object} McpStatus
 * @property {function(): number} last - when an agent last used a tool (milliseconds since 1970), 0 for never.
 */

/**
 * Registers the editor's WebMCP tools (an initializeX: it returns the status object).
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {McpStatus|null} the status, null without WebMCP.
 */
export function createMcp(editor) {
    const modelContext = document.modelContext || navigator.modelContext;
    if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
    let lastCall = 0;
    for (const tool of createTools(editor)) {
        const run = tool.execute;
        /**
         * Runs the tool after noting the call for the AI status.
         * @param {...*} args - the tool's arguments.
         * @returns {Promise<*>} the tool's answer.
         */
        tool.execute = async (...args) => { lastCall = Date.now(); editor.onUse?.(); return run(...args); };
        addTool(modelContext, tool);
    }
    return { last: () => lastCall };
}

/**
 * Registers one tool; a tool the browser refuses is left out.
 * @param {object} modelContext - the browser's WebMCP object.
 * @param {object} tool - the tool.
 * @returns {void}
 */
function addTool(modelContext, tool) {
    try {
        const result = modelContext.registerTool(tool);
        if (result && typeof result.catch === 'function') result.catch(() => { /* not available on this page */ });
    } catch (e) { /* the browser refused this tool */ }
}

/**
 * Creates the tools with their descriptions, input schemas and functions.
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {object[]} the tools in the order they are registered.
 */
function createTools(editor) {
    return [
        {
            name: 'get_document',
            description: 'Returns the name and the HTML code of the document open in the editor, the selected text and the files (pictures, stylesheets …) it can use by name.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getDocument,
        },
        {
            name: 'get_problems',
            description: 'Lists the errors and warnings the editor finds in the document (unclosed or misnested elements, unknown elements, pictures without alt, missing files, duplicate ids), with line numbers.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
            execute: getProblems,
        },
        {
            name: 'list_elements',
            description: 'Lists the elements of the page in the order of the code: tag, id, classes, line, a little of their text; headings are marked. Use it to find where to change something.',
            inputSchema: {
                type: 'object',
                properties: { tag: { type: 'string', description: 'Optional: only elements with this tag name (e.g. "h2", "img", "a").' } },
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getElementList,
        },
        {
            name: 'set_document',
            description: 'Replaces the whole open document with new HTML code (<!DOCTYPE html> … </html>). Keep the user\'s existing work unless asked otherwise.',
            inputSchema: { type: 'object', properties: { html: { type: 'string', description: 'The complete HTML code.' } }, required: ['html'] },
            execute: setDocument,
        },
        {
            name: 'insert_text',
            description: 'Inserts HTML into the open document: at the end (before </body>), at the cursor, or right after the heading with the given text or id.',
            inputSchema: {
                type: 'object',
                properties: {
                    html: { type: 'string', description: 'The HTML to insert.' },
                    where: { type: 'string', description: '"end" (default), "cursor", or the text or id of a heading to insert after it.' },
                },
                required: ['html'],
            },
            execute: runInsertText,
        },
        {
            name: 'replace_text',
            description: 'Replaces an exact piece of the HTML code with new text (the first match, or every match with all=true).',
            inputSchema: {
                type: 'object',
                properties: {
                    find: { type: 'string', description: 'The exact text to find in the code.' },
                    replace: { type: 'string', description: 'The new text.' },
                    all: { type: 'boolean', description: 'Replace every match.' },
                },
                required: ['find', 'replace'],
            },
            execute: runReplaceText,
        },
        {
            name: 'show_line',
            description: 'Moves the cursor to a line of the code and shows that place in the preview, so the user sees it.',
            inputSchema: { type: 'object', properties: { line: { type: 'number', description: 'Line number (1 = first line).' } }, required: ['line'] },
            execute: showLine,
        },
        {
            name: 'list_files',
            description: 'Lists the user\'s documents stored in the editor ("My documents"), most recently changed first, and which one is open.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getFileList,
        },
        {
            name: 'open_file',
            description: 'Opens one of the user\'s documents by name; the other tools then work on it.',
            inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'The name from list_files.' } }, required: ['name'] },
            execute: openFile,
        },
        {
            name: 'new_file',
            description: 'Creates a new document and opens it; the user\'s other documents stay unchanged. Without html it starts from an empty page.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'A short name for the document.' },
                    html: { type: 'string', description: 'Optional: the complete HTML code.' },
                },
                required: ['name'],
            },
            execute: createFile,
        },
        {
            name: 'undo',
            description: 'Undoes the last change in the editor.',
            inputSchema: { type: 'object', properties: {} },
            execute: undo,
        },
    ];

    /**
     * get_document: the open document, the selection and its files.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function getDocument() {
        const state = editor.getState();
        return `Document: "${state.name}"\n${state.sel ? `Selected: ${state.sel}\n` : ''}${state.pictures.length ? `Files: ${state.pictures.join(', ')}\n` : ''}\n${state.code}`;
    }

    /**
     * get_problems: the problems with their lines.
     * @returns {Promise<string>} one problem per line, or "No problems.".
     */
    async function getProblems() {
        const problems = editor.getProblems();
        return problems.length ? problems.map(problem => `line ${problem.line} (${problem.kind}): ${problem.msg}`).join('\n') : 'No problems.';
    }

    /**
     * list_elements: the elements in code order, indented by depth, the first 400.
     * @param {object} [input] - the tool's input.
     * @param {string} [input.tag] - the tag to list only.
     * @returns {Promise<string>} one element per line.
     */
    async function getElementList({ tag } = {}) {
        const list = editor.getElements(String(tag || '').trim().toLowerCase());
        if (!list.length) return tag ? `No <${tag}> elements.` : 'The page has no elements.';
        return list.slice(0, MAX_LISTED_ELEMENTS).map(element => `${'  '.repeat(Math.min(element.depth, MAX_LISTED_DEPTH))}<${element.name}${element.id ? '#' + element.id : ''}${element.cls ? '.' + element.cls.split(/\s+/).join('.') : ''}> line ${element.line}${element.text ? ': ' + element.text : ''}`).join('\n')
            + (list.length > MAX_LISTED_ELEMENTS ? `\n… ${list.length - MAX_LISTED_ELEMENTS} more` : '');
    }

    /**
     * set_document: a whole new code for the open document.
     * @param {object} input - the tool's input.
     * @param {string} input.html - the complete HTML code.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the code is empty.
     */
    async function setDocument({ html }) {
        if (!String(html || '').trim()) throw new Error('The document is empty.');
        editor.receiveDocument(html, 'replace', { direct: true });
        const errors = editor.getProblems().filter(problem => problem.kind === 'error');
        return errors.length ? `Loaded, with ${errors.length} error(s) - see get_problems.` : 'The document is in the editor.';
    }

    /**
     * insert_text: HTML at the end, at the cursor or after a heading.
     * @param {object} input - the tool's input.
     * @param {string} input.html - the HTML.
     * @param {string} [input.where] - "end", "cursor" or a heading's text or id.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when there is no such heading.
     */
    async function runInsertText({ html, where }) {
        if (!editor.addHtml(String(html || ''), String(where || 'end'))) throw new Error(`No heading "${where}" - call list_elements with tag "h2" (or h1 … h6).`);
        return 'Inserted.';
    }

    /**
     * replace_text: an exact piece of the code replaced.
     * @param {object} input - the tool's input.
     * @param {string} input.find - the text.
     * @param {string} input.replace - its replacement.
     * @param {boolean} [input.all] - true for every match.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the text is not found.
     */
    async function runReplaceText({ find, replace, all }) {
        const count = editor.updateText(String(find || ''), String(replace ?? ''), !!all);
        if (!count) throw new Error('The text was not found - call get_document to see the exact code.');
        return `Replaced ${count} time${count === 1 ? '' : 's'}.`;
    }

    /**
     * show_line: the cursor on a line, shown in the preview.
     * @param {object} input - the tool's input.
     * @param {number} input.line - the line number.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function showLine({ line }) {
        editor.showLine(Math.max(1, Math.round(+line || 1)));
        return `Showing line ${line}.`;
    }

    /**
     * list_files: the user's documents, the open one marked.
     * @returns {Promise<string>} one document per line.
     */
    async function getFileList() {
        return editor.getFiles().map(file => `${file.open ? '* ' : '  '}"${file.name}" (changed ${new Date(file.updated).toISOString().slice(0, 16).replace('T', ' ')})`).join('\n') + '\n(* = open now)';
    }

    /**
     * open_file: one of the user's documents.
     * @param {object} input - the tool's input.
     * @param {string} input.name - the document's name.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when there is no document of that name.
     */
    async function openFile({ name }) {
        if (!editor.openFileByName(name)) throw new Error(`No document "${name}" - call list_files.`);
        return `"${name}" is open.`;
    }

    /**
     * new_file: a new document, opened.
     * @param {object} input - the tool's input.
     * @param {string} input.name - its name.
     * @param {string} [input.html] - its code.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the browser storage is full.
     */
    async function createFile({ name, html }) {
        const createdName = editor.createFile(name, html);
        if (!createdName) throw new Error('The browser storage is full.');
        return `New document "${createdName}" is open.`;
    }

    /**
     * undo: the last change undone.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function undo() {
        editor.undo();
        return 'Undone.';
    }
}
