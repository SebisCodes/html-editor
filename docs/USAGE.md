# Using the HTML Editor

The HTML Editor shows your HTML and CSS next to a live preview of the page. A click in the
preview jumps to the element's place in the code, and you can edit text right in the
preview. Pictures, stylesheets and fonts are kept with the page. The preview never runs
scripts, so any page is safe to open.

Open it at https://html.giit.ch/. It is free, needs no sign-up, and runs in your browser:
your documents stay there unless you send them somewhere yourself.

## What it can do

- Highlighting of HTML, of the CSS in `<style>` and `style=""`, and of the JavaScript in
  `<script>`.
- A live preview in a sandboxed frame: scripts and `on…` attributes never run, and links and
  forms do not navigate. The code keeps them unchanged, so the exported page works as
  before.
- Preview at full width, tablet (768 px) or phone (390 px) width.
- Problems with their line: unclosed or misnested elements, unknown elements, `<img>`
  without `alt`, missing files, ids used twice, a missing `<!DOCTYPE html>`.
- **Tidy**: block elements start lines of their own and every line is indented by its depth;
  text and inline elements stay on the line of their block, so the page looks the same.
- Document settings that edit the head: title, language, description and author, charset and
  viewport, linked stylesheets.
- Insert: headings, sections, lists, tables, links, pictures, figures, video, audio, form
  fields, meta tags, special characters.
- Templates: blank page, landing page, article, contact form, email newsletter.

## Getting started

1. **Start**: choose a template under **New**, open an `.html` file or paste HTML code.
2. **Write**: type in the code, or edit text in the preview. **Insert** has ready-made
   pieces.
3. **Export**: save the page as HTML, as one file with its files inside, as a ZIP or as a
   PDF.

## Editing in the preview

Click text in the preview to edit it right there. **Enter** starts a new paragraph (the
block is split, and inline elements around the text are closed and opened again),
**Shift+Enter** inserts `<br>`. **Ctrl+Enter** (Cmd+Enter on macOS) or a click elsewhere
applies the edit; **Escape** cancels. `&`, `<` and `>` are written as entities. Each edit is
one step for Undo. A click on a picture or any other element jumps to its place in the code;
the element at the code cursor gets a frame in the preview.

The right side panel has four tabs: **Document** (title, language and description of the
page), **Insert**, **Files** (the pictures, stylesheets and fonts of the page) and
**Outline** (the headings).

**Insert > New page** sets a page break for printing and PDF; the preview shows it as a
dashed line. Headings stay with their text, and tables and pictures are not cut. In
**Export**, "Apply page breaks" turns them off for a PDF.

## Your documents

Your documents are kept only in your browser (in `localStorage`, their files in IndexedDB),
not on a server, and stay there after you close the page. **My documents** (the folder
button at the top left) lists every document of this browser: open, rename, duplicate,
download (`.html`, or a ZIP with its files) and delete them.

Clearing the browser's site data removes them, so download the ones you want to keep, or let
the editor send them to your own server: **Save to server** (the cloud button) sets up a
webhook, an address that gets every saved version (see [EMBEDDING.md](EMBEDDING.md#webhook)
for what it receives). Nothing is sent until you enter an address there.

**Opening files:** `.html` files become new documents; a ZIP with an `.html` file and its
files opens as one document. Pictures, stylesheets and fonts dropped or pasted go into the
open document.

## Files

Pictures, stylesheets, fonts, scripts, PDFs, audio and video are stored with their page and
used by their name, for example `<img src="logo.png">`, `<link rel="stylesheet"
href="style.css">` or `url(font.woff2)`; in a folder, `img/logo.png` means `logo.png`. The
preview shows them in place of their names, and the code keeps the relative names. The
**Files** tab shows each file with its size, where it is used and the files that are
missing, and inserts, renames (the code follows), replaces, downloads and removes them.

## Export

**Export** offers:

- The **`.html`** file as it is.
- **One HTML file** with its files inside (as data URIs).
- A **ZIP** with the page and its files.
- **PDF** through the print dialog: choose "Save as PDF" as the printer. The browser's
  header and footer are left out, and the editor's address is centered at the bottom of
  every page.
- **Plain text**.

**Download .html** in the bar saves the code.

**Export > Open in another editor** converts the document in the browser to Markdown, LaTeX
or Typst and opens the result as a new document in that editor. Anything the other format
cannot hold is listed first. Pictures do not travel.

## AI Assistant

Any AI can work with you: ChatGPT, Claude, Gemini, Copilot or the AI in your coding tool.
Nothing to install and no key needed. Click **AI Assistant**, then **Copy prompt**, paste it
into your AI and say what it should do. The prompt holds the instructions and the current
document.

The prompt also contains the files of the document and the problems the editor found.

The AI answers with a link that carries the document after the `#`; click it and the
document appears in your editor. **Undo** takes every change back. The links look like this:

- `https://html.giit.ch/#b64=<base64url of the UTF-8 text>`
- `https://html.giit.ch/#html=<URL-encoded text>`
- `https://html.giit.ch/#z=<base64url of the zlib-compressed text>` (shortest)
- `&mode=add` adds HTML before `</body>` of the open document.
- `&file=new&name=<name>` makes a new document next to your others, `&file=<name>` changes
  that one; without `&file=` the open document changes.
- `&part=N&of=M&id=<name>` sends a long document in several links; the editor collects the
  parts.

A tab opened with such a link hands the document to the editor tab you used last. You can
also paste the AI's whole answer into the editor (Ctrl+V outside the code); links that a
terminal broke over several lines are joined. When the editor is embedded in another
website, links cannot reach it, so paste the answer there.

**Browser agents (WebMCP):** in browsers that offer WebMCP, the page registers tools for AI
agents that run in the page itself: `get_document`, `get_problems`, `list_elements`,
`set_document`, `insert_text`, `replace_text`, `show_line`, `undo`, and `list_files`,
`open_file`, `new_file` for your other documents. Every change is one step for Undo.

## Languages

The editor speaks English at `/`, German `/de/`, French `/fr/`, Italian `/it/`, Spanish
`/es/`, Portuguese `/pt/`, Dutch `/nl/`, Polish `/pl/`, Turkish `/tr/`, Russian `/ru/`,
Ukrainian `/uk/`, Chinese `/zh/`, Japanese `/ja/` and Korean `/ko/`. Opening
`https://html.giit.ch/` leads to the language you picked before in a language menu, or else
to your browser's language. A language picked in the menu holds for every giit.ch site. The
prompt for the AI is always in English.

## Color theme

Light, dark or automatic (following your system): the theme switch in the bar sets it, and
the editor remembers your choice.

## Keyboard shortcuts

On macOS use Cmd instead of Ctrl. The **Help** dialog in the editor lists them as well.

| Keys | Action |
|---|---|
| Ctrl + B / I / U | Bold / italic / underline the selected text |
| Ctrl + / | Comment lines in or out (`<!-- -->`) |
| Ctrl + Enter | Show the cursor's place in the preview |
| Tab / Shift + Tab | Indent / outdent |
| Ctrl + Z / Y | Undo / redo |
| Ctrl + S | Save (download `.html`, or to your server) |
| Ctrl + E | Export |
| Ctrl + O | My documents |
| Ctrl + P | Print / save as PDF |

Typing `>` at the end of a start tag adds its end tag, and Enter between the two indents the
new line. Typing `</` closes the element that is open.

## On your own website

The editor can be embedded in other websites with an iframe, opened in a window of its own
or used as a read-only viewer. See [EMBEDDING.md](EMBEDDING.md).
