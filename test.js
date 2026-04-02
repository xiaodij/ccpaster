#!/usr/bin/env node
/**
 * claudypasta — Converter Test Suite
 *
 * Tests the converter against realistic Claude Code terminal output samples.
 * Run: node test.js
 */

const {
  convertCCOutput, unwrapLines, parseBlocks, parseBoxTable,
  isStructuralLine, looksLikeContinuation, esc, inlineFormat
} = require('./static/converter.js');

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  FAIL: ${name}`);
    if (detail) console.log(`        ${detail}`);
  }
}

function assertContains(name, html, expected) {
  if (html.includes(expected)) {
    passed++;
  } else {
    failed++;
    failures.push({ name, detail: `Expected to find: ${expected.slice(0, 120)}` });
    console.log(`  FAIL: ${name}`);
    console.log(`        Expected to find: ${expected.slice(0, 120)}`);
  }
}

function assertNotContains(name, html, unexpected) {
  if (!html.includes(unexpected)) {
    passed++;
  } else {
    failed++;
    failures.push({ name, detail: `Should NOT contain: ${unexpected.slice(0, 120)}` });
    console.log(`  FAIL: ${name}`);
    console.log(`        Should NOT contain: ${unexpected.slice(0, 120)}`);
  }
}

function countOccurrences(str, substr) {
  let count = 0, pos = 0;
  while ((pos = str.indexOf(substr, pos)) !== -1) { count++; pos += substr.length; }
  return count;
}

// ============================================================
// Test 1: Multi-line box-drawing table cells
// ============================================================
console.log('\n--- Test 1: Multi-line box-drawing table cells ---');
{
  const input = `
┌──────────────┬───────────────┬──────────────────────────────────────────┐
│   Language   │    Version    │ Key Features                            │
├──────────────┼───────────────┼──────────────────────────────────────────┤
│              │     3.12      │ The latest stable release. Python has   │
│ Python       │ (latest       │ pattern matching and improved error     │
│ CPython      │   stable)     │ messages for easier debugging.          │
├──────────────┼───────────────┼──────────────────────────────────────────┤
│ Rust         │               │ Memory safety without garbage           │
│ rustc        │    1.77       │ collection.                             │
├──────────────┼───────────────┼──────────────────────────────────────────┤
│ Go           │    1.22       │ Fast compilation.                       │
│ golang       │               │                                         │
└──────────────┴───────────────┴──────────────────────────────────────────┘`;

  const html = convertCCOutput(input);
  const trCount = countOccurrences(html, '<tr>');

  // Header row (1) + 3 data rows = 4 <tr> tags
  assert('Multi-line table: correct row count', trCount === 4,
    `Expected 4 <tr>, got ${trCount}`);

  // Python row should merge into one cell
  assertContains('Multi-line table: Python cell merged',
    html, 'Python CPython');
  assertContains('Multi-line table: Python version merged',
    html, '3.12 (latest stable)');
  assertContains('Multi-line table: Python description merged',
    html, 'pattern matching and improved error');

  // Rust should be 1 row, not 2
  assertContains('Multi-line table: Rust merged', html, 'Rust rustc');

  // Go empty continuation line shouldn't create extra text
  assertContains('Multi-line table: Go merged', html, 'Go golang');

  // Should have <thead> with header row
  assertContains('Multi-line table: has thead', html, '<thead>');
  assertContains('Multi-line table: header Language', html, '>Language<');
}

// ============================================================
// Test 2: Simple single-line box table
// ============================================================
console.log('\n--- Test 2: Simple single-line box table ---');
{
  const input = `
┌──────────┬────────┐
│ Question │ Answer │
├──────────┼────────┤
│ Is it?   │ Yes    │
├──────────┼────────┤
│ How?     │ Easily │
└──────────┴────────┘`;

  const html = convertCCOutput(input);
  const trCount = countOccurrences(html, '<tr>');

  assert('Simple table: correct row count', trCount === 3,
    `Expected 3 <tr>, got ${trCount}`);
  assertContains('Simple table: header', html, '>Question<');
  assertContains('Simple table: data cell', html, 'Yes');
  assertContains('Simple table: data cell 2', html, 'Easily');
}

// ============================================================
// Test 3: Rounded-corner box table
// ============================================================
console.log('\n--- Test 3: Rounded-corner box table ---');
{
  const input = `
╭──────┬───────╮
│ Name │ Value │
├──────┼───────┤
│ foo  │ 42    │
╰──────┴───────╯`;

  const html = convertCCOutput(input);
  assertContains('Rounded table: parsed', html, '<table');
  assertContains('Rounded table: header', html, '>Name<');
  assertContains('Rounded table: data', html, '42');
}

// ============================================================
// Test 4: Double-line box table
// ============================================================
console.log('\n--- Test 4: Double-line box table ---');
{
  const input = `
╔══════╦═══════╗
║ Name ║ Value ║
╠══════╬═══════╣
║ bar  ║ 99    ║
╚══════╩═══════╝`;

  const html = convertCCOutput(input);
  assertContains('Double table: parsed', html, '<table');
  assertContains('Double table: header', html, '>Name<');
  assertContains('Double table: data', html, '99');
}

// ============================================================
// Test 5: Markdown pipe table
// ============================================================
console.log('\n--- Test 5: Markdown pipe table ---');
{
  const input = `
| Library | Purpose          |
|---------|------------------|
| ink     | Terminal render   |
| marked  | Markdown parsing  |
| chalk   | ANSI colors       |`;

  const html = convertCCOutput(input);
  assertContains('Pipe table: has table', html, '<table');
  assertContains('Pipe table: header', html, '>Library<');
  assertContains('Pipe table: data', html, 'ink');
  assertContains('Pipe table: data 2', html, 'chalk');
}

// ============================================================
// Test 6: List with wrapped continuation lines
// ============================================================
console.log('\n--- Test 6: List continuation lines ---');
{
  const input =
`- Memory fragmentation in the allocator — the sizing mismatch between allocation requests and page boundaries gets absorbed by
the heap
- Normal bullet that fits on one line.
- Another long bullet that wraps across multiple lines because terminal width is
limited to about 80 columns here`;

  const html = convertCCOutput(input);

  // Should produce exactly 3 <li> items
  const liCount = countOccurrences(html, '<li');
  assert('List continuation: 3 items', liCount === 3,
    `Expected 3 <li>, got ${liCount}`);

  // First bullet should contain the full merged text
  assertContains('List continuation: merged text',
    html, 'gets absorbed by the heap');

  // Third bullet should merge its continuation
  assertContains('List continuation: third merged',
    html, 'limited to about 80 columns here');

  // "the knee" should NOT appear as a separate <p>
  assertNotContains('List continuation: no orphan paragraph',
    html, '<p style="margin:6px 0;">the knee</p>');
}

// ============================================================
// Test 7: Numbered list with sub-bullets preserves start
// ============================================================
console.log('\n--- Test 7: Numbered list with sub-bullets ---');
{
  const input =
`1. Piriformis stretch (figure-4 stretch)
  - Lie on back, cross affected ankle over opposite knee
  - Hold 30-60 seconds each side
2. 90/90 hip stretch
  - Sit on floor, front leg bent 90 degrees
  - Hold 30-60 seconds
3. Foam roll on deep glutes
  - 1-2 minutes each side`;

  const html = convertCCOutput(input);

  // Item "2." should have start="2"
  assertContains('Numbered list: start=2', html, 'start="2"');
  // Item "3." should have start="3"
  assertContains('Numbered list: start=3', html, 'start="3"');

  // Sub-bullets should be <ul>
  assertContains('Numbered list: sub-bullet ul', html, '<ul');
  assertContains('Numbered list: sub-bullet content', html, 'Lie on back');
}

// ============================================================
// Test 8: Numbered list continuation lines
// ============================================================
console.log('\n--- Test 8: Numbered list continuation ---');
{
  const input =
`1. This is a long numbered item that wraps to the next line because the terminal
is only 80 columns wide
2. Short item.`;

  const html = convertCCOutput(input);

  assertContains('OL continuation: merged',
    html, 'wraps to the next line because the terminal is only 80 columns wide');

  // Should NOT have "is only 80 columns wide" as a separate element
  assertNotContains('OL continuation: no orphan',
    html, '<p style="margin:6px 0;">is only 80 columns wide</p>');
}

// ============================================================
// Test 9: Code blocks preserved exactly
// ============================================================
console.log('\n--- Test 9: Code blocks ---');
{
  const input = `Here is some code:

\`\`\`python
def hello():
    print("world")

if __name__ == "__main__":
    hello()
\`\`\`

That was the code.`;

  const html = convertCCOutput(input);
  assertContains('Code block: has pre', html, '<pre');
  assertContains('Code block: has code', html, '<code>');
  assertContains('Code block: content preserved', html, 'def hello():');
  assertContains('Code block: indentation', html, '    print');
  // HTML entities should be escaped
  assertContains('Code block: quotes escaped', html, '&quot;world&quot;');
}

// ============================================================
// Test 10: Inline formatting
// ============================================================
console.log('\n--- Test 10: Inline formatting ---');
{
  const input = `This has **bold text** and *italic text* and \`inline code\` and ~~struck~~ and [a link](https://example.com).`;
  const html = convertCCOutput(input);

  assertContains('Inline: bold', html, '<strong>bold text</strong>');
  assertContains('Inline: italic', html, '<em>italic text</em>');
  assertContains('Inline: code', html, '>inline code</code>');
  assertContains('Inline: strikethrough', html, '<del>struck</del>');
  assertContains('Inline: link', html, 'href="https://example.com"');
}

// ============================================================
// Test 11: Headers
// ============================================================
console.log('\n--- Test 11: Headers ---');
{
  const input = `# Main Title

## Section One

Some text.

### Subsection

More text.`;

  const html = convertCCOutput(input);
  assertContains('Header: h1', html, '<h1');
  assertContains('Header: h1 content', html, 'Main Title</h1>');
  assertContains('Header: h2', html, '<h2');
  assertContains('Header: h3', html, '<h3');
}

// ============================================================
// Test 12: Horizontal rules
// ============================================================
console.log('\n--- Test 12: Horizontal rules ---');
{
  const input = `First section.

---

Second section.

***

Third section.`;

  const html = convertCCOutput(input);
  const hrCount = countOccurrences(html, '<hr');
  assert('HR: two rules', hrCount === 2, `Expected 2 <hr>, got ${hrCount}`);
}

// ============================================================
// Test 13: Blockquotes
// ============================================================
console.log('\n--- Test 13: Blockquotes ---');
{
  const input = `> This is a blockquote
> spanning multiple lines.

Normal text after.`;

  const html = convertCCOutput(input);
  assertContains('Blockquote: has tag', html, '<blockquote');
  assertContains('Blockquote: content', html, 'This is a blockquote');
}

// ============================================================
// Test 14: ANSI escape code stripping
// ============================================================
console.log('\n--- Test 14: ANSI stripping ---');
{
  const input = `\x1b[1m\x1b[32mSuccess:\x1b[0m The operation completed.\n\x1b[31mError:\x1b[0m Something failed.`;
  const html = convertCCOutput(input);

  assertNotContains('ANSI: no escape chars', html, '\x1b');
  assertContains('ANSI: text preserved', html, 'Success:');
  assertContains('ANSI: text preserved 2', html, 'Something failed.');
}

// ============================================================
// Test 15: Mixed content (realistic CC output)
// ============================================================
console.log('\n--- Test 15: Mixed content ---');
{
  const input = `## Analysis Results

The scan found **3 issues** across the codebase:

┌──────┬──────────┬─────────────────────────────┐
│ Sev  │ File     │ Description                 │
├──────┼──────────┼─────────────────────────────┤
│ High │ auth.py  │ SQL injection in login       │
│      │          │ handler on line 42           │
├──────┼──────────┼─────────────────────────────┤
│ Med  │ api.py   │ Missing rate limit           │
├──────┼──────────┼─────────────────────────────┤
│ Low  │ utils.py │ Unused import                │
└──────┴──────────┴─────────────────────────────┘

Recommended fixes:

1. Parameterize the SQL query in \`auth.py\`:

\`\`\`python
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
\`\`\`

2. Add rate limiting middleware to \`api.py\`.
3. Remove unused import in \`utils.py\`.

---

> Note: Run \`pytest\` after applying fixes to verify nothing breaks.`;

  const html = convertCCOutput(input);

  // Check structure
  assertContains('Mixed: header', html, '<h2');
  assertContains('Mixed: bold', html, '<strong>3 issues</strong>');
  assertContains('Mixed: table', html, '<table');

  // Table should have 3 data rows (not 4 — the multi-line "High" row merges)
  const bodyTrCount = html.split('<tbody>')[1]?.split('</tbody>')[0];
  const dataRows = countOccurrences(bodyTrCount || '', '<tr>');
  assert('Mixed: table has 3 data rows', dataRows === 3,
    `Expected 3 data rows, got ${dataRows}`);

  // Multi-line cell merged
  assertContains('Mixed: SQL injection merged', html, 'SQL injection in login handler on line 42');

  // Code block
  assertContains('Mixed: code block', html, '<pre');
  assertContains('Mixed: SQL in code', html, 'SELECT');

  // Ordered list with start numbers
  assertContains('Mixed: OL item 2', html, 'start="2"');

  // HR
  assertContains('Mixed: hr', html, '<hr');

  // Blockquote
  assertContains('Mixed: blockquote', html, '<blockquote');
}

// ============================================================
// Test 16: Table with all empty cells in a continuation line
// ============================================================
console.log('\n--- Test 16: Empty continuation cells ---');
{
  const input = `
┌──────┬────────────────────────────┐
│ Key  │ Description                │
├──────┼────────────────────────────┤
│ A    │ First item with a long     │
│      │ description that wraps     │
├──────┼────────────────────────────┤
│ B    │ Second item                │
└──────┴────────────────────────────┘`;

  const html = convertCCOutput(input);
  const trCount = countOccurrences(html, '<tr>');

  assert('Empty cont: correct rows', trCount === 3,
    `Expected 3 <tr>, got ${trCount}`);
  assertContains('Empty cont: merged description',
    html, 'First item with a long description that wraps');
}

// ============================================================
// Test 17: Table without header (single-row)
// ============================================================
console.log('\n--- Test 17: Table without header ---');
{
  const input = `
┌──────┬───────┐
│ foo  │ bar   │
└──────┴───────┘`;

  const html = convertCCOutput(input);
  assertContains('No header table: has table', html, '<table');
  // Should NOT have <thead> — single row tables have no header
  assertNotContains('No header table: no thead', html, '<thead>');
  assertContains('No header table: data', html, 'foo');
}

// ============================================================
// Test 18: Paragraph unwrapping (terminal line wrap)
// ============================================================
console.log('\n--- Test 18: Paragraph unwrapping ---');
{
  const input =
`This is a paragraph that was wrapped by the terminal because it exceeds the
standard 80-column width that most terminals default to when rendering Claude
Code output.

This is a separate paragraph that should not be merged with the one above.`;

  const html = convertCCOutput(input);
  const pCount = countOccurrences(html, '<p ');

  assert('Unwrap: two paragraphs', pCount === 2,
    `Expected 2 <p>, got ${pCount}`);
  assertContains('Unwrap: first para merged',
    html, 'paragraph that was wrapped by the terminal because it exceeds the standard 80-column');
}

// ============================================================
// Test 19: Unwrapping with unclosed parentheses across blank line
// ============================================================
console.log('\n--- Test 19: Bracket bridging ---');
{
  const input =
`The function accepts three parameters (name, age,

and email) before returning the result.`;

  const html = convertCCOutput(input);
  assertContains('Bracket bridge: merged across blank',
    html, 'three parameters (name, age, and email)');
}

// ============================================================
// Test 20: XSS / HTML injection safety
// ============================================================
console.log('\n--- Test 20: XSS safety ---');
{
  const input = `Here is some <script>alert("xss")</script> content and <img onerror="alert(1)" src=x>.`;
  const html = convertCCOutput(input);

  assertNotContains('XSS: no script tag', html, '<script>');
  assertNotContains('XSS: no img tag', html, '<img');
  assertContains('XSS: escaped', html, '&lt;script&gt;');
}

// ============================================================
// Test 21: Link safety (no javascript: URLs)
// ============================================================
console.log('\n--- Test 21: Link safety ---');
{
  const input = `[click me](javascript:alert(1)) and [safe](https://example.com)`;
  const html = convertCCOutput(input);

  assertNotContains('Link safety: no javascript:', html, 'href="javascript:');
  assertContains('Link safety: unsafe replaced with #', html, 'href="#"');
  assertContains('Link safety: safe link preserved', html, 'href="https://example.com"');
}

// ============================================================
// Test 22: Windows line endings
// ============================================================
console.log('\n--- Test 22: Windows line endings ---');
{
  const input = "Line one.\r\nLine two.\r\n\r\nParagraph two.";
  const html = convertCCOutput(input);

  assertNotContains('CRLF: no \\r', html, '\r');
  assertContains('CRLF: content preserved', html, 'Line one.');
}

// ============================================================
// Test 23: Large multi-line table (wide, many rows)
// ============================================================
console.log('\n--- Test 23: Large multi-line table ---');
{
  const input = `
┌──────────────┬───────────────┬──────────────────────────────────────────────────────────────────────────────────┐
│   Framework  │    Version    │                                   Description                                    │
├──────────────┼───────────────┼──────────────────────────────────────────────────────────────────────────────────┤
│              │     18.3      │ The most popular frontend library. React uses a virtual DOM to efficiently        │
│ React        │ (latest       │ update the UI, reducing expensive direct DOM manipulations. This approach uses    │
│ react-dom    │   stable)     │ a reconciliation algorithm (the "diffing" engine that compares component          │
│              │               │ trees).                                                                           │
├──────────────┼───────────────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Vue          │               │ Progressive framework with a gentle learning curve. A reactive data binding       │
│ vue-core     │      3.4      │ system means the DOM updates automatically when state changes — no manual         │
│              │               │ intervention needed.                                                              │
├──────────────┼───────────────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Svelte       │               │ Compile-time framework that shifts work from runtime to build step, producing     │
│ svelte-kit   │     5.0       │ smaller bundles. Eliminates the virtual DOM overhead entirely — resulting in       │
│              │               │ faster initial page loads.                                                        │
├──────────────┼───────────────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Angular      │      17       │ Full-featured enterprise framework with dependency injection. Provides a          │
│ angular-cli  │               │ complete solution including routing, forms, and HTTP client out of the box.        │
├──────────────┼───────────────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Solid        │      1.8      │ Fine-grained reactivity without virtual DOM — components run once and update      │
│ solid-js     │               │ only the specific DOM nodes that changed (no re-rendering).                       │
├──────────────┼───────────────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Preact       │      10       │ Lightweight alternative to React — same API surface with a much smaller           │
│ preact-core  │               │ bundle size (3kB vs 40kB gzipped)                                                │
├──────────────┼───────────────┼──────────────────────────────────────────────────────────────────────────────────┤
│ Htmx +       │ Mixed         │ Hypermedia-driven approach using HTML attributes — reduces client-side            │
│ Alpine + JSX │               │ JavaScript complexity significantly                                               │
└──────────────┴───────────────┴──────────────────────────────────────────────────────────────────────────────────┘`;

  const html = convertCCOutput(input);
  const bodyHtml = html.split('<tbody>')[1]?.split('</tbody>')[0] || '';
  const dataRows = countOccurrences(bodyHtml, '<tr>');

  // 1 header + 7 data rows
  assert('Large table: 7 data rows', dataRows === 7,
    `Expected 7 data rows, got ${dataRows}`);

  // Check multi-line cell merges
  assertContains('Large: React merged', html, 'React react-dom');
  assertContains('Large: React version', html, '18.3 (latest stable)');
  assertContains('Large: Vue merged', html, 'Vue vue-core');
  assertContains('Large: Svelte version', html, '5.0');
  assertContains('Large: Htmx merged', html, 'Htmx + Alpine + JSX');

  // Long descriptions should be merged, not split
  assertContains('Large: React desc merged',
    html, 'virtual DOM to efficiently update the UI');
  assertContains('Large: trees in same cell',
    html, 'trees).');
}

// ============================================================
// Test 24: FAQ-style summary table with multi-line cells
// ============================================================
console.log('\n--- Test 24: Summary table ---');
{
  const input = `
┌──────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│     Question     │                                            Answer                                            │
├──────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Is it fast?      │ Yes — Rust + WASM + zero-copy parsing combine to deliver sub-millisecond response times       │
├──────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Is it secure?    │ Very — all processing happens client-side so no data ever leaves your browser                 │
├──────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Can plugins      │ Partially — you can't modify the core parser, but you can register custom block handlers to  │
│ extend it?       │ support new syntax. That's enough to significantly expand the formatting capabilities.        │
├──────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ How long to      │ 2-3 hours of reading the plugin API docs before you can write a production-ready custom       │
│ learn?           │ formatter                                                                                     │
├──────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Priority?        │ High — having consistent formatting across all team communications is a direct investment in  │
│                  │ clarity and productivity                                                                      │
└──────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘`;

  const html = convertCCOutput(input);
  const bodyHtml = html.split('<tbody>')[1]?.split('</tbody>')[0] || '';
  const dataRows = countOccurrences(bodyHtml, '<tr>');

  assert('Summary table: 5 data rows', dataRows === 5,
    `Expected 5 data rows, got ${dataRows}`);

  // Multi-line cells merged
  assertContains('Summary: plugins merged', html, 'Can plugins extend it?');
  assertContains('Summary: learn merged', html, 'How long to learn?');
  assertContains('Summary: answer merged', html, 'register custom block handlers to support new syntax');
}

// ============================================================
// Test 25: Table followed immediately by text
// ============================================================
console.log('\n--- Test 25: Table then text ---');
{
  const input = `
┌──────┬───────┐
│ A    │ B     │
├──────┼───────┤
│ 1    │ 2     │
└──────┴───────┘
This text comes right after the table.`;

  const html = convertCCOutput(input);
  assertContains('Table+text: has table', html, '<table');
  assertContains('Table+text: has paragraph', html, 'This text comes right after');
}

// ============================================================
// Test 26: Deeply wrapped bullet with multiple continuation lines
// ============================================================
console.log('\n--- Test 26: Multi-line bullet continuation ---');
{
  const input =
`- Database: Connection pooling means your active connections (primary, read replicas, analytics) are efficiently shared while
idle connections (background jobs, cron workers, monitoring) are automatically recycled/closed. Over time this can
reduce memory pressure, connection exhaustion, and database OOM errors.
- Cache: Short item.`;

  const html = convertCCOutput(input);
  const liCount = countOccurrences(html, '<li');

  assert('Deep wrap: 2 items', liCount === 2,
    `Expected 2 <li>, got ${liCount}`);
  assertContains('Deep wrap: all text merged',
    html, 'efficiently shared while idle connections');
  assertContains('Deep wrap: end merged',
    html, 'database OOM errors.');
}

// ============================================================
// Test 27: Empty input
// ============================================================
console.log('\n--- Test 27: Edge cases ---');
{
  assert('Empty string', convertCCOutput('') === '', 'Should return empty');
  assert('Whitespace only', convertCCOutput('   \n  \n  ').trim() === '', 'Should return empty');
}

// ============================================================
// Test 28: OSC 8 hyperlink stripping
// ============================================================
console.log('\n--- Test 28: OSC 8 hyperlinks ---');
{
  const input = `\x1b]8;;https://example.com\x07Click here\x1b]8;;\x07 for details.`;
  const html = convertCCOutput(input);

  assertNotContains('OSC8: no escape', html, '\x1b');
  assertContains('OSC8: text preserved', html, 'Click here');
}

// ============================================================
// Test 29: Table starting with │ (no top border visible)
// ============================================================
console.log('\n--- Test 29: Table without top border ---');
{
  const input = `│ Name │ Value │
│ test │ 123   │`;

  const html = convertCCOutput(input);
  assertContains('No top border: parsed as table', html, '<table');
}

// ============================================================
// Test 30: Inline formatting inside table cells
// ============================================================
console.log('\n--- Test 30: Formatted table cells ---');
{
  const input = `
┌────────────┬─────────────────────┐
│ Feature    │ Status              │
├────────────┼─────────────────────┤
│ **Bold**   │ \`code\` works here  │
└────────────┴─────────────────────┘`;

  const html = convertCCOutput(input);
  assertContains('Formatted cells: bold', html, '<strong>Bold</strong>');
  assertContains('Formatted cells: code', html, '>code</code>');
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.detail}`));
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
