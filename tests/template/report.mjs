/**
 * Reads a JSON list of cases (argv[3]) and runs each through the HTML editor's modules in src/js
 * (argv[2]) as the editor runs them: the checker on the tags in brace form, the highlighting with
 * and without the template syntax of the case, Tidy, the shared template module, and the source
 * of the example view when the case has examples. Prints one JSON result per case for
 * template_test.py.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const scriptFolder = process.argv[2];
const cases = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const { parse } = await importModule('html.js');
const { highlight } = await importModule('html-highlight.js');
const { formatHtml } = await importModule('html-tidy.js');
const template = await importModule('template-tags.js');
const { buildHtmlView, buildExampleSource } = await importModule('html-examples.js');
const { createTemplateExamples } = await importModule('template-examples.js');

/**
 * Imports a module of the editor by its file name.
 * @param {string} fileName - the file in src/js, e.g. "html.js".
 * @returns {Promise<object>} the module's exports.
 */
function importModule(fileName) {
    return import(pathToFileURL(join(scriptFolder, fileName)).href);
}

/**
 * One case of template_test.py.
 * @typedef {object} TemplateCase
 * @property {string} code - the HTML code.
 * @property {?string} template - the template syntax, or null for plain HTML.
 * @property {?object} [examples] - the page's template message for the example view.
 */

/**
 * Builds the source of the example view of a case.
 * @param {TemplateCase} testCase - the code, the template syntax and the examples.
 * @param {import('../../src/js/html.js').ParsedHtml} parsed - the code as read.
 * @returns {Promise<?string>} the source the preview reads; null without examples.
 */
async function buildExampleResult(testCase, parsed) {
    if (!testCase.examples) return null;
    const examples = await createTemplateExamples(testCase.examples, { decodePicture: async () => { throw new Error('no pictures here'); } });
    const view = buildHtmlView(testCase.code, parsed, template.getTemplateSyntax(testCase.template), examples);
    return buildExampleSource(testCase.code, parsed, view, css => `/*held*/${css}`);
}

/**
 * Builds the result of one case: what the editor makes of its code with its template syntax.
 * @param {TemplateCase} testCase - the code and the template syntax.
 * @returns {Promise<object>} the problems, the highlighted HTML, the tidied code, the tags and the example view's source.
 */
async function buildCaseResult(testCase) {
    const syntax = template.getTemplateSyntax(testCase.template);
    const checked = template.convertTemplateTagsToBraces(testCase.code, syntax);
    const parsed = parse(checked, { isTemplate: Boolean(syntax) });
    const problems = [...parsed.problems, ...(syntax ? template.checkTemplateSections(testCase.code, syntax) : [])];
    const tidied = formatHtml(testCase.code);
    /**
     * Returns the tags of a text as written.
     * @param {string} text - the text.
     * @returns {string[]} the tags in order; empty without a syntax.
     */
    const getTags = text => (syntax ? template.getTemplateTags(text, syntax).map(tag => text.slice(tag.start, tag.end)) : []);
    return {
        problems,
        plainHighlighted: highlight(testCase.code),
        highlighted: template.buildHighlightWithTemplateTags(highlight(checked), syntax, testCase.code),
        tidied,
        tidiedTwice: formatHtml(tidied),
        tags: getTags(testCase.code),
        tidiedTags: getTags(tidied),
        example: await buildExampleResult(testCase, parsed),
    };
}

console.log(JSON.stringify(await Promise.all(cases.map(buildCaseResult))));
