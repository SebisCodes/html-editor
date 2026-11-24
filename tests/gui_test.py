"""Browser test of the HTML editor (Playwright, Google Chrome).

    php -S 127.0.0.1:8095 -t src src/php/router.php          (in the project folder)
    python tests/gui_test.py

Checks the preview, problems, code <-> preview, typing help, tidy, the
document settings, insert, My documents, files of a document, AI links,
export and the phone layout."""

import base64
import os
import sys
import tempfile
import zipfile
import zlib

from playwright.sync_api import sync_playwright

URL = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8095/')
HERE = os.path.dirname(os.path.abspath(__file__))
failures = []


def check_that(cond, what):
    """Prints one result line and notes a failure.

    Args:
        cond (bool): True when the check holds.
        what (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        failures.append(what)


def read(name):
    """Returns the text of a file next to this test.

    Args:
        name (str): the path relative to the tests folder.

    Returns:
        str: the file's text.
    """
    with open(os.path.join(HERE, name), encoding='utf-8') as f:
        return f.read()



def show_side_panel(page, is_open):
    """Opens or closes the side panel's column (it is closed at the start).

    Args:
        page (Page): the editor's page or frame.
        is_open (bool): True to open it, False to close it.

    Returns:
        None: the side panel is open or closed.
    """
    button = page.locator('#btn-panel')
    if button.count() and button.is_visible() and (button.get_attribute('aria-expanded') == 'true') != is_open:
        button.click()

def set_code(page, html):
    """Sets the editor's code and waits for the preview.

    Args:
        page (Page): the editor page.
        html (str): the HTML code.

    Returns:
        None: the editor holds the code.
    """
    page.evaluate('t => htmlEditor.setCode(t)', html)
    page.wait_for_timeout(300)


def get_state(page, expr):
    """Returns a value of the editor state.

    Args:
        page (Page): the editor page.
        expr (str): a JavaScript expression over S, the editor state.

    Returns:
        Any: the value of the expression.
    """
    return page.evaluate(f'() => {{ const S = htmlEditor.state; return {expr}; }}')


def get_preview_value(page, expr):
    """Returns the value of an expression about the preview's document.

    Args:
        page (Page): the editor page.
        expr (str): a JavaScript expression over d, the preview's document.

    Returns:
        Any: the value of the expression.
    """
    return page.evaluate(f'() => {{ const d = htmlEditor.preview(); return {expr}; }}')


def get_text_at_cursor(page, n=20):
    """Returns the code that follows the cursor.

    Args:
        page (Page): the editor page.
        n (int): how many characters.

    Returns:
        str: up to n characters after the cursor.
    """
    return page.evaluate(f'() => {{ const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionStart + {n}); }}')


def set_cursor_at_body_end(page):
    """Puts the cursor before the last </body> of the code.

    Args:
        page (Page): the editor page.

    Returns:
        None: the code has the focus with the cursor there.
    """
    page.evaluate('() => { const t = document.querySelector("#code"); const i = t.value.lastIndexOf("</body>"); t.focus(); t.setSelectionRange(i, i); }')


def add_empty_line(page):
    """Puts the cursor on an empty line of its own before </body>.

    Args:
        page (Page): the editor page.

    Returns:
        None: the cursor is on the new line.
    """
    set_cursor_at_body_end(page)
    page.keyboard.press('Enter')
    page.keyboard.press('ArrowUp')


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_timeout(800)
    preview = page.frame_locator('#preview')

    # --- First visit: the welcome example ---
    check_that(get_state(page, 'S.name') == 'Welcome', 'the first visit opens the welcome example')
    check_that(get_state(page, 'S.problems.length') == 0, 'the example has no problems')
    check_that(get_preview_value(page, 'd.querySelector("h1").textContent') == 'Welcome to the HTML Editor', 'the preview shows the page')
    check_that(get_preview_value(page, 'getComputedStyle(d.querySelector("h1")).color') == 'rgb(194, 65, 12)', 'the CSS of the page applies in the preview')
    check_that(page.get_attribute('#preview', 'sandbox') == 'allow-same-origin', 'the preview frame is sandboxed without scripts')
    check_that(page.locator('#hl .k').count() > 20 and page.locator('#hl .a').count() > 3, 'tags and attributes are highlighted')
    check_that(page.locator('#hl .c').count() >= 1, 'comments are highlighted')

    # --- Problems ---
    set_code(page, '<!DOCTYPE html>\n<html>\n<head><title>T</title></head>\n<body>\n<div><p>Open <b>bold</div>\n<foo>x</foo>\n<img src="missing.png">\n<p id="a">1</p><p id="a">2</p>\n<section>\n</body>\n</html>\n')
    probs = get_state(page, 'S.problems.map(p => p.kind + ":" + p.msg)')
    check_that(any('<b> is not closed before </div>' in p for p in probs), 'misnested tags are reported')
    check_that(any('<section> is never closed' in p for p in probs), 'an unclosed element is reported')
    check_that(any('Unknown element <foo>' in p for p in probs), 'an unknown element is reported')
    check_that(any('<img> without alt' in p for p in probs), 'a picture without alt is reported')
    check_that(any('"missing.png" is missing' in p for p in probs), 'a missing file is reported')
    check_that(any('The id "a" is used twice' in p for p in probs), 'a duplicate id is reported')
    check_that(page.locator('#code-error li').count() >= 6 and 'Line 7' in page.inner_text('#code-error'), 'problems are listed above the code with their line')
    page.locator('#code-error [data-prob]', has_text='without alt').click()
    check_that(page.evaluate('document.activeElement.id') == 'code' and get_text_at_cursor(page, 4) == '<img', 'clicking a problem goes to the code')

    # --- Code <-> preview ---
    set_code(page, read('../src/js/samples.js').split('code: `')[1].split('`,')[0])
    page.evaluate('() => { const t = document.querySelector("#code"); const i = t.value.indexOf("<table>"); t.focus(); t.setSelectionRange(i + 3, i + 3); t.dispatchEvent(new MouseEvent("click")); }')
    page.wait_for_timeout(100)
    check_that(get_preview_value(page, 'd.querySelector("[data-htmleditor-mark]")?.tagName') == 'TABLE', 'the element at the code cursor is framed in the preview')
    preview.locator('td').first.click(position={'x': 2, 'y': 2})
    page.wait_for_timeout(150)
    check_that(get_text_at_cursor(page, 4) in ('<td>', 'HTML'), 'a click in the preview goes to the code: ' + repr(get_text_at_cursor(page, 4)))
    page.keyboard.press('Escape')
    page.evaluate('() => document.querySelector("#code").blur()')

    # --- Typing help ---
    add_empty_line(page)
    page.keyboard.type('<section>')
    check_that('<section></section>' in get_state(page, 'S.code'), '">" adds the end tag')
    page.keyboard.press('Enter')
    page.keyboard.type('<p>Hi')
    page.keyboard.press('End')
    page.wait_for_timeout(100)
    code = get_state(page, 'S.code')
    check_that('<section>\n  <p>Hi</p>\n</section>' in code, 'Enter between the tags indents the new line: ' + repr(code[code.find('<section>'):code.find('<section>') + 50]))
    page.keyboard.press('Enter')
    page.keyboard.type('<em>x</')
    check_that('<em>x</em>' in get_state(page, 'S.code'), '"</" closes the open element')
    page.keyboard.press('Shift+Home')
    page.keyboard.press('Control+b')
    check_that('<strong>' in get_state(page, 'S.code').split('<section>')[1], 'Ctrl+B makes the selection bold')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(200)

    # --- Tidy ---
    set_code(page, '<!DOCTYPE html>\n<html>\n<head>\n<title>T</title>\n</head>\n<body>\n<ul>\n<li>One\n<li>Two</li>\n</ul>\n<div>\n      <p>Text\n  more</p>\n</div>\n<pre>\n  keep\n</pre>\n</body>\n</html>\n')
    page.click('#btn-format')
    page.wait_for_timeout(200)
    check_that(get_state(page, 'S.code') == '<!DOCTYPE html>\n<html>\n<head>\n  <title>T</title>\n</head>\n<body>\n  <ul>\n    <li>One\n    <li>Two</li>\n  </ul>\n  <div>\n    <p>Text\n      more</p>\n  </div>\n  <pre>\n  keep\n</pre>\n</body>\n</html>\n', 'Tidy indents by depth, keeps <pre>: ' + repr(get_state(page, 'S.code')))
    page.click('#btn-format')
    check_that('tidy already' in page.inner_text('#toast'), 'Tidy a second time changes nothing')

    # --- Document settings edit the head ---
    set_code(page, read('../src/js/samples.js').split('code: `')[1].split('`,')[0])
    show_side_panel(page, True)
    page.fill('#d-title', 'A new title & more')
    page.wait_for_timeout(500)
    check_that('<title>A new title &amp; more</title>' in get_state(page, 'S.code'), 'the title field edits <title>, & as an entity')
    page.evaluate('() => document.activeElement.blur()')
    page.select_option('#d-lang', 'de-CH')
    check_that('<html lang="de-CH">' in get_state(page, 'S.code'), 'language: <html lang>')
    page.fill('#d-desc', 'Say "hello"')
    page.wait_for_timeout(500)
    check_that('<meta name="description" content="Say &quot;hello&quot;">' in get_state(page, 'S.code'), 'the description edits its meta tag, quotes escaped')
    page.evaluate('() => document.activeElement.blur()')
    page.fill('#d-author', 'Ann')
    page.wait_for_timeout(500)
    check_that('<meta name="author" content="Ann">' in get_state(page, 'S.code'), 'the author is a new meta tag in the head')
    page.evaluate('() => document.activeElement.blur()')
    page.wait_for_timeout(100)
    page.click('#d-viewport')
    check_that('name="viewport"' not in get_state(page, 'S.code'), 'unticking "Fits phone screens" removes the viewport meta')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(200)
    check_that('name="viewport"' in get_state(page, 'S.code'), 'Undo brings it back')

    # --- Insert ---
    page.click('[data-itab=insert]')
    set_cursor_at_body_end(page)
    page.click('[data-ins=table]')
    check_that('<table>\n' in get_state(page, 'S.code').split('Safe preview')[1], 'Insert > Table')
    page.click('[data-sym="&copy;"]')
    check_that('&copy;' in get_state(page, 'S.code'), 'Insert > a special character as its entity')
    page.click('[data-ins=og]')
    code = get_state(page, 'S.code')
    check_that(code.index('og:title') < code.index('</head>'), 'head pieces go into the head')
    page.click('[data-itab=properties]')

    # --- Outline ---
    page.click('[data-itab=structure]')
    check_that(page.locator('#tree li').count() == 3 and 'Lists and tables' in page.inner_text('#tree'), 'Outline lists the headings')
    page.locator('#tree button', has_text='Safe preview').click()
    check_that(get_text_at_cursor(page, 4) == '<h2>', 'a heading in the outline goes to its place in the code: ' + repr(get_text_at_cursor(page, 30)))
    page.click('[data-itab=properties]')

    # --- My documents, templates ---
    page.click('#btn-new')
    page.click('[data-new=landing]')
    check_that(get_state(page, 'S.name') == 'Landing page' and get_preview_value(page, 'd.querySelector("header h1").textContent') == 'My Product', 'New > Landing page')
    page.click('#btn-files')
    check_that(page.locator('#files-grid .file-card').count() >= 2 and 'My Product' in page.inner_text('#files-grid'), 'My documents lists the documents with their title')
    page.locator('#files-grid .file-card:not(.current) .file-open').first.click()
    check_that(get_state(page, 'S.name') == 'Welcome', 'a document opens from My documents')

    # --- Files of the document ---
    page.set_input_files('#file', os.path.join(HERE, 'title-picture.jpg'))
    page.wait_for_timeout(700)
    check_that('title-picture.jpg' in get_state(page, 'Object.keys(S.assets)'), 'a picture is stored with the document')
    check_that('<img src="title-picture.jpg" alt="">' in get_state(page, 'S.code'), 'and inserted as <img>')
    check_that(get_preview_value(page, '(() => { const i = d.querySelector("img"); return i && i.src.startsWith("blob:") && i.complete && i.naturalWidth > 0; })()'), 'the preview shows it from the file (blob:), the code keeps its name')
    page.set_input_files('#file', os.path.join(HERE, 'style.css'))
    page.wait_for_timeout(700)
    code = get_state(page, 'S.code')
    check_that('<link rel="stylesheet" href="style.css">' in code and code.index('style.css') < code.index('</head>'), 'a stylesheet file is linked in the head')
    check_that(get_preview_value(page, 'getComputedStyle(d.querySelector("h1")).color') == 'rgb(200, 30, 30)', 'the stylesheet file applies in the preview')
    page.evaluate("() => htmlEditor.setCode(htmlEditor.state.code.replace('</body>', '<div class=\"cover\"></div>\\n<img src=\"img/logo.png\" alt=\"Logo\">\\n</body>'))")
    page.wait_for_timeout(500)
    check_that(get_preview_value(page, 'getComputedStyle(d.querySelector(".cover")).backgroundImage.startsWith("url(\\"blob:")'), 'url() in a stylesheet file finds the other files')

    page.click('[data-itab=pictures]')
    check_that(page.locator('#pics-wrap .picture-card').count() == 2 and 'used 1×' in page.inner_text('#pics-wrap'), 'Files tab: the files with where they are used')
    check_that('img/logo.png' in page.inner_text('#pics-wrap .missing-pictures'), 'Files tab: a file the code asks for but is missing')
    page.click('[data-pic-ren="title-picture.jpg"]')
    page.fill('.picture-rename', 'cover')
    page.keyboard.press('Enter')
    page.wait_for_timeout(500)
    code = get_state(page, 'S.code')
    check_that('cover.jpg' in get_state(page, 'Object.keys(S.assets)') and '<img src="cover.jpg"' in code and 'title-picture' not in code, 'Rename changes the file and the code')
    with page.expect_file_chooser() as fc:
        page.click('[data-pic-fill="img/logo.png"]')
    fc.value.set_files(os.path.join(HERE, 'title-picture.jpg'))
    page.wait_for_timeout(700)
    check_that('img/logo.png' in get_state(page, 'Object.keys(S.assets)') and page.locator('#pics-wrap .missing-pictures').count() == 0, '"Add file…" fills a missing file under its name')
    page.click('[data-pic-del="img/logo.png"]')
    page.click('#ask-ok')
    page.wait_for_timeout(300)
    check_that('img/logo.png' not in get_state(page, 'Object.keys(S.assets)'), 'Remove takes the file away')
    page.click('[data-itab=properties]')

    # --- Export ---
    page.click('#btn-export')
    page.select_option('#ex-format', 'single')
    with page.expect_download() as d:
        page.click('#ex-download')
    with open(d.value.path(), encoding='utf-8') as f:
        single = f.read()
    check_that('src="data:image/jpeg;base64,' in single and 'href="data:text/css;base64,' in single and 'cover.jpg' not in single, 'export: one HTML file with its files inside')
    page.select_option('#ex-format', 'zip')
    with page.expect_download() as d:
        page.click('#ex-download')
    with zipfile.ZipFile(d.value.path()) as z:
        names = z.namelist()
    check_that('Welcome.html' in names and 'cover.jpg' in names and 'style.css' in names, 'export: ZIP with the .html and its files: ' + str(names))
    page.select_option('#ex-format', 'txt')
    check_that('Welcome to the HTML Editor' in page.input_value('#ex-text') and '<h1>' not in page.input_value('#ex-text'), 'export: plain text')
    page.select_option('#ex-format', 'html')
    with page.expect_download() as d:
        page.click('#ex-download')
    check_that(d.value.suggested_filename == 'Welcome.html', 'export: .html')
    page.keyboard.press('Escape')

    # --- A ZIP opens as one document with its files ---
    with zipfile.ZipFile(os.path.join(tempfile.mkdtemp(), 'site.zip'), 'w') as z:
        z.writestr('site/index.html', read('page.html'))
        z.write(os.path.join(HERE, 'style.css'), 'site/css/style.css')
        z.write(os.path.join(HERE, 'title-picture.jpg'), 'site/img/title-picture.jpg')
    page.set_input_files('#file', z.filename)
    page.wait_for_timeout(1000)
    check_that(get_state(page, 'Object.keys(S.assets).sort().join()') == 'style.css,title-picture.jpg' and get_state(page, 'S.problems.length') == 0, 'a ZIP opens with its files; "css/style.css" finds style.css')
    check_that(get_preview_value(page, 'getComputedStyle(d.querySelector("h1")).color') == 'rgb(200, 30, 30)', 'and the stylesheet from the ZIP applies')
    os.remove(z.filename)

    # --- AI link to a new document, and a pasted terminal answer ---
    html = '<!DOCTYPE html><html><head><title>AI</title></head><body><h1>From the AI</h1>\n</body></html>'
    z = base64.urlsafe_b64encode(zlib.compress(html.encode())).decode().rstrip('=')
    page.goto(URL + '#z=' + z + '&file=new&name=AI%20page', wait_until='networkidle')
    page.wait_for_timeout(800)
    check_that(get_state(page, 'S.name') == 'AI page' and get_preview_value(page, 'd.querySelector("h1").textContent') == 'From the AI', 'an AI link makes a new document')
    link = 'https://html.giit.ch/#b64=' + base64.urlsafe_b64encode('<p>Pasted</p>'.encode()).decode() + '&mode=add'
    answer = 'Here is the link:\n' + link[:40] + '\n' + link[40:] + '\nClick it.'
    page.click('#btn-ai')
    page.fill('#ai-paste', answer)
    page.wait_for_timeout(400)
    check_that(not page.locator('#ask').is_visible(), 'a link changes the document without a question')
    page.wait_for_timeout(400)
    check_that('<p>Pasted</p>\n</body>' in get_state(page, 'S.code'), 'a link broken over lines can be pasted; mode=add goes before </body>')
    page.goto(URL + '#html=' + '%3Cp%3EFrom%20html%3D%3C%2Fp%3E' + '&file=new&name=Plain', wait_until='networkidle')
    page.wait_for_timeout(800)
    check_that(get_state(page, 'S.name') == 'Plain' and 'From html=' in get_state(page, 'S.code'), '#html= carries URL-encoded HTML')

    # --- WebMCP tools (a stand-in for document.modelContext) ---
    agent = ctx.new_page()
    agent.on('pageerror', lambda e: errors.append(str(e)))
    agent.add_init_script('window.tools = []; document.modelContext = { registerTool(t) { window.tools.push(t); } };')
    agent.goto(URL, wait_until='networkidle')
    agent.wait_for_timeout(800)
    names = agent.evaluate('tools.map(t => t.name).sort().join()')
    check_that(names == 'get_document,get_problems,insert_text,list_elements,list_files,new_file,open_file,replace_text,set_document,show_line,undo', 'WebMCP: the tools of the HTML editor: ' + names)

    def run_agent_tool(name, args={}):
        """Runs a WebMCP tool the editor registered, as an agent would.

        Args:
            name (str): the tool's name.
            args (dict): the tool's input.

        Returns:
            Any: the tool's answer.
        """
        return agent.evaluate('([n, a]) => tools.find(t => t.name === n).execute(a)', [name, args])

    run_agent_tool('new_file', {'name': 'Agent page'})
    run_agent_tool('set_document', {'html': '<!DOCTYPE html>\n<html>\n<head><title>A</title></head>\n<body>\n<h2 id="news">News</h2>\n<p>Old</p>\n</body>\n</html>\n'})
    check_that('<h2#news> line 5: News' in run_agent_tool('list_elements', {'tag': 'h2'}), 'WebMCP: list_elements names tag, id, line and text')
    run_agent_tool('insert_text', {'html': '<p>Fresh</p>', 'where': 'news'})
    check_that('<h2 id="news">News</h2>\n<p>Fresh</p>\n<p>Old</p>' in agent.evaluate('htmlEditor.state.code'), 'WebMCP: insert_text after a heading (by its id)')
    run_agent_tool('replace_text', {'find': 'Old', 'replace': 'New & shiny'})
    check_that('No problems' in run_agent_tool('get_problems') and 'Agent page' in run_agent_tool('list_files'), 'WebMCP: get_problems, list_files')
    run_agent_tool('undo')
    check_that('<p>Old</p>' in agent.evaluate('htmlEditor.state.code'), 'WebMCP: undo takes the last change back')
    agent.close()

    # --- Phone ---
    page.set_viewport_size({'width': 390, 'height': 800})
    page.wait_for_timeout(300)
    check_that(page.locator('.views').is_visible(), 'phone: Code / Preview / Document tabs')
    check_that(page.evaluate('document.documentElement.scrollWidth') <= 391, 'phone: no sideways scrolling')
    page.click('[data-pane=code]')
    check_that(page.locator('#code').is_visible(), 'phone: the code view')

    check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
    browser.close()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
