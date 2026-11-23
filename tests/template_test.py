"""Template placeholders (?template=mustache), run in Node: how the HTML editor reads them.

    python3 tests/template_test.py

  letter    a letter template with {{name}} in text and attribute values, {{#name}} and {{^name}}
            sections and a tag in a comment (tests/letter-template.html) has 0 errors with the syntax
            "mustache", and the checker gives the same problems with the option off
  errors    a section left open and a stray end tag are errors at the tag, next to the
            checker's own problems
  view      the code view shows every tag as written, in attribute values and comments too,
            without a color of its own
  examples  the source of the example view: examples as text in text and attribute values,
            only plain words in CSS, nothing in scripts, event attributes and the markup itself,
            comments kept closed; every start tag marked with its place in the code (list
            rows: the same place); an attribute that names an address and held a placeholder
            is held back, a style element that held one gets only local addresses
  angle     the letter template in the syntax "angle" (tests/letter-template-angle.html) has 0 errors: <<name>> reads as text,
            also in an unquoted attribute value
  signs     tags with the signs < & > (outside the syntax) read as text, also in an unquoted
            attribute value: only the placeholder errors for their signs
  ids       an id that holds a placeholder stands for ids filled in later: with the option the
            check for ids used twice leaves it out, with the option off it reports it
  tidy      Tidy keeps every tag and is the same when run twice
Needs Node."""
import html
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), 'src', 'js')
failed = []


def check_that(ok, text):
    """Prints one result line and notes a failure.

    Args:
        ok (bool): True when the check holds.
        text (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if ok else 'FAIL  ') + text, flush=True)
    if not ok:
        failed.append(text)


def run_report(cases):
    """Runs tests/template/report.mjs in Node on the cases.

    Args:
        cases (list[dict]): each with `code` (str) and `template` (str or None).

    Returns:
        list[dict]: one result per case, in order.
    """
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as file:
        json.dump(cases, file)
    try:
        run = subprocess.run(['node', os.path.join(HERE, 'template', 'report.mjs'), SCRIPTS, file.name],
                             capture_output=True, text=True, timeout=120)
    finally:
        os.unlink(file.name)
    if run.returncode:
        print(run.stderr)
        sys.exit('report.mjs failed')
    return json.loads(run.stdout)


def get_errors(result):
    """Returns the messages of the errors of a result.

    Args:
        result (dict): one case result of report.mjs.

    Returns:
        list[str]: the messages of the problems of kind "error".
    """
    return [problem['msg'] for problem in result['problems'] if problem['kind'] == 'error']


def get_plain_text(highlighted):
    """Returns the plain text of highlighted HTML.

    Args:
        highlighted (str): the HTML of the code view.

    Returns:
        str: the text with the tags removed and the entities decoded.
    """
    return html.unescape(re.sub(r'<[^>]+>', '', highlighted))


with open(os.path.join(HERE, 'letter-template.html'), encoding='utf-8') as fixture:
    LETTER = fixture.read()
with open(os.path.join(HERE, 'letter-template-angle.html'), encoding='utf-8') as fixture:
    ANGLE = fixture.read()
BROKEN = '<!DOCTYPE html>\n<html><body>\n<p>{{#hasLink}}<a href="{{link}}">x</a></p>\n<p>{{/items}}</p>\n<div>\n</body></html>\n'

SIGNS = '<!DOCTYPE html>\n<html><body>\n<p>{{<x}} {{&copy}}</p>\n<a href={{>y}}>z</a>\n</body></html>\n'
IDS = '<!DOCTYPE html>\n<html><body>\n<p id="row-{{id}}">a</p>\n<p id="row-{{id}}">b</p>\n</body></html>\n'

EXAMPLE = ('<!DOCTYPE html>\n<html><head><style>p{color:{{color}}} .a{background:url(https://x.invalid/{{id}})}</style></head>\n'
           '<body onload="{{name}}">\n<!-- {{name}} -->\n<p title="{{name}}" data-x={{name}}>{{name}}</p>\n<{{tag}}>\n<img src="https://x.invalid/{{id}}.png" alt="x">\n'
           '<img src="logo.png" alt="plain">\n<script>var a = "{{name}}";</script>\n<ul>\n{{#items}}\n<li>{{label}}</li>\n{{/items}}\n</ul>\n</body></html>\n')
EXAMPLES = {'placeholders': [
    {'name': 'name', 'kind': 'value', 'example': 'John "Doe" <b>&</b> -->x'},
    {'name': 'color', 'kind': 'value', 'example': 'red;}body{background:url(https://x.invalid/a)'},
    {'name': 'id', 'kind': 'value', 'example': '42'},
    {'name': 'tag', 'kind': 'value', 'example': 'script'},
    {'name': 'items', 'kind': 'list', 'fields': [{'name': 'label'}], 'rows': [{'label': 'Chair'}, {'label': 'Table'}]},
]}

letter, letter_off, broken, angle, ids, ids_off, signs, example = run_report([
    {'code': LETTER, 'template': 'mustache'}, {'code': LETTER, 'template': None}, {'code': BROKEN, 'template': 'mustache'},
    {'code': ANGLE, 'template': 'angle'}, {'code': IDS, 'template': 'mustache'}, {'code': IDS, 'template': None},
    {'code': SIGNS, 'template': 'mustache'}, {'code': EXAMPLE, 'template': 'mustache', 'examples': EXAMPLES}])

print('-- the letter template')
check_that(get_errors(letter) == [], f'mustache: 0 errors (got {get_errors(letter)})')
check_that(len(letter['tags']) == 19, f'mustache: every tag of the template is found ({len(letter["tags"])})')
check_that(letter_off['problems'] == letter['problems'], 'option off: the checker gives the same problems')

print('-- placeholder errors')
messages = [(problem['pos'], problem['msg']) for problem in broken['problems'] if 'section' in problem['msg'] or 'stray' in problem['msg']]
expected = [(BROKEN.index('{{#hasLink}}'), 'The section {{#hasLink}} stays open - add {{/hasLink}}'),
            (BROKEN.index('{{/items}}'), '{{/items}} is a stray end tag - remove it or add {{#items}} before it')]
check_that(sorted(messages) == expected, f'a section left open and a stray end tag at their tags: {messages}')
check_that(any('<div> is never closed' in message for message in get_errors(broken)), 'the checker reports its own problems next to them')

print('-- code view')
check_that(get_plain_text(letter['highlighted']) == LETTER, 'mustache: the highlighted text is the code')
check_that('class="tp"' not in letter['highlighted'] + angle['highlighted'], 'no tag gets a color of its own')
check_that(letter_off['highlighted'] == letter_off['plainHighlighted'], 'option off: the plain HTML highlighting')

print('-- angle')
check_that(get_errors(angle) == [], f'angle: 0 errors (got {get_errors(angle)})')
check_that(get_plain_text(angle['highlighted']) == ANGLE, 'angle: the code view shows every tag as written')

print('-- signs')
check_that([message for message in get_errors(signs) if not message.startswith('Unknown placeholder')] == [],
           'tags with the signs < & > read as text: only the placeholder errors for their signs')

print('-- ids')
check_that(get_errors(ids) == [], 'with the option an id holding a placeholder is left out of the check for ids used twice')
check_that(get_errors(ids_off) == ['The id "row-{{id}}" is used twice'], 'option off: the check reports it')

print('-- examples')
source = example['example']
check_that('<p data-hp="' in source and '>John "Doe" &lt;b&gt;&amp;&lt;/b&gt; --&gt;x</p>' in source, 'an example is text in the page')
check_that('title="John &quot;Doe&quot; &lt;b&gt;&amp;&lt;/b&gt; --&gt;x"' in source and 'data-x=John&#32;&quot;Doe&quot;' in source,
           'an example in a quoted and an unquoted attribute value stays inside it')
check_that('onload=""' in source and 'var a = "";' in source, 'nothing in an event attribute and in a script')
check_that('<!-- John "Doe" b&/b x -->' in source, 'a comment stays closed')
check_that('<&#115;cript>' in source and '<script>\n<img' not in source, 'an example after "<" never starts markup')
check_that('/*held*/p{color:redbodybackgroundurlhttpsx.invalida}' in source, 'only plain words in CSS; a style element that held a placeholder gets only local addresses')
check_that('data-htmleditor-held-src="https://x.invalid/42.png"' in source and 'src="logo.png"' in source, 'an address that held a placeholder is held back, the others stay')
places = re.findall(r'<li data-hp="(\d+)" data-hv="\d+">', source)
check_that(len(places) == 2 and len(set(places)) == 1 and int(places[0]) == EXAMPLE.index('<li>'), f'list rows are marked with the place of their element in the code {places}')

print('-- tidy')
check_that(letter['tidiedTags'] == letter['tags'], 'Tidy keeps every tag')
check_that(letter['tidiedTwice'] == letter['tidied'], 'Tidy twice is the same')

print(f'\n{len(failed)} failed' if failed else '\nall passed')
sys.exit(1 if failed else 0)
