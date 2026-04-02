// claudypasta — Converter Engine
// Converts Claude Code terminal output to email-ready HTML.
// Works in both browser and Node.js contexts.

function convertCCOutput(raw) {
  // Strip ANSI escape codes (CSI sequences)
  let text = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  // Strip OSC sequences (title setting, hyperlinks, etc.)
  text = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  // Strip remaining control chars (keep \n and \t)
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  // Normalize line endings: \r\n → \n, stray \r → \n
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Strip trailing whitespace per line (terminals pad with spaces)
  text = text.replace(/[ \t]+$/gm, '');

  const lines = text.split('\n');
  // Pre-process: unwrap terminal-wrapped lines before block parsing
  const unwrapped = unwrapLines(lines);
  const blocks = parseBlocks(unwrapped);
  return renderBlocks(blocks);
}

// ---- Smart Line Unwrapper ----
// Terminal output wraps at a fixed width, creating hard newlines mid-sentence.
// CC also sometimes inserts blank lines within parenthetical expressions when wrapping.
// This pre-processor rejoins those wrapped lines while preserving real paragraph breaks.

function isStructuralLine(line) {
  const t = line.trimStart();
  if (/^[┌╭╔│║└╰╚├╠]/.test(t)) return true; // box-drawing table
  if (/^\|.+\|$/.test(t)) return true; // pipe table row
  if (t.startsWith('```')) return true; // code fence
  if (/^(#{1,6})\s+/.test(t)) return true; // header
  if (t.startsWith('> ')) return true; // blockquote
  if (/^[-*+]\s+/.test(t)) return true; // unordered list item
  if (/^\d+[.)]\s+/.test(t)) return true; // ordered list item
  if (/^(\s*[-*_]\s*){3,}$/.test(line)) return true; // horizontal rule
  return false;
}

function hasUnclosedBracket(text) {
  let parens = 0, brackets = 0;
  for (const ch of text) {
    if (ch === '(') parens++;
    else if (ch === ')') parens = Math.max(0, parens - 1);
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
  }
  return parens > 0 || brackets > 0;
}

function looksLikeContinuation(prevLine, currentLine) {
  const prev = prevLine.trim();
  const curr = currentLine.trim();
  if (!prev || !curr) return false;

  // Current line starts with lowercase → almost certainly a continuation
  if (/^[a-z]/.test(curr)) return true;

  // Prev line ends with connector punctuation → continuation
  if (/[,;:\-–—]$/.test(prev)) return true;

  // Prev has unclosed parentheses/brackets → still mid-expression
  if (hasUnclosedBracket(prev)) return true;

  // Prev ends with a word (no sentence-ending punct) → likely wrapped
  if (!/[.!?)]$/.test(prev) && /\w$/.test(prev)) return true;

  return false;
}

function shouldBridgeBlankLine(prevLine, nextLine) {
  // More conservative than looksLikeContinuation — only bridge blank lines
  // when we're very confident it's a wrapping artifact, not a real paragraph break.
  const prev = prevLine.trim();
  const next = nextLine.trim();
  if (!prev || !next) return false;

  // Strongest signal: unclosed parentheses/brackets in accumulated text
  if (hasUnclosedBracket(prev)) return true;

  // Prev ends with comma/semicolon and next continues with lowercase or digit
  if (/[,;]$/.test(prev) && /^[a-z0-9]/.test(next)) return true;

  // Prev ends with a conjunction word and next starts lowercase
  if (/\b(and|or|but|nor|yet|so)$/i.test(prev) && /^[a-z]/.test(next)) return true;

  // Prev doesn't end with sentence punctuation and next starts lowercase
  if (!/[.!?:)]$/.test(prev) && /^[a-z]/.test(next)) return true;

  return false;
}

function unwrapLines(lines) {
  const result = [];
  let i = 0;
  let inCodeFence = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code fences — never unwrap inside them
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      result.push(line);
      i++;
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      i++;
      continue;
    }

    // Structural lines (tables, headers, code fences, lists) pass through
    if (trimmed && isStructuralLine(line)) {
      // For list items, check if next lines are wrapped continuations
      if (/^[\s]*[-*+]\s+/.test(line) || /^[\s]*\d+[.)]\s+/.test(line)) {
        let merged = line;
        i++;
        while (i < lines.length) {
          const next = lines[i];
          const nextTrimmed = next.trim();
          if (nextTrimmed && !isStructuralLine(next) && looksLikeContinuation(merged, next)) {
            merged = merged.trimEnd() + ' ' + next.trimStart();
            i++;
            continue;
          }
          break;
        }
        result.push(merged);
        continue;
      }
      result.push(line);
      i++;
      continue;
    }

    // Blank lines pass through (unless consumed by bridging below)
    if (!trimmed) {
      result.push(line);
      i++;
      continue;
    }

    // Plain text line: try to merge with following lines
    let merged = line;
    i++;

    while (i < lines.length) {
      const next = lines[i];
      const nextTrimmed = next.trim();

      // Case 1: direct continuation (next line is non-blank text)
      if (nextTrimmed && !isStructuralLine(next) && looksLikeContinuation(merged, next)) {
        merged = merged.trimEnd() + ' ' + next.trimStart();
        i++;
        continue;
      }

      // Case 2: blank line that might be a wrapping artifact — peek past it
      if (!nextTrimmed && i + 1 < lines.length) {
        const afterBlank = lines[i + 1];
        if (afterBlank.trim() && !isStructuralLine(afterBlank)
            && shouldBridgeBlankLine(merged, afterBlank)) {
          // Bridge: skip blank, merge with the line after it
          merged = merged.trimEnd() + ' ' + afterBlank.trimStart();
          i += 2;
          continue;
        }
      }

      break;
    }

    result.push(merged);
  }

  return result;
}

// ---- Block Parser ----

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Box-drawing table detection
    if (isBoxTableStart(trimmed)) {
      const { table, endIndex } = parseBoxTable(lines, i);
      blocks.push({ type: 'table', data: table });
      i = endIndex + 1;
      continue;
    }

    // Markdown pipe table detection
    if (isPipeTableRow(trimmed) && i + 1 < lines.length && isPipeSeparator(lines[i + 1].trimStart())) {
      const { table, endIndex } = parsePipeTable(lines, i);
      blocks.push({ type: 'table', data: table });
      i = endIndex + 1;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      i++; // skip closing ```
      continue;
    }

    // Horizontal rule
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Headers
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headerMatch) {
      blocks.push({ type: 'header', level: headerMatch[1].length, content: headerMatch[2] });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i++;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+[.)]\s+/.test(line)) {
      const startMatch = line.match(/^[\s]*(\d+)[.)]\s+/);
      const start = startMatch ? parseInt(startMatch[1], 10) : 1;
      const items = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items, start });
      continue;
    }

    // Empty line
    if (!trimmed) {
      blocks.push({ type: 'empty' });
      i++;
      continue;
    }

    // Paragraph text (collect consecutive non-empty, non-special lines)
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !isSpecialLine(lines, i)) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join(' ') });
    } else {
      i++;
    }
  }

  return blocks;
}

function isSpecialLine(lines, i) {
  const line = lines[i];
  const trimmed = line.trimStart();
  if (isBoxTableStart(trimmed)) return true;
  if (isPipeTableRow(trimmed) && i + 1 < lines.length && isPipeSeparator(lines[i + 1].trimStart())) return true;
  if (trimmed.startsWith('```')) return true;
  if (/^(#{1,6})\s+/.test(trimmed)) return true;
  if (trimmed.startsWith('> ')) return true;
  if (/^[-*+]\s+/.test(trimmed)) return true;
  if (/^\d+[.)]\s+/.test(trimmed)) return true;
  if (/^(\s*[-*_]\s*){3,}$/.test(line)) return true;
  return false;
}

// ---- Box-drawing table parser ----

const BOX_CHARS = '┌┐└┘├┤┬┴┼─│╭╮╰╯╔╗╚╝╠╣╦╩╬═║';

function isBoxTableStart(line) {
  return /^[┌╭╔]/.test(line) || (/^[│║]/.test(line) && /[│║]\s*$/.test(line));
}

function parseBoxTable(lines, start) {
  let i = start;
  const tableLines = [];

  while (i < lines.length) {
    const t = lines[i].trimStart();
    if (!t) break;
    const hasBoxChar = [...t].some(ch => BOX_CHARS.includes(ch));
    if (!hasBoxChar) break;
    tableLines.push(t);
    i++;
  }

  // Parse data rows, merging multi-line cells between border lines
  const rows = [];
  let currentRowCells = null;

  for (let j = 0; j < tableLines.length; j++) {
    const tl = tableLines[j];
    const isBorder = /^[┌┐└┘├┤┬┴┼─╭╮╰╯╔╗╚╝╠╣╦╩╬═║\s]+$/.test(tl);

    if (isBorder) {
      if (currentRowCells !== null) {
        rows.push(currentRowCells);
        currentRowCells = null;
      }
      continue;
    }

    if (/[│║]/.test(tl)) {
      const cells = tl.split(/[│║]/).slice(1, -1).map(c => c.trim());
      if (currentRowCells === null) {
        currentRowCells = cells;
      } else {
        for (let ci = 0; ci < cells.length && ci < currentRowCells.length; ci++) {
          if (cells[ci]) {
            currentRowCells[ci] = currentRowCells[ci]
              ? currentRowCells[ci] + ' ' + cells[ci]
              : cells[ci];
          }
        }
      }
    }
  }
  if (currentRowCells !== null) {
    rows.push(currentRowCells);
  }

  return {
    table: { headers: rows.length > 1 ? rows[0] : null, rows: rows.length > 1 ? rows.slice(1) : rows },
    endIndex: i - 1
  };
}

// ---- Markdown pipe table parser ----

function isPipeTableRow(line) {
  return /^\|.+\|$/.test(line.trim());
}

function isPipeSeparator(line) {
  return /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|$/.test(line.trim());
}

function parsePipeTable(lines, start) {
  let i = start;
  const headers = lines[i].trim().split('|').slice(1, -1).map(c => c.trim());
  i += 2; // skip header + separator

  const rows = [];
  while (i < lines.length && isPipeTableRow(lines[i].trimStart())) {
    rows.push(lines[i].trim().split('|').slice(1, -1).map(c => c.trim()));
    i++;
  }

  return {
    table: { headers, rows },
    endIndex: i - 1
  };
}

// ---- Renderer ----

function renderBlocks(blocks) {
  return blocks.map(block => {
    switch (block.type) {
      case 'table': return renderTable(block.data);
      case 'code': return renderCode(block);
      case 'header': return `<h${block.level} style="margin:16px 0 8px;color:#1f2328;">${inlineFormat(esc(block.content))}</h${block.level}>`;
      case 'paragraph': return `<p style="margin:6px 0;">${inlineFormat(esc(block.content))}</p>`;
      case 'ul': return `<ul style="margin:8px 0;padding-left:24px;">${block.items.map(it => `<li style="margin:4px 0;">${inlineFormat(esc(it))}</li>`).join('')}</ul>`;
      case 'ol': {
        const startAttr = block.start && block.start !== 1 ? ` start="${block.start}"` : '';
        return `<ol${startAttr} style="margin:8px 0;padding-left:24px;">${block.items.map(it => `<li style="margin:4px 0;">${inlineFormat(esc(it))}</li>`).join('')}</ol>`;
      }
      case 'blockquote': return `<blockquote style="border-left:3px solid #d0d7de;padding-left:12px;color:#656d76;margin:8px 0;">${inlineFormat(esc(block.content))}</blockquote>`;
      case 'hr': return '<hr style="border:none;border-top:1px solid #d0d7de;margin:12px 0;">';
      case 'empty': return '';
      default: return '';
    }
  }).join('\n');
}

function renderTable(data) {
  const thStyle = 'border:1px solid #d0d7de;padding:6px 12px;text-align:left;background:#f6f8fa;font-weight:600;';
  const tdStyle = 'border:1px solid #d0d7de;padding:6px 12px;text-align:left;';

  let html = '<table style="border-collapse:collapse;width:100%;margin:8px 0;">';

  if (data.headers) {
    html += '<thead><tr>';
    data.headers.forEach(h => {
      html += `<th style="${thStyle}">${inlineFormat(esc(h))}</th>`;
    });
    html += '</tr></thead>';
  }

  html += '<tbody>';
  data.rows.forEach((row, ri) => {
    const bgStyle = ri % 2 === 1 ? 'background:#f6f8fa;' : '';
    html += '<tr>';
    row.forEach(cell => {
      html += `<td style="${tdStyle}${bgStyle}">${inlineFormat(esc(cell))}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';

  return html;
}

function renderCode(block) {
  const content = esc(block.content);
  return `<pre style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:12px;overflow-x:auto;margin:8px 0;font-family:'SF Mono','Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;"><code>${content}</code></pre>`;
}

function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(str) {
  // Bold: **text** or __text__
  str = str.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  str = str.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic: *text* or _text_ (but not inside words for _)
  str = str.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '<em>$1</em>');
  str = str.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '<em>$1</em>');
  // Inline code: `text`
  str = str.replace(/`([^`]+)`/g, '<code style="background:#eff1f3;padding:2px 6px;border-radius:4px;font-family:\'SF Mono\',\'Cascadia Code\',monospace;font-size:0.9em;">$1</code>');
  // Strikethrough: ~~text~~
  str = str.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Links: [text](url) - only allow safe URL schemes
  str = str.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const safeUrl = /^(https?:\/\/|mailto:|#)/.test(url.trim()) ? url : '#';
    return `<a href="${safeUrl}" style="color:#0969da;">${text}</a>`;
  });
  return str;
}

// Node.js exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convertCCOutput, unwrapLines, parseBlocks, renderBlocks,
    parseBoxTable, parsePipeTable, isBoxTableStart, isPipeTableRow,
    isStructuralLine, looksLikeContinuation, esc, inlineFormat
  };
}
