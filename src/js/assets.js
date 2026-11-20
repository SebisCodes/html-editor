/**
 * Files of a document (pictures, stylesheets, fonts …) kept in the browser's IndexedDB: they
 * are too large for localStorage. One record per document: { name: data URI }. The code uses
 * them by their name (<img src="logo.png">). Without IndexedDB the files live only until the
 * page is closed; files of documents kept in memory (from a page) never go into IndexedDB.
 *
 * The review test imports this file with the ?v= the editor's own
 * modules import it with, slows assets.set() down and reads assets.get(): every write goes
 * through assets.set, and these names stay.
 */

const DATABASE = 'htmleditor';
const STORE = 'assets';
const DATABASE_VERSION = 1;
const DEFAULT_FILE_NAME = 'file';
/** The media type of a file by its extension. */
const TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
    ico: 'image/x-icon', bmp: 'image/bmp', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
    txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', html: 'text/html', htm: 'text/html', pdf: 'application/pdf',
    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', vtt: 'text/vtt',
};

/** The files of each document read or written in this page, by document id. */
const memory = new Map();
let databasePromise = null;
/**
 * Tells whether a document keeps its files in memory only; set by setMemoryOnlyRule().
 * @param {string} id - the document's id.
 * @returns {boolean} true for a document kept in memory only.
 */
let isMemoryOnly = () => false;
/**
 * Runs when a write did not reach IndexedDB; set by setNotStoredHandler().
 * @param {string} id - the document's id.
 * @returns {void}
 */
let handleNotStored = () => {};

/**
 * Returns the database, opened once.
 * @returns {Promise<IDBDatabase|null>} the database, null without IndexedDB.
 */
function getDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(resolve => {
        try {
            const request = indexedDB.open(DATABASE, DATABASE_VERSION);
            /**
             * Creates the store in a new database.
             * @returns {void}
             */
            request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
            /**
             * Settles with the open database.
             * @returns {void}
             */
            request.onsuccess = () => resolve(request.result);
            /**
             * Settles without a database when it cannot be opened or another tab blocks it.
             * @returns {void}
             */
            request.onerror = request.onblocked = () => resolve(null);
        } catch (e) { resolve(null); }
    });
    return databasePromise;
}

/**
 * Runs a request in a transaction of the store.
 * @param {string} mode - "readonly" or "readwrite".
 * @param {function(IDBObjectStore): (IDBRequest|undefined)} run - makes the request.
 * @returns {Promise<*>} the request's result (true without a request), null when it failed or there is no database.
 */
async function runTransaction(mode, run) {
    const database = await getDatabase();
    if (!database) return null;
    return new Promise(resolve => {
        try {
            const transaction = database.transaction(STORE, mode);
            const request = run(transaction.objectStore(STORE));
            /**
             * Settles with the request's result once the transaction is done.
             * @returns {void}
             */
            transaction.oncomplete = () => resolve(request ? request.result : true);
            /**
             * Settles with null when the transaction fails.
             * @returns {void}
             */
            transaction.onerror = transaction.onabort = () => resolve(null);
        } catch (e) { resolve(null); }
    });
}

/**
 * The files of the documents.
 */
export const assets = {
    /**
     * Returns all files of a document. The name is the one the review test calls.
     * A query that fills a cache.
     * @param {string} id - the document's id.
     * @returns {Promise<Object<string, string>>} name -> data URI, empty when it has none.
     */
    async get(id) {
        if (memory.has(id) || isMemoryOnly(id)) return memory.get(id) || {};
        const files = (await runTransaction('readonly', objectStore => objectStore.get(id))) || {};
        memory.set(id, files);
        return files;
    },

    /**
     * Returns the files of a document as far as this page has read them.
     * @param {string} id - the document's id.
     * @returns {Object<string, string>} name -> data URI.
     */
    getCached(id) {
        return memory.get(id) || {};
    },

    /**
     * Sets which documents keep their files in memory only.
     * @param {function(string): boolean} test - true for a document kept in memory only (store.isInMemory).
     * @returns {void}
     */
    setMemoryOnlyRule(test) {
        isMemoryOnly = test;
    },

    /**
     * Sets what happens when a write does not reach IndexedDB (storage full or blocked): the
     * files are then in memory only.
     * @param {function(string): void} handler - gets the document's id.
     * @returns {void}
     */
    setNotStoredHandler(handler) {
        handleNotStored = handler;
    },

    /**
     * Sets all files of a document. The name is the one the review test replaces to
     * slow writing down, so every write goes through it.
     * @param {string} id - the document's id.
     * @param {Object<string, string>} files - name -> data URI.
     * @returns {Promise<void>} settles when the files are stored (or kept in memory).
     */
    async set(id, files) {
        memory.set(id, files);
        if (!isMemoryOnly(id) && (await runTransaction('readwrite', objectStore => objectStore.put(files, id))) === null) handleNotStored(id);
    },

    /**
     * Adds or replaces one file of a document. A command that returns the new set, as the
     * caller shows it.
     * @param {string} id - the document's id.
     * @param {string} name - the file's name.
     * @param {string} dataUrl - its content.
     * @returns {Promise<Object<string, string>>} all files of the document.
     */
    async add(id, name, dataUrl) {
        const files = { ...(await this.get(id)) };
        files[name] = dataUrl;
        await this.set(id, files);
        return files;
    },

    /**
     * Removes one file of a document. A command that returns the new set, as the caller
     * shows it.
     * @param {string} id - the document's id.
     * @param {string} name - the file's name.
     * @returns {Promise<Object<string, string>>} the files left.
     */
    async remove(id, name) {
        const files = { ...(await this.get(id)) };
        delete files[name];
        await this.set(id, files);
        return files;
    },

    /**
     * Removes all files of a document.
     * @param {string} id - the document's id.
     * @returns {Promise<void>} settles when they are removed.
     */
    async removeDocument(id) {
        memory.delete(id);
        if (!isMemoryOnly(id)) await runTransaction('readwrite', objectStore => objectStore.delete(id));
    },

    /**
     * Copies all files of one document to another.
     * @param {string} from - the id of the document copied from.
     * @param {string} to - the id of the document copied to.
     * @returns {Promise<void>} settles when the copy is stored.
     */
    async copy(from, to) {
        await this.set(to, { ...(await this.get(from)) });
    },
};

/**
 * Returns the extension of a file name.
 * @param {string} name - the file name.
 * @returns {string} the extension in lower case, "" without one.
 */
export function getExtension(name) {
    return (/\.([a-z0-9]+)$/i.exec(name) || ['', ''])[1].toLowerCase();
}

/**
 * Returns the media type of a file by its name.
 * @param {string} name - the file name.
 * @returns {string} the media type, "" when the extension is not known.
 */
export function getMediaType(name) {
    return TYPES[getExtension(name)] || '';
}

/**
 * Tells whether a file is a picture, by its name.
 * @param {string} name - the file name.
 * @returns {boolean} true for an image type.
 */
export function isPicture(name) {
    return /^image\//.test(getMediaType(name));
}

/**
 * Tells whether a document can keep a file: every known type except HTML.
 * @param {string} name - the file name.
 * @returns {boolean} true when it can be kept.
 */
export function isKeepable(name) {
    return !!TYPES[getExtension(name)] && !/^(html|htm)$/.test(getExtension(name));
}

/**
 * Returns a file name that is not taken yet: "logo.png", "logo-2.png" …
 * @param {Object<string, *>} files - the files by name.
 * @param {string} name - the wanted name; characters other than letters, digits, ".", "-" and "_" become "-".
 * @returns {string} the free name.
 */
export function getFreeName(files, name) {
    const clean = String(name || DEFAULT_FILE_NAME).replace(/[^\w.\-]+/g, '-').replace(/^-+/, '') || DEFAULT_FILE_NAME;
    if (!files[clean]) return clean;
    const match = /^(.*?)(\.[a-z0-9]+)?$/i.exec(clean), stem = match[1], extension = match[2] || '';
    for (let k = 2; ; k++) if (!files[`${stem}-${k}${extension}`]) return `${stem}-${k}${extension}`;
}

/**
 * Reads a file as a data URI with the media type of its name (browsers give many files, fonts
 * for example, no type of their own).
 * @param {Blob} file - the file.
 * @param {string} [name] - its name.
 * @returns {Promise<string>} the data URI.
 * @throws {Error} when the file cannot be read (the Promise rejects).
 */
export function readAsDataUrl(file, name = file.name) {
    const type = getMediaType(name || '') || file.type || 'application/octet-stream';
    const blob = file.type === type ? file : new Blob([file], { type });
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        /**
         * Settles with the data URI.
         * @returns {void}
         */
        reader.onload = () => resolve(reader.result);
        /**
         * Rejects when the file cannot be read.
         * @returns {void}
         */
        reader.onerror = () => reject(new Error('The file could not be read'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Returns the bytes of a data URI.
 * @param {string} dataUrl - the data URI, base64 or URL-encoded.
 * @returns {Uint8Array} its bytes.
 */
export function getDataUrlBytes(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const isBase64 = /;base64/.test(dataUrl.slice(0, comma));
    const data = dataUrl.slice(comma + 1);
    if (!isBase64) return new TextEncoder().encode(decodeURIComponent(data));
    const binary = atob(data);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/**
 * Returns the text of a data URI (a stylesheet).
 * @param {string} dataUrl - the data URI.
 * @returns {string} its bytes read as UTF-8.
 */
export function getDataUrlText(dataUrl) {
    return new TextDecoder().decode(getDataUrlBytes(dataUrl));
}
