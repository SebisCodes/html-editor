/**
 * Snippets: the formatting buttons above the code and the Insert tab of the side panel
 * (structure, lists and tables, text, media, forms, the head, special characters). A picture
 * snippet uses the document's first picture when it has one.
 */

import { escapeHtml } from './html-tokens.js?v=3';
import { isPicture } from './assets.js?v=6';
import { state, ui, getElement, getElements } from './state.js?v=2';
import { addSnippet, addTagAroundSelection } from './code-insert.js?v=8';
import { renderFilesTab } from './files-tab.js?v=8';

/** The snippets by key: [text, block, head]; "|" marks the cursor, "§" the selected text. */
const SNIPPETS = {
    h1: ['<h1>|§</h1>', true], h2: ['<h2>|§</h2>', true], h3: ['<h3>|§</h3>', true], h4: ['<h4>|§</h4>', true],
    p: ['<p>|§</p>', true], br: ['<br>|', false], hr: ['<hr>|', true], newpage: ['<div style="page-break-after: always"></div>\n|', true],
    section: ['<section>\n  <h2>|Title</h2>\n  <p>§</p>\n</section>', true],
    article: ['<article>\n  <h2>|Title</h2>\n  <p>§</p>\n</article>', true],
    header: ['<header>\n  <h1>|Title</h1>\n</header>', true],
    nav: ['<nav>\n  <a href="#|">Home</a>\n  <a href="#">About</a>\n  <a href="#">Contact</a>\n</nav>', true],
    main: ['<main>\n  |§\n</main>', true],
    footer: ['<footer>\n  <p>|&copy; Name</p>\n</footer>', true],
    div: ['<div class="|">\n  §\n</div>', true], span: ['<span class="|">§</span>', false],
    details: ['<details>\n  <summary>|Question</summary>\n  <p>Answer</p>\n</details>', true],
    ul: ['<ul>\n  <li>|§</li>\n  <li></li>\n</ul>', true],
    ol: ['<ol>\n  <li>|§</li>\n  <li></li>\n</ol>', true],
    dl: ['<dl>\n  <dt>|Term</dt>\n  <dd>Explanation</dd>\n</dl>', true],
    table: ['<table>\n  <thead>\n    <tr><th>|Name</th><th>Value</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>One</td><td>1</td></tr>\n    <tr><td>Two</td><td>2</td></tr>\n  </tbody>\n</table>', true],
    a: ['<a href="https://|">§</a>', false],
    strong: ['<strong>|§</strong>', false], em: ['<em>|§</em>', false], mark: ['<mark>|§</mark>', false],
    small: ['<small>|§</small>', false], code: ['<code>|§</code>', false], sup: ['<sup>|§</sup>', false], sub: ['<sub>|§</sub>', false],
    blockquote: ['<blockquote>\n  <p>|§</p>\n</blockquote>', true],
    pre: ['<pre><code>|§</code></pre>', true],
    comment: ['<!-- |§ -->', false],
    img: ['<img src="|picture.jpg" alt="">', false],
    figure: ['<figure>\n  <img src="picture.jpg" alt="">\n  <figcaption>|Caption</figcaption>\n</figure>', true],
    video: ['<video src="|video.mp4" controls></video>', true],
    audio: ['<audio src="|sound.mp3" controls></audio>', true],
    button: ['<button type="button">|Click</button>', false],
    form: ['<form action="" method="post">\n  <label for="name">Name</label>\n  <input id="name" name="name" type="text">\n  <button type="submit">|Send</button>\n</form>', true],
    input: ['<label for="|field">Label</label>\n<input id="field" name="field" type="text">', true],
    email: ['<label for="|email">Email</label>\n<input id="email" name="email" type="email" autocomplete="email">', true],
    textarea: ['<label for="|message">Message</label>\n<textarea id="message" name="message" rows="5"></textarea>', true],
    select: ['<label for="|choice">Choice</label>\n<select id="choice" name="choice">\n  <option>One</option>\n  <option>Two</option>\n</select>', true],
    checkbox: ['<label><input type="checkbox" name="|agree"> I agree</label>', true],
    radio: ['<label><input type="radio" name="|size" value="s"> Small</label>\n<label><input type="radio" name="size" value="l"> Large</label>', true],
    charset: ['<meta charset="utf-8">|', false, true],
    viewport: ['<meta name="viewport" content="width=device-width, initial-scale=1">|', false, true],
    description: ['<meta name="description" content="|">', false, true],
    stylesheet: ['<link rel="stylesheet" href="|style.css">', false, true],
    style: ['<style>\n  |\n</style>', false, true],
    favicon: ['<link rel="icon" href="|favicon.png">', false, true],
    og: ['<meta property="og:title" content="|">\n<meta property="og:description" content="">\n<meta property="og:image" content="">', false, true],
};

/**
 * The special characters of the Insert tab: [entity, character, name]. Their labels are kept
 * out of the translation: a pack translates the closing quote of other texts ("Change “…”"),
 * which would rename the button ”.
 */
const CHARACTERS = [['&nbsp;', '␣', 'no-break space'], ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&copy;', '©'], ['&reg;', '®'], ['&trade;', '™'],
    ['&euro;', '€'], ['&pound;', '£'], ['&mdash;', '—'], ['&ndash;', '–'], ['&hellip;', '…'], ['&laquo;', '«'], ['&raquo;', '»'], ['&bdquo;', '„'],
    ['&ldquo;', '“'], ['&rdquo;', '”'], ['&lsquo;', '‘'], ['&rsquo;', '’'], ['&middot;', '·'], ['&bull;', '•'], ['&deg;', '°'], ['&plusmn;', '±'],
    ['&times;', '×'], ['&divide;', '÷'], ['&rarr;', '→'], ['&larr;', '←'], ['&uarr;', '↑'], ['&darr;', '↓'], ['&hearts;', '♥'], ['&check;', '✓'],
    ['&shy;', '‐', 'soft hyphen'], ['&para;', '¶'], ['&sect;', '§'], ['&frac12;', '½']];

/**
 * Inserts the snippet of a key at the cursor; a picture or figure uses the document's first
 * picture when it has one.
 * @param {string} key - the snippet's key.
 * @returns {void}
 */
export function addNamedSnippet(key) {
    const [snippet, block, head] = SNIPPETS[key];
    let text = snippet;
    const picture = Object.keys(state.assets).find(isPicture);
    if ((key === 'img' || key === 'figure') && picture) text = snippet.replace('|picture.jpg', '|' + picture).replace('"picture.jpg"', `"${picture}"`);
    addSnippet(text, block, head);
}

/**
 * Returns a button of the Insert tab.
 * @param {string} key - the snippet's key.
 * @param {string} label - the label.
 * @param {string} [title] - the tooltip; the label when left out.
 * @returns {string} the button's HTML.
 */
function formatInsertButton(key, label, title) {
    return `<button type="button" class="button" data-ins="${key}" title="${escapeHtml(title || label)}">${escapeHtml(label)}</button>`;
}

/**
 * Draws the Insert tab (and the Files tab when it is shown).
 * @returns {void}
 */
export function renderInsertPanel() {
    if (!ui.pictures.hidden) renderFilesTab();
    const button = formatInsertButton;
    ui.insert.innerHTML = `
        <div class="insert-group"><h3>Structure</h3><div class="insert-grid">
            ${button('h1', 'Heading 1')}${button('h2', 'Heading 2')}${button('h3', 'Heading 3')}${button('h4', 'Heading 4')}
            ${button('p', 'Paragraph')}${button('section', 'Section')}${button('article', 'Article')}${button('header', 'Header')}
            ${button('nav', 'Navigation bar')}${button('main', 'Main content')}${button('footer', 'Footer')}${button('div', 'Box')}
            ${button('details', 'Fold-out (details)')}${button('hr', 'Dividing line')}${button('newpage', 'New page')}${button('br', 'Line break')}${button('comment', 'Comment')}
        </div></div>
        <div class="insert-group"><h3>Lists and tables</h3><div class="insert-grid">
            ${button('ul', '• Bulleted list')}${button('ol', '1. Numbered list')}${button('dl', 'Description list')}${button('table', 'Table')}
        </div></div>
        <div class="insert-group"><h3>Text</h3><div class="insert-grid">
            ${button('a', 'Link')}${button('strong', 'Bold')}${button('em', 'Italic')}${button('mark', 'Highlighted')}
            ${button('small', 'Small print')}${button('code', 'Code in the text')}${button('sup', 'x² Superscript')}${button('sub', 'x₁ Subscript')}
            ${button('blockquote', 'Quote')}${button('pre', 'Program code')}${button('span', 'Inline part (span)')}
        </div></div>
        <div class="insert-group"><h3>Media</h3><div class="insert-grid">
            ${button('img', 'Picture')}${button('figure', 'Figure with caption')}${button('video', 'Video player')}${button('audio', 'Audio player')}
        </div>
            <p class="hint">The files of the page have their own tab: <button type="button" class="link-button" data-goto-pics>Files</button>.</p>
        </div>
        <div class="insert-group"><h3>Forms</h3><div class="insert-grid">
            ${button('form', 'Form')}${button('input', 'Text field')}${button('email', 'Email field')}${button('textarea', 'Text area')}
            ${button('select', 'Choice list')}${button('checkbox', 'Tick box')}${button('radio', 'Radio buttons')}${button('button', 'Button')}
        </div></div>
        <div class="insert-group"><h3>Head</h3><div class="insert-grid">
            ${button('charset', 'Character set', 'The character set: <meta charset="utf-8">')}${button('viewport', 'Phone width', 'Fits phone screens: <meta name="viewport">')}${button('description', 'Description', 'For search engines: <meta name="description">')}${button('og', 'Shared links', 'Title, description and picture for shared links (Open Graph)')}
            ${button('stylesheet', 'Stylesheet file', 'A stylesheet file: <link rel="stylesheet">')}${button('style', 'Style block', 'CSS in the page: <style> … </style>')}${button('favicon', 'Tab icon', 'The icon in the browser tab: <link rel="icon">')}
        </div>
        <h3>Special characters</h3><div class="symbol-grid">${CHARACTERS.map(formatCharacterButton).join('')}</div></div>`;
}

/**
 * Returns the button of a special character.
 * @param {string[]} character - [entity, character, name].
 * @returns {string} the button's HTML.
 */
function formatCharacterButton([entity, shown, name]) {
    return `<button type="button" data-sym="${escapeHtml(entity)}" title="${escapeHtml(`Insert ${entity}${name ? ` (${name})` : ''}`)}"><span data-no-i18n>${escapeHtml(shown)}</span></button>`;
}

/**
 * Connects the formatting buttons above the code and the Insert tab; their buttons keep the
 * cursor in the code (mousedown would move the focus).
 * @returns {void}
 */
export function startInsertPanel() {
    getElements('[data-wrap], [data-snippet]').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
    getElements('[data-wrap]').forEach(button => button.addEventListener('click', () => addTagAroundSelection(button.dataset.wrap)));
    getElements('[data-snippet]').forEach(button => button.addEventListener('click', () => addNamedSnippet(button.dataset.snippet)));
    ui.insert.addEventListener('mousedown', event => { if (event.target.closest('[data-ins], [data-sym]')) event.preventDefault(); });
    ui.insert.addEventListener('click', addFromInsertTab);
}

/**
 * Inserts the snippet or character of the clicked button of the Insert tab, or switches to
 * the Files tab.
 * @param {MouseEvent} event - the click in the Insert tab.
 * @returns {void}
 */
function addFromInsertTab(event) {
    const snippetButton = event.target.closest('[data-ins]');
    if (snippetButton) { addNamedSnippet(snippetButton.dataset.ins); return; }
    const characterButton = event.target.closest('[data-sym]');
    if (characterButton) { addSnippet(characterButton.dataset.sym, false); return; }
    if (event.target.closest('[data-goto-pics]')) getElement('[data-itab=pictures]').click();
}
