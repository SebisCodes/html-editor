/**
 * The welcome example (shown on the first visit and by "New" > "The welcome example") and the
 * templates of the "New" menu, each with its name and HTML code.
 */

/** The document "My documents" starts with when it is empty. */
export const START = {
    name: 'Welcome',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome to the HTML Editor</title>
  <meta name="description" content="A first page written in the HTML Editor.">
  <style>
    body {
      max-width: 720px;
      margin: 0 auto;
      padding: 32px 20px;
      font: 17px/1.6 system-ui, sans-serif;
      color: #1d2330;
    }
    h1 { color: #c2410c; line-height: 1.2; }
    .box {
      padding: 14px 18px;
      border-radius: 12px;
      background: #fff4e6;
    }
    table { border-collapse: collapse; }
    th, td { padding: 6px 12px; border-bottom: 1px solid #e2e5ec; text-align: left; }
  </style>
</head>
<body>
  <!-- Click any text in the preview to edit it right there. -->
  <h1>Welcome to the HTML Editor</h1>
  <p>Type on the left, see the page on the right. Write <strong>bold</strong>,
    <em>italic</em> or <a href="https://giit.ch/">a link</a>, and the preview
    follows as you type.</p>

  <h2>Lists and tables</h2>
  <ul>
    <li>Headings appear in the <b>Outline</b> on the right.</li>
    <li>Problems such as an unclosed tag are listed above the code.</li>
    <li>Drop a picture into the editor to keep it with the page.</li>
  </ul>
  <table>
    <tr><th>Format</th><th>Export</th></tr>
    <tr><td>HTML</td><td>one file, or with its files as ZIP</td></tr>
    <tr><td>PDF</td><td>through the print dialog</td></tr>
  </table>

  <h2>Safe preview</h2>
  <p class="box">Scripts of the page do not run in the preview, and links do
    not leave the editor - you see the HTML and CSS as they are.</p>
</body>
</html>
`,
};

/**
 * Returns a complete page for a template.
 * @param {string} title - the text of <title>.
 * @param {string} lang - the language of <html lang>.
 * @param {string} style - the CSS of the <style> element, indented.
 * @param {string} body - the content of <body>.
 * @returns {string} the HTML code.
 */
function formatPage(title, lang, style, body) {
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
${style}
  </style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** The templates of the "New" menu by their key in the menu. */
export const TEMPLATES = {
    landing: {
        name: 'Landing page',
        code: formatPage('My Product', 'en', `    * { box-sizing: border-box; }
    body { margin: 0; font: 17px/1.6 system-ui, sans-serif; color: #172033; }
    header { padding: 72px 24px; text-align: center; color: #ffffff; background: linear-gradient(135deg, #1e3a8a, #7c3aed); }
    header h1 { margin: 0 0 12px; font-size: 44px; line-height: 1.1; }
    .button { display: inline-block; margin-top: 18px; padding: 12px 22px; border-radius: 10px; background: #ffffff; color: #1e3a8a; font-weight: 700; text-decoration: none; }
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; max-width: 960px; margin: 48px auto; padding: 0 24px; }
    .feature { padding: 20px; border: 1px solid #e3e6ef; border-radius: 14px; }
    footer { padding: 24px; text-align: center; color: #5b6478; font-size: 14px; }`, `  <header>
    <h1>My Product</h1>
    <p>One sentence that says what it does and for whom.</p>
    <a class="button" href="#start">Get started</a>
  </header>
  <section class="features" id="start">
    <div class="feature">
      <h2>Fast</h2>
      <p>What makes it quick to use.</p>
    </div>
    <div class="feature">
      <h2>Simple</h2>
      <p>Why there is nothing to learn.</p>
    </div>
    <div class="feature">
      <h2>Private</h2>
      <p>Where the data stays.</p>
    </div>
  </section>
  <footer>
    <p>&copy; My Company</p>
  </footer>`),
    },
    article: {
        name: 'Article',
        code: formatPage('Article title', 'en', `    body { max-width: 680px; margin: 0 auto; padding: 40px 20px; font: 19px/1.7 Georgia, "Times New Roman", serif; color: #222222; }
    h1 { font-size: 38px; line-height: 1.15; margin-bottom: 6px; }
    .meta { color: #6b7280; font: 15px system-ui, sans-serif; }
    blockquote { margin: 24px 0; padding-left: 18px; border-left: 4px solid #d1d5db; color: #4b5563; font-style: italic; }
    figure { margin: 28px 0; }
    figcaption { color: #6b7280; font: 14px system-ui, sans-serif; }`, `  <article>
    <h1>Article title</h1>
    <p class="meta">By Your Name &middot; 5 min read</p>
    <p>The first paragraph says what the article is about and why it matters.</p>
    <h2>A section</h2>
    <p>More text, with a <a href="https://example.com/">link</a> and <em>emphasis</em>.</p>
    <blockquote>A quote that stands out from the text.</blockquote>
    <h2>Another section</h2>
    <ol>
      <li>First point</li>
      <li>Second point</li>
    </ol>
  </article>`),
    },
    form: {
        name: 'Contact form',
        code: formatPage('Contact', 'en', `    body { max-width: 520px; margin: 0 auto; padding: 40px 20px; font: 16px/1.5 system-ui, sans-serif; color: #1f2937; }
    label { display: block; margin: 14px 0 4px; font-weight: 600; }
    input, textarea { width: 100%; padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
    button { margin-top: 18px; padding: 10px 20px; border: 0; border-radius: 8px; background: #0f766e; color: #ffffff; font: inherit; font-weight: 700; }`, `  <h1>Contact us</h1>
  <p>We answer within two working days.</p>
  <form action="/contact" method="post">
    <label for="name">Name</label>
    <input id="name" name="name" type="text" autocomplete="name" required>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required>
    <label for="message">Message</label>
    <textarea id="message" name="message" rows="6" required></textarea>
    <button type="submit">Send</button>
  </form>`),
    },
    email: {
        name: 'Email newsletter',
        code: formatPage('Newsletter', 'en', `    body { margin: 0; background: #eef1f6; font: 16px/1.55 Arial, Helvetica, sans-serif; color: #1f2633; }
    .wrap { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .top { padding: 28px 32px; background: #0e7490; color: #ffffff; }
    .top h1 { margin: 0; font-size: 26px; }
    .text { padding: 24px 32px; }
    .button { display: inline-block; padding: 11px 20px; border-radius: 6px; background: #0e7490; color: #ffffff; text-decoration: none; font-weight: 700; }
    .small { padding: 16px 32px; color: #6b7280; font-size: 13px; }`, `  <table class="wrap" role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td class="top"><h1>News of the month</h1></td></tr>
    <tr><td class="text">
      <p>Hello,</p>
      <p>Here is what happened this month, in three short paragraphs.</p>
      <p><a class="button" href="https://example.com/">Read more</a></p>
    </td></tr>
    <tr><td class="small">You get this email because you signed up on example.com.</td></tr>
  </table>`),
    },
};
