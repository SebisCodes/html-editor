"""Editing text and moving pictures in the preview.

    php -S 127.0.0.1:8095 -t src src/php/router.php          (in the project folder)
    python tests/inplace_test.py

A click on text in the preview makes it editable with the code cursor on the
same character; Enter or a click elsewhere writes the change into the code as
one undo step, with &, < and > written as entities; Escape cancels; entities
that are already in the code stay as they are.

A picture dragged in the preview moves its code (the <figure>, or the <img>
with what holds only it) before or after the block where it is dropped, as
one undo step; a click without moving still leads to the code, Escape
cancels, the preview scrolls at its edge, and a preview that is not current
refuses the move."""

import os
import sys

from playwright.sync_api import sync_playwright

URL = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8095/')
failures = []

CODE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Edit me</title>
  <style>p { font-size: 18px; }</style>
</head>
<body>
  <h2 id="top">Opening hours <em>this week</em> only</h2>
  <p>Tom and Jerry
    meet at noon.</p>
  <p>Caf&eacute; &amp; bar &copy; 2026</p>
  <ul>
    <li>First item
    <li>Second item
  </ul>
  <p><a href="https://example.com/">Link text</a> after the link.</p>
  <pre>
Code line</pre>
  <script>document.title = 'not run';</script>
</body>
</html>
"""


PIC = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22red%22/%3E%3C/svg%3E'
PICS = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Pictures</title>
  <style>body { margin: 0; padding: 8px; } p { margin: 0 0 14px; font-size: 18px; } .long { height: 1400px; }</style>
</head>
<body>
  <h2>Pictures</h2>
  <p>First paragraph.</p>
  <p><img id="red" src="PIC" alt="Red" width="120" height="80"></p>
  <p>Second paragraph.</p>
  <figure>
    <img id="blue" src="PIC" alt="Blue" width="100" height="60">
    <figcaption>A caption</figcaption>
  </figure>
  <p>Third paragraph.</p>
  <div class="long">A long block</div>
  <p>Last paragraph.</p>
</body>
</html>
""".replace('PIC', PIC)
RED = '  <p><img id="red" src="' + PIC + '" alt="Red" width="120" height="80"></p>\n'
GALLERY = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Gallery</title>
  <style>body { margin: 0; padding: 8px; } td { padding: 4px; }</style>
</head>
<body>
  <h2>Gallery</h2>
  <p>
    <img id="t" src="PIC" alt="Title" width="200" height="120">
    <img id="b1" src="PIC" alt="One" width="90" height="60">
    <img id="b3" src="PIC" alt="Three" width="90" height="60">
    <img id="b2" src="PIC" alt="Two" width="90" height="60">
  </p>
  <table>
    <tr>
      <td><img id="c1" src="PIC" alt="C1" width="90" height="60"></td>
      <td><img id="c2" src="PIC" alt="C2" width="90" height="60"></td>
      <td><img id="c3" src="PIC" alt="C3" width="90" height="60"></td>
    </tr>
  </table>
  <p>After the table.</p>
</body>
</html>
""".replace('PIC', PIC)


def format_picture(name):
    """Returns the <img> tag of one of the test pictures.

    Args:
        name (str): the picture's id ("t", "b1", "b2", "b3" or another).

    Returns:
        str: the tag with its id, source, alt text and size.
    """
    return '<img id="' + name + '" src="' + PIC + '" alt="' + {'t': 'Title', 'b1': 'One', 'b2': 'Two', 'b3': 'Three'}.get(name, name.upper()) + '" width="' + ('200' if name == 't' else '90') + '" height="' + ('120' if name == 't' else '60') + '">'


FIGURE = '  <figure>\n    <img id="blue" src="' + PIC + '" alt="Blue" width="100" height="60">\n    <figcaption>A caption</figcaption>\n  </figure>\n'


def get_preview_point(page, sel, fy=0.5, fx=0.5):
    """Returns a point of an element of the preview in the page's coordinates.

    Args:
        page (Page): the editor page.
        sel (str): the element's selector in the preview.
        fy (float): the share of its height from its top.
        fx (float): the share of its width from its left.

    Returns:
        list[float]: x and y in the page.
    """
    return page.evaluate('''([s, fy, fx]) => {
        const b = htmlEditor.preview().querySelector(s).getBoundingClientRect(), f = document.getElementById('preview').getBoundingClientRect();
        return [f.left + b.left + b.width * fx, f.top + b.top + b.height * fy];
    }''', [sel, fy, fx])


def move_picture(page, frm, to, release=True):
    """Drags a picture of the preview with the mouse.

    Args:
        page (Page): the editor page.
        frm (str): the selector of the picture.
        to (tuple): the target as (selector, fy[, fx]), see get_preview_point().
        release (bool): False to keep the mouse button down at the target.

    Returns:
        None: the picture is dragged (and dropped when released).
    """
    x, y = get_preview_point(page, frm)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 3, y + 3, steps=2)
    tx, ty = get_preview_point(page, *to)
    page.mouse.move(tx, ty, steps=8)
    if release:
        page.mouse.up()
        page.wait_for_timeout(300)


def get_selected_code(page):
    """Returns the selected code.

    Args:
        page (Page): the editor page.

    Returns:
        str: the code between the selection's start and end.
    """
    return page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionEnd); }')


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


def get_code(page):
    """Returns the editor's code.

    Args:
        page (Page): the editor page.

    Returns:
        str: the code.
    """
    return page.evaluate('htmlEditor.state.code')


def select_preview_text(page, needle, at=None):
    """Clicks into the preview's text that contains needle.

    Args:
        page (Page): the editor page.
        needle (str): a part of the text.
        at (int | None): the character of needle to click before; None for its middle.

    Returns:
        None: the click is made.
    """
    xy = page.evaluate('''([n, at]) => {
        const d = htmlEditor.preview(), w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = w.nextNode())) if (t.data.includes(n)) break;
        const i = t.data.indexOf(n) + (at == null ? Math.floor(n.length / 2) : at);
        const r = d.createRange(); r.setStart(t, i); r.setEnd(t, i + 1);
        const b = r.getBoundingClientRect(), f = document.getElementById('preview').getBoundingClientRect();
        return [f.left + b.left + 1, f.top + b.top + b.height / 2];
    }''', [needle, at])
    page.mouse.click(xy[0], xy[1])
    page.wait_for_timeout(150)


def get_edited_text(page):
    """Returns the text being edited in the preview.

    Args:
        page (Page): the editor page.

    Returns:
        str | None: the edited text, None when no text is being edited.
    """
    return page.evaluate('() => { const a = htmlEditor.preview().activeElement; return a && a.hasAttribute("data-htmleditor-edit") ? a.textContent : null; }')


def get_text_before_cursor(page, n=12):
    """Returns the code before the cursor.

    Args:
        page (Page): the editor page.
        n (int): how many characters.

    Returns:
        str: up to n characters before the cursor.
    """
    return page.evaluate(f'() => {{ const t = document.querySelector("#code"); return t.value.slice(t.selectionStart - {n}, t.selectionStart); }}')


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_timeout(600)
    page.evaluate('t => htmlEditor.setCode(t)', CODE)
    page.wait_for_timeout(400)

    # A click makes the text editable, with the code cursor on the same character
    select_preview_text(page, 'Tom and Jerry', 4)
    check_that(get_edited_text(page) == 'Tom and Jerry meet at noon.', 'a click makes the text editable, a line break shown as the space it is')
    left = get_text_before_cursor(page)
    check_that(left.endswith('<p>Tom ') or left.endswith('<p>Tom'), 'the code cursor goes to the clicked character: ' + repr(left))
    page.keyboard.press('End')
    page.keyboard.type(' Bring <cake> & "tea"!')
    hist = page.evaluate('htmlEditor.state.history.length')
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    c = get_code(page)
    check_that('meet at noon. Bring &lt;cake&gt; &amp; "tea"!</p>' in c, 'Ctrl+Enter writes the text into the code, & < > as entities: ' + repr(c.split('<p>Tom')[1][:80]))
    check_that(page.evaluate('htmlEditor.preview().querySelectorAll("p")[0].textContent').endswith('Bring <cake> & "tea"!'), 'the preview shows the edited text')
    check_that(page.evaluate('htmlEditor.state.history.length') == hist + 1, 'the edit is one undo step')
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)
    check_that(get_code(page) == CODE, 'Undo takes the edit back')

    # Entities already in the code stay, the new text goes in between
    select_preview_text(page, 'bar', 3)
    check_that(get_edited_text(page) == 'Café & bar © 2026', 'text with entities is editable')
    page.keyboard.press('End')
    page.keyboard.press('ArrowLeft')
    page.keyboard.press('ArrowLeft')
    page.keyboard.press('ArrowLeft')
    page.keyboard.press('ArrowLeft')
    page.keyboard.type('-')
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    check_that('<p>Caf&eacute; &amp; bar &copy; -2026</p>' in get_code(page), 'entities that were there stay as they are: ' + repr(get_code(page).split('<p>Caf')[1][:40]))

    # An emoji written as an entity (two UTF-16 units) stays, the edit after it lands right
    saved = get_code(page)
    page.evaluate('t => htmlEditor.setCode(t)', '<!DOCTYPE html>\n<html>\n<body>\n<p>&#128512;X</p>\n</body>\n</html>\n')
    page.wait_for_timeout(400)
    select_preview_text(page, 'X', 0)
    page.keyboard.press('End')
    page.keyboard.press('Backspace')
    page.keyboard.type('Y')
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    check_that('<p>&#128512;Y</p>' in get_code(page) and get_code(page).count('<p>') == 1, 'an edit after an emoji entity changes only that text: ' + repr(get_code(page)[40:80]))
    page.evaluate('t => htmlEditor.setCode(t)', saved)
    page.wait_for_timeout(400)

    # Escape cancels
    select_preview_text(page, 'Opening hours')
    page.keyboard.press('Control+a')
    page.keyboard.type('Changed')
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    check_that('<h2 id="top">Opening hours <em>this week</em> only</h2>' in get_code(page) and get_edited_text(page) is None, 'Escape cancels the edit')

    # Text between markup: each part on its own; a click elsewhere keeps the edit
    select_preview_text(page, 'only')
    check_that(get_edited_text(page) == 'only', 'the text after an element is a part of its own (white space at its edges stays outside)')
    page.keyboard.press('End')
    page.keyboard.type(' today')
    select_preview_text(page, 'this week')
    page.wait_for_timeout(300)
    check_that('</em> only today</h2>' in get_code(page), 'a click elsewhere keeps the edit')
    check_that(get_edited_text(page) == 'this week', 'and the clicked text is edited next')
    page.keyboard.press('Home')
    page.keyboard.type('all of ')
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    check_that('<em>all of this week</em>' in get_code(page), 'text inside an inline element')

    # A list item without its end tag, a link's text, the text after a leading newline in <pre>
    select_preview_text(page, 'Second item')
    page.keyboard.press('End')
    page.keyboard.type('!')
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    check_that('<li>Second item!\n' in get_code(page), 'a list item without </li>: ' + repr(get_code(page).split('<li>Second')[1][:30]))
    select_preview_text(page, 'Link text')
    page.keyboard.press('End')
    page.keyboard.type(' here')
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    check_that('>Link text here</a>' in get_code(page) and page.evaluate('htmlEditor.preview().URL').endswith('preview.html?v=1'), 'link text is editable and the link does not navigate')
    select_preview_text(page, 'Code line')
    page.keyboard.press('End')
    page.keyboard.type('s')
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    check_that('<pre>\nCode lines</pre>' in get_code(page), 'text in <pre> after its leading line break')

    # The code changed meanwhile: the edit is not used
    select_preview_text(page, 'after the link')
    page.keyboard.type('X')
    page.evaluate("() => { const S = htmlEditor.state; S.code = S.code.replace('after the link', 'after that link'); }")
    page.keyboard.press('Control+Enter')
    page.wait_for_timeout(300)
    check_that('the edit was not used' in page.inner_text('#toast') and 'X' not in get_code(page).split('</a>')[1][:30], 'an edit of text that changed in the code meanwhile is not used')

    # Not editable: generated or not shown text; nothing in the page runs
    check_that(page.evaluate('htmlEditor.preview().title') == 'Edit me', 'the page\'s script did not run in the preview')

    # Moving pictures: below the next paragraph, with the <p> that holds only the picture
    page.evaluate('t => htmlEditor.setCode(t)', PICS)
    page.wait_for_timeout(400)
    check_that(page.evaluate('getComputedStyle(htmlEditor.preview().getElementById("red")).cursor') == 'grab', 'a picture shows the grab cursor')
    hist = page.evaluate('htmlEditor.state.history.length')
    move_picture(page, '#red', ('p:nth-of-type(3)', 0.8), release=False)
    check_that(page.evaluate('!document.querySelector(".picture-target").hidden'), 'while dragging a line shows where the picture lands')
    page.mouse.up()
    page.wait_for_timeout(300)
    c = get_code(page)
    check_that('  <p>Second paragraph.</p>\n' + RED + '  <figure>' in c and c.count('id="red"') == 1, 'a picture dragged below the next paragraph moves there')
    check_that(page.evaluate('htmlEditor.state.history.length') == hist + 1, 'the move is one undo step')
    check_that(get_selected_code(page) == RED.strip(), 'the code shows the moved code: ' + repr(get_selected_code(page)[:40]))
    check_that(page.evaluate('!!htmlEditor.preview().querySelector("p:nth-of-type(3) #red")'), 'the preview shows the picture at its new place')
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)
    check_that(get_code(page) == PICS, 'Undo puts it back in one step')

    # A figure moves as a whole, also upwards; dropped where it is, nothing changes
    move_picture(page, '#blue', ('p:nth-of-type(1)', 0.2))
    c = get_code(page)
    check_that('<h2>Pictures</h2>\n' + FIGURE + '  <p>First paragraph.</p>' in c and c.count('<figure>') == 1, 'a figure moves with its caption, before the paragraph above it')
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)
    hist = page.evaluate('htmlEditor.state.history.length')
    move_picture(page, '#blue', ('p:nth-of-type(3)', 0.9))
    check_that(get_code(page) == PICS and page.evaluate('htmlEditor.state.history.length') == hist, 'dropped at its own place nothing changes')

    # A click without moving still leads to the code
    page.evaluate('() => document.querySelector("#code").setSelectionRange(0, 0)')
    x, y = get_preview_point(page, '#blue')
    page.mouse.click(x, y)
    page.wait_for_timeout(200)
    check_that(get_code(page) == PICS and page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart).startsWith("<img id=\\"blue\\""); }'), 'a click on a picture still puts the code cursor on it')

    # Escape cancels
    move_picture(page, '#blue', ('p:nth-of-type(4)', 0.8), release=False)
    page.keyboard.press('Escape')
    check_that(page.evaluate('document.querySelector(".picture-target").hidden'), 'Escape hides the line')
    page.mouse.up()
    page.wait_for_timeout(300)
    check_that(get_code(page) == PICS and page.evaluate('!htmlEditor.preview().querySelector("[data-htmleditor-moving]")'), 'Escape cancels the move')

    # At the bottom edge the preview scrolls; the figure lands after the last paragraph
    move_picture(page, '#blue', ('p:nth-of-type(4)', 0.5), release=False)
    fb = page.evaluate('document.getElementById("preview").getBoundingClientRect().bottom')
    page.mouse.move(x, fb - 6, steps=4)
    page.wait_for_timeout(2500)
    check_that(page.evaluate('htmlEditor.preview().scrollingElement.scrollTop') > 600, 'dragging at the bottom edge scrolls the preview')
    tx, ty = get_preview_point(page, 'p:nth-of-type(5)', 0.8)
    page.mouse.move(tx, ty, steps=3)
    page.mouse.up()
    page.wait_for_timeout(300)
    check_that('  <p>Last paragraph.</p>\n' + FIGURE + '</body>' in get_code(page), 'the figure moves to the end of the page')
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)
    page.evaluate('htmlEditor.preview().scrollingElement.scrollTop = 0')
    page.wait_for_timeout(100)

    # The preview is not current: the move is refused
    page.evaluate('() => { const t = document.querySelector("#code"); t.value += "<!-- x -->"; t.dispatchEvent(new Event("input")); }')
    move_picture(page, '#red', ('p:nth-of-type(3)', 0.8))
    check_that('the picture was not moved' in page.inner_text('#toast') and get_code(page) == PICS + '<!-- x -->', 'a move in a preview that is not current is refused')
    check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))

    # Pictures beside each other: one paragraph of pictures, and pictures alone in table cells
    page.evaluate('htmlEditor.preview().scrollingElement.scrollTop = 0')
    page.evaluate('t => htmlEditor.setCode(t)', GALLERY)
    page.wait_for_timeout(400)
    hist = page.evaluate('htmlEditor.state.history.length')
    move_picture(page, '#b2', ('#b1', 0.5, 0.2), release=False)
    check_that(page.evaluate('() => { const l = document.querySelector(".picture-target"); return !l.hidden && l.offsetHeight > l.offsetWidth; }'), 'over another picture an upright line shows at its side')
    page.mouse.up()
    page.wait_for_timeout(300)

    def get_block_order():
        """Returns the ids of the title and the three pictures in the order of the code.

        Returns:
            list[str]: the ids.
        """
        return sorted(('t', 'b1', 'b2', 'b3'), key=lambda n: get_code(page).index('id="' + n + '"'))

    check_that(get_block_order() == ['t', 'b2', 'b1', 'b3'] and '    ' + format_picture('b2') + '\n    ' + format_picture('b1') + '\n' in get_code(page), 'a picture dropped on the left half of another goes before it, on its own line: ' + repr(get_block_order()))
    check_that(page.evaluate('htmlEditor.state.history.length') == hist + 1 and get_selected_code(page) == format_picture('b2'), 'one undo step, the moved code selected')
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)
    check_that(get_code(page) == GALLERY, 'Undo puts it back')
    move_picture(page, '#t', ('#b3', 0.5, 0.8))
    check_that(get_block_order() == ['b1', 'b3', 't', 'b2'], 'a picture dropped on the right half of another goes after it: ' + repr(get_block_order()))
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)

    def get_row_cells():
        """Returns the lines of the table's first row.

        Returns:
            list[str]: the cells' code, one line each.
        """
        return [c.strip() for c in get_code(page).split('<tr>')[1].split('</tr>')[0].strip().split('\n')]

    move_picture(page, '#c1', ('#c3', 0.5, 0.5), release=False)
    check_that(page.evaluate('htmlEditor.preview().querySelector("[data-htmleditor-swap]")?.id === "c3" && document.querySelector(".picture-target").hidden'), 'over the middle of a picture alone in its cell an outline shows')
    page.mouse.up()
    page.wait_for_timeout(300)
    check_that(get_row_cells() == ['<td>' + format_picture('c3') + '</td>', '<td>' + format_picture('c2') + '</td>', '<td>' + format_picture('c1') + '</td>'], 'dropped on the middle the two cells change pictures, the cells stay: ' + repr(get_row_cells()).replace(PIC, '…'))
    check_that(page.evaluate('!htmlEditor.preview().querySelector("[data-htmleditor-swap]")'), 'the outline is gone')
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)
    check_that(get_code(page) == GALLERY, 'Undo changes them back in one step')
    move_picture(page, '#c1', ('#c3', 0.5, 0.1))
    check_that(get_row_cells() == ['<td></td>', '<td>' + format_picture('c2') + '</td>', '<td>' + format_picture('c1') + ' ' + format_picture('c3') + '</td>'], 'dropped on the edge it goes beside the picture, its cell stays: ' + repr(get_row_cells()).replace(PIC, '…'))
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)
    move_picture(page, '#c2', ('p:last-of-type', 0.8))
    check_that('  <p>After the table.</p>\n  ' + format_picture('c2') + '\n</body>' in get_code(page) and '<td></td>' in get_code(page), 'a picture from a cell goes between blocks as before')
    page.evaluate('htmlEditor.undo()')
    page.wait_for_timeout(300)
    check_that(get_code(page) == GALLERY, 'and Undo brings it back')
    check_that(not errors, 'no script errors with pictures beside each other' + (': ' + '; '.join(errors) if errors else ''))

    # With a finger: a swipe on a picture scrolls, a long press moves it, a tap is a click
    tctx = browser.new_context(viewport={'width': 1440, 'height': 900}, has_touch=True, is_mobile=True)
    tp = tctx.new_page()
    tp.on('pageerror', lambda e: errors.append(str(e)))
    tp.goto(URL, wait_until='networkidle')
    tp.wait_for_timeout(600)
    tp.evaluate('t => htmlEditor.setCode(t)', PICS)
    tp.wait_for_timeout(400)
    cdp = tctx.new_cdp_session(tp)

    def send_touch(kind, x=None, y=None):
        """Sends one touch event through the DevTools protocol.

        Args:
            kind (str): "touchStart", "touchMove" or "touchEnd".
            x (float | None): the point's x in the page.
            y (float | None): the point's y in the page.

        Returns:
            None: the event is sent.
        """
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y}]})

    x, y = get_preview_point(tp, '#red')
    send_touch('touchStart', x, y)
    for i in range(1, 11):
        send_touch('touchMove', x, y - i * 30)
        tp.wait_for_timeout(16)
    send_touch('touchEnd')
    tp.wait_for_timeout(600)
    check_that(tp.evaluate('htmlEditor.preview().scrollingElement.scrollTop') > 50 and get_code(tp) == PICS and tp.evaluate('document.querySelector(".picture-target").hidden'), 'a swipe that starts on a picture scrolls the preview and moves nothing')
    tp.evaluate('htmlEditor.preview().scrollingElement.scrollTop = 0')
    tp.wait_for_timeout(200)

    x, y = get_preview_point(tp, '#red')
    send_touch('touchStart', x, y)
    tp.wait_for_timeout(600)
    check_that(tp.evaluate('!document.querySelector(".picture-target").hidden && !!htmlEditor.preview().querySelector("[data-htmleditor-moving]")'), 'a long press picks the picture up')
    tx, ty = get_preview_point(tp, 'p:nth-of-type(3)', 0.8)
    for i in range(1, 9):
        send_touch('touchMove', x + (tx - x) * i / 8, y + (ty - y) * i / 8)
        tp.wait_for_timeout(16)
    top = tp.evaluate('htmlEditor.preview().scrollingElement.scrollTop')
    send_touch('touchEnd')
    tp.wait_for_timeout(400)
    check_that(top == 0 and '  <p>Second paragraph.</p>\n' + RED + '  <figure>' in get_code(tp), 'then the finger moves it as the mouse does, without scrolling the page')
    tp.evaluate('htmlEditor.undo()')
    tp.wait_for_timeout(300)

    tp.evaluate('() => document.querySelector("#code").setSelectionRange(0, 0)')
    x, y = get_preview_point(tp, '#blue')
    send_touch('touchStart', x, y)
    tp.wait_for_timeout(60)
    send_touch('touchEnd')
    tp.wait_for_timeout(400)
    check_that(get_code(tp) == PICS and tp.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart).startsWith("<img id=\\"blue\\""); }'), 'a tap on a picture still puts the code cursor on it')
    check_that(not errors, 'no script errors with a finger' + (': ' + '; '.join(errors) if errors else ''))
    tctx.close()
    browser.close()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
