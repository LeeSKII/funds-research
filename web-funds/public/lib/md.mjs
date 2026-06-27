// lib/md.mjs — PURE minimal markdown→HTML renderer (0 deps).
// Covers ONLY the subset research/funds/analyze/report.js emits:
//   # H1, ## H2, > blockquote, | tables | (with |---| separator), - /   - nested bullets,
//   **bold**, `code`, --- hr, paragraphs. NOT a general markdown parser.
// Pure string→string, so it's unit-testable without a DOM.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  let t = esc(s);
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/`([^`]+?)`/g, '<code>$1</code>');
  return t;
}

function parseRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

// Render a contiguous run of "- " items (with optional 2-space indent nesting) as a nested <ul>.
// Indent levels are normalized to depth (0=top, 1=nested, ...) by 2-space steps. Nested <ul> goes
// INSIDE the parent <li> (valid HTML), so the parent li is closed only after its children.
function renderList(items) {
  const base = items[0]?.indent ?? 0;
  let html = '';
  let curDepth = -1;
  for (let k = 0; k < items.length; k++) {
    const d = Math.max(0, Math.round((items[k].indent - base) / 2));
    if (d > curDepth) { for (let j = curDepth + 1; j <= d; j++) html += '<ul>'; curDepth = d; }
    else if (d < curDepth) { while (curDepth > d) { html += '</li></ul>'; curDepth--; } html += '</li>'; }
    else { html += '</li>'; }
    html += `<li>${inline(items[k].text)}`;
  }
  while (curDepth >= 0) { html += '</li></ul>'; curDepth--; }
  return html;
}

export function mdToHtml(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // headings
    if (/^#\s+/.test(line)) { out.push(`<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`); i++; continue; }
    if (/^##\s+/.test(line)) { out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`); i++; continue; }
    // hr
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // blockquote
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }
    // table: a | line followed by a |---| separator line
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = parseRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      const thead = `<thead><tr>${header.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }
    // list (consecutive "- " lines, 2-space indent = nested)
    if (/^\s*-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)-\s+(.*)$/);
        items.push({ indent: m[1].length, text: m[2] });
        i++;
      }
      out.push(renderList(items));
      continue;
    }
    // paragraph
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  return out.join('\n');
}
