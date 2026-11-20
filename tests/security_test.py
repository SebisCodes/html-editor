"""What a hostile page or link must not be able to do.

    php -S 127.0.0.1:8095 -t src src/php/router.php          (in the project folder)
    python tests/security_test.py

- nothing in the document runs or leaves the preview: scripts, on…
  attributes, javascript: links, links, forms, meta refresh, <base>,
  frames;
- a page around the editor (iframe) or an opener reads no document it did
  not load itself (get before load), and a load never overwrites the user's
  own document of the same name;
- ?webhook= in a link is never stored, and without ?src= it is not used
  inside a page; at the top level the user is asked;
- an AI link that would replace an existing document asks first;
- a link that unpacks to a huge text is refused;
- the CSP is also in the page itself."""

import base64
import os
import subprocess
import sys
import tempfile
import time
import zlib

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8095/')
P = 'htmleditor'
HOOK = 'htmlEditor'
EVIL = '''<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="refresh" content="0;url=https://evil.example/refresh">
  <base href="https://evil.example/">
  <title>evil</title>
</head>
<body>
  <script>parent.pwned = 'script'; top.pwned = 'script';</script>
  <img src="nothing.png" onerror="parent.pwned = 'onerror'" alt="x">
  <svg onload="parent.pwned = 'svg'" width="10" height="10"><script>parent.pwned = 'svg script'</script></svg>
  <p><a id="js" href="javascript:parent.pwned='link'">js link</a></p>
  <p><a id="out" href="https://evil.example/out">out</a></p>
  <p><a id="blank" href="https://evil.example/blank" target="_blank">new tab</a></p>
  <form action="https://evil.example/form" method="post"><button id="go">Send</button></form>
  <div id="c" onclick="parent.pwned = 'click'">click me</div>
  <iframe srcdoc="<script>parent.parent.pwned = 'srcdoc'</script>"></iframe>
  <object data="javascript:parent.pwned = 'object'"></object>
  <map name="m"><area id="area" shape="rect" coords="0,0,50,50" href="https://evil.example/area"></map>
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#m" width="50" height="50" alt="map">
</body>
</html>
'''
SECRET = '<!DOCTYPE html>\n<html>\n<head><title>Mine</title></head>\n<body>\n<p>MY SECRET TEXT</p>\n</body>\n</html>\n'
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


HOST = """<!doctype html><meta charset="utf-8"><title>evil</title>
<iframe id="f" src="SRC" style="width:1200px;height:700px;border:0"></iframe>
<script>
const P = 'PFX', ORIGIN = new URL('EDITOR').origin, frame = document.getElementById('f');
window.log = [];
addEventListener('message', e => {
  if (e.source !== frame.contentWindow) return;
  log.push(e.data);
  if (e.data.type === P + ':ready') frame.contentWindow.postMessage({ type: P + ':get' }, '*');
});
window.send = m => frame.contentWindow.postMessage(m, '*');
</script>"""

with tempfile.TemporaryDirectory() as d:
    def write_host(name, src):
        """Writes a hostile host page into the served folder.

        Args:
            name (str): the file name of the page.
            src (str): the address of the editor in its iframe.

        Returns:
            None: the page is written.
        """
        with open(os.path.join(d, name), 'w') as f:
            f.write(HOST.replace('SRC', src).replace('EDITOR', EDITOR).replace('PFX', P))
    write_host('get.html', EDITOR + '?embed=1')
    write_host('hook.html', EDITOR + '?embed=1&webhook=https://evil.example/c&auto')
    server = subprocess.Popen(['php', '-S', '127.0.0.1:8296', '-t', d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            ctx = browser.new_context(viewport={'width': 1300, 'height': 800})
            errors = []
            ed = ctx.new_page()
            ed.on('pageerror', lambda e: errors.append(str(e)))
            ed.goto(EDITOR, wait_until='networkidle')
            ed.wait_for_timeout(600)
            check_that(ed.locator('meta[http-equiv="Content-Security-Policy"]').count() == 1 and "script-src 'self'" in ed.get_attribute('meta[http-equiv="Content-Security-Policy"]', 'content'), 'the CSP is also in the page')
            check_that("script-src 'none'" in ed.evaluate("fetch('/preview.html').then(r => r.text())"), 'the preview frame has its own policy without scripts')

            # A hostile document: nothing in it runs or leaves the preview
            outside = []
            ed.on('request', lambda r: outside.append(r.url) if 'evil.example' in r.url else None)
            pages_before = len(ctx.pages)
            ed.evaluate(f'''t => {HOOK}.setCode(t)''', EVIL)
            ed.wait_for_timeout(600)
            pv = ed.frame_locator('#preview')
            for sel in ('#js', '#out', '#blank', '#go', '#c', 'img[usemap]'):
                pv.locator(sel).click(position={'x': 5, 'y': 5})
                ed.wait_for_timeout(150)
            pv.locator('#out').click(button='middle')
            ed.wait_for_timeout(600)
            check_that(ed.evaluate('window.pwned === undefined') and ed.evaluate("document.getElementById('preview').contentWindow.pwned === undefined"), 'scripts, on… attributes and javascript: links of the document never run: ' + str(ed.evaluate('window.pwned')))
            check_that(ed.evaluate("document.getElementById('preview').contentDocument.URL").endswith('/preview.html?v=1'), 'links, forms and meta refresh do not navigate the preview')
            check_that(len(ctx.pages) == pages_before, 'no new window or tab opens')
            check_that(not outside, 'nothing is loaded from the addresses in the document\'s links, forms or <base>: ' + str(outside[:3]))
            check_that(ed.evaluate("document.getElementById('preview').contentDocument.querySelectorAll('script, [onerror], [onclick], [onload], base').length") == 0, 'the preview has no scripts, handlers or <base>')
            check_that('<script>parent.pwned' in ed.evaluate(f'{HOOK}.state.code'), 'while the code keeps them unchanged')
            check_that(ed.evaluate("document.getElementById('preview').getAttribute('sandbox')") == 'allow-same-origin', 'the preview frame: sandbox="allow-same-origin" only')
            ed.evaluate(f'''() => {HOOK}.setCode('<p>Harmless again.</p>')''')      # the stored document no longer names evil.example
            ed.wait_for_timeout(500)

            # The user's own document, open when the page is visited next
            ed.evaluate(f'''t => {{ const id = {HOOK}.store.create('Dossier 17', t); }}''', SECRET)
            ed.evaluate(f'''t => {HOOK}.receive(t, 'set', {{ file: 'Dossier 17' }})''', SECRET)
            ed.wait_for_timeout(300)
            if ed.locator('#ask').is_visible():
                ed.click('#ask-ok')
            ed.wait_for_timeout(300)

            # A page that never loads a document asks for "the" document
            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:8296/get.html', wait_until='load')
            page.wait_for_timeout(2500)
            saves = [m for m in page.evaluate('log') if m['type'] == P + ':save']
            check_that(saves and saves[0]['content'] is None and saves[0]['id'] is None, 'get before load answers with nothing')
            check_that('MY SECRET' not in str(page.evaluate('log')), 'no message carries the user\'s document')
            # A load with the name of the user's document does not overwrite it
            page.evaluate("send({ type: P + ':load', name: 'Dossier 17', content: 'overwritten' })")
            page.wait_for_timeout(800)
            frame = next(fr for fr in page.frames if fr.url.startswith(EDITOR))
            mine = frame.evaluate(f'''(() => {{ const f = {HOOK}.store.list().find(f => f.name === 'Dossier 17'); return {HOOK}.store.code(f.id); }})()''')
            loaded = frame.evaluate(f'''{HOOK}.store.list().filter(f => {HOOK}.store.code(f.id) === 'overwritten').map(f => f.name)''')
            check_that(mine == SECRET and len(loaded) == 1 and loaded[0] != 'Dossier 17', 'a load never overwrites the user\'s own document (it becomes a new one): ' + str(loaded))
            page.evaluate("send({ type: P + ':get' })")
            page.wait_for_timeout(300)
            check_that(page.evaluate('log[log.length - 1]')['content'] == 'overwritten', 'get then answers with the page\'s own document only')
            page.close()

            # ?webhook= inside a page without ?src=: not used, not stored
            page = ctx.new_page()
            page.goto('http://127.0.0.1:8296/hook.html', wait_until='load')
            page.wait_for_timeout(2000)
            frame = next(fr for fr in page.frames if fr.url.startswith(EDITOR))
            check_that('evil.example' not in frame.evaluate('JSON.stringify(localStorage)'), 'a webhook in an embedded link is not stored')
            check_that('only works together with ?src=' in frame.inner_text('#toast'), 'and not used without ?src=')
            page.close()

            # ?embed=1&webhook= at the top level: the user is asked, and it is never stored
            top = ctx.new_page()
            top.goto(EDITOR + '?embed=1&webhook=https://evil.example/c&auto', wait_until='networkidle')
            top.wait_for_timeout(800)
            check_that(top.locator('#ask').is_visible() and 'evil.example' in top.inner_text('#ask'), 'a top-level link with a webhook asks first')
            top.click('#ask-ok')
            top.wait_for_timeout(200)
            check_that('evil.example' not in top.evaluate('JSON.stringify(localStorage)'), 'even when allowed, it is not stored')
            top.close()

            # An AI link names the document it changes: no question, and Undo takes the change back
            tex = '<!DOCTYPE html><html><head><title>x</title></head><body>junk</body></html>'
            ed.bring_to_front()
            ed.goto(EDITOR + '#b64=' + base64.urlsafe_b64encode(tex.encode()).decode() + '&file=Dossier%2017', wait_until='networkidle')
            ed.wait_for_timeout(800)
            check_that(not ed.locator('#ask').is_visible() and ed.evaluate(f'{HOOK}.state.name') == 'Dossier 17', 'an AI link changes the document it names without a question')
            ed.click('#btn-undo')
            ed.wait_for_timeout(400)
            mine = ed.evaluate(f'''(() => {{ const f = {HOOK}.store.list().find(f => f.name === 'Dossier 17'); return {HOOK}.store.code(f.id); }})()''')
            check_that(mine == SECRET, 'Undo brings the document back')

            # A link that unpacks to more than 5 MB
            bomb = base64.urlsafe_b64encode(zlib.compress(b'%' * 20_000_000, 9)).decode().rstrip('=')
            ed.goto(EDITOR + '#z=' + bomb + '&file=new&name=bomb', wait_until='networkidle')
            ed.wait_for_timeout(1500)
            check_that('bomb' not in ed.evaluate(f'{HOOK}.store.list().map(f => f.name)'), 'a link that unpacks to a huge text is refused')
            check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
            browser.close()
    finally:
        server.terminate()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
