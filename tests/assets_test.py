"""Files of the page's document, and the keys inside a page.

    php -S 127.0.0.1:8095 -t src src/php/router.php          (in the project folder)
    python tests/assets_test.py

A host page embeds the editor with ?embed=1&save=0 and loads a document
with a picture and a PDF. Checks: save carries all files (with
assetsChanged / assetsRemoved), a new, replaced or removed picture is a
change, a load with assets replaces the files, the PDF stays untouched,
Ctrl+S works from anywhere, F5 / Ctrl+R go to the page instead of
reloading, and there is no Save button."""

import base64
import os
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8095/')
HERE = os.path.dirname(os.path.abspath(__file__))
PDF = 'data:application/pdf;base64,' + base64.b64encode(b'%PDF-1.4\n% plan\n').decode()
TEX = '<!DOCTYPE html>\n<html>\n<head><title>Dossier</title></head>\n<body>\n<p>Plan: <a href="plan.pdf">plan.pdf</a></p>\n<img src="title-picture.jpg" alt="The lake">\n</body>\n</html>\n'
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


HOST = """<!doctype html><meta charset="utf-8"><title>host</title>
<iframe id="f" src="EDITOR?embed=1&save=0" style="width:1300px;height:820px;border:0"></iframe>
<script>
const P = 'htmleditor', ORIGIN = new URL('EDITOR').origin, frame = document.getElementById('f');
window.log = [];
window.send = m => frame.contentWindow.postMessage(m, ORIGIN);
addEventListener('message', async e => {
  if (e.source !== frame.contentWindow) return;
  log.push(e.data);
  if (e.data.type === P + ':ready') {
    const b = await (await fetch('title-picture.jpg')).blob();
    window.jpg = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    send({ type: P + ':load', name: 'Dossier 17', content: TEX, assets: { 'title-picture.jpg': jpg, 'plan.pdf': 'PDFURI', 'alt.jpg': jpg } });
  }
});
</script>"""

with tempfile.TemporaryDirectory() as d:
    import json
    with open(os.path.join(d, 'host.html'), 'w') as f:
        f.write(HOST.replace('EDITOR', EDITOR).replace('TEX', json.dumps(TEX)).replace('PDFURI', PDF))
    with open(os.path.join(HERE, 'title-picture.jpg'), 'rb') as a, open(os.path.join(d, 'title-picture.jpg'), 'wb') as b:
        b.write(a.read())
    server = subprocess.Popen(['php', '-S', '127.0.0.1:8296', '-t', d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            page = browser.new_page(viewport={'width': 1360, 'height': 860})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:8296/host.html', wait_until='load')
            page.wait_for_timeout(2500)
            frame = next(fr for fr in page.frames if fr.url.startswith(EDITOR))

            def get_log():
                """Returns the messages the page got from the editor.

                Returns:
                    list[dict]: the messages in order.
                """
                return page.evaluate('log')

            def get_last_message(t):
                """Returns the last message of a type the page got from the editor.

                Args:
                    t (str): the type without the prefix ("save", "change" …).

                Returns:
                    dict | None: the message, None when there is none.
                """
                return next((m for m in reversed(get_log()) if m['type'] == 'htmleditor:' + t), None)

            check_that(not frame.locator('#btn-save').is_visible(), '?save=0: no Save button')
            frame.click('#btn-panel')
            frame.click('[data-itab=pictures]')
            check_that(frame.locator('#pics-wrap .picture-card').count() == 3 and 'PDF' in frame.inner_text('#pics-wrap') and 'used 1×' in frame.inner_text('#pics-wrap [data-name="plan.pdf"]'), 'a PDF file is kept and listed with where it is used')
            frame.click('[data-itab=properties]')
            frame.click('#btn-panel')

            # Ctrl+S from the preview (not the code) still saves to the page
            frame.click('#stage', position={'x': 400, 'y': 600})
            page.keyboard.press('Control+s')
            page.wait_for_timeout(400)
            s = get_last_message('save')
            check_that(s is not None and set(s['assets']) == {'title-picture.jpg', 'plan.pdf', 'alt.jpg'} and s['assets']['plan.pdf'] == PDF, 'Ctrl+S in the preview: save carries all files, the PDF untouched')
            check_that(s['assetsChanged'] == [] and s['assetsRemoved'] == [], 'nothing changed since load')

            # A new picture is a change, and save says which
            n = len(get_log())
            frame.set_input_files('#file', os.path.join(HERE, 'title-picture.jpg'))
            page.wait_for_timeout(1000)
            ch = [m for m in get_log()[n:] if m['type'] == 'htmleditor:change']
            check_that(ch and 'title-picture-2.jpg' in ch[-1].get('assetsChanged', []), 'a new file is reported as a change')
            # Remove one
            frame.click('#btn-panel')
            frame.click('[data-itab=pictures]')
            frame.click('[data-pic-del="alt.jpg"]')
            frame.click('#ask-ok')
            page.wait_for_timeout(700)
            ch = [m for m in get_log()[n:] if m['type'] == 'htmleditor:change']
            check_that(ch and 'alt.jpg' in ch[-1].get('assetsRemoved', []), 'removing a file is a change too')
            frame.click('#btn-panel')
            page.evaluate("send({ type: 'htmleditor:get' })")
            page.wait_for_timeout(300)
            g = get_last_message('save')
            check_that('title-picture-2.jpg' in g['assets'] and 'alt.jpg' not in g['assets'] and g['assetsChanged'] == ['title-picture-2.jpg'] and g['assetsRemoved'] == ['alt.jpg'], 'get: all files, assetsChanged and assetsRemoved')
            page.evaluate("send({ type: 'htmleditor:get' })")
            page.wait_for_timeout(300)
            check_that(get_last_message('save')['assetsChanged'] == [] and get_last_message('save')['assetsRemoved'] == [], 'after that the page has them all')

            # A load with assets replaces the pictures
            page.evaluate("send({ type: 'htmleditor:load', name: 'Dossier 17', content: " + json.dumps(TEX) + ", assets: { 'title-picture.jpg': jpg } })")
            page.wait_for_timeout(800)
            check_that(frame.evaluate('Object.keys(htmlEditor.state.assets)') == ['title-picture.jpg'], 'a load with assets replaces the document\'s files')

            # F5 / Ctrl+R inside the editor go to the page
            n = len(get_log())
            frame.click('#stage', position={'x': 400, 'y': 600})
            page.keyboard.press('F5')
            page.keyboard.press('Control+r')
            page.wait_for_timeout(500)
            rl = [m for m in get_log()[n:] if m['type'] == 'htmleditor:reload']
            check_that(len(rl) == 2 and rl[0]['id'] == frame.evaluate('htmlEditor.state.fileId') and frame.evaluate('!!window.htmlEditor'), 'F5 and Ctrl+R do not reload but ask the page')
            check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
            browser.close()
    finally:
        server.terminate()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
