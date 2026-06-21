// engine/analyze/sections/strategy.js — 策略 tab extractor for the v2 page-structure-aligned
// fund-detail dossier.
//
// Extracts the full-text 策略 block: 投资目标 / 投资范围 / 投资策略 / 业绩比较基准, plus the two
// long-form report texts — latestCommentary (季报 投资策略及运作分析) and outlook (年报 基金经理展望).
//
// LAYOUT GOTCHA (the hard part): each label is on its OWN line, followed by multi-paragraph free text
// that spans subsequent lines until the NEXT label begins. The text is rendered one paragraph per
// innerText line (paragraphs are NOT joined — they are separated by literal newlines). We join
// consecutive non-empty paragraphs with a single space (matches how the page reads as prose) so the
// consumer gets one coherent string per field. Empty lines are paragraph separators, not field
// terminators — only a recognized NEXT label terminates a block.
//
//   投资目标            ← label line
//   <objective...>      ← single-line value (terminated by 投资范围)
//   投资范围            ← label line
//   <scope para 1>      ← multi-line, terminated by 投资策略
//   <scope para 2>
//   ...
//   投资策略            ← label line
//   <strategy...>       ← multi-line, terminated by 业绩比较基准
//   业绩比较基准        ← label line
//   <benchmark formula> ← single-line (terminated by 投资策略及运作分析)
//   投资策略及运作分析  ← section label
//   2026年第一季报      ← report label (季报) → latestCommentary.report
//   <commentary text>   ← multi-line, terminated by 基金经理展望
//   基金经理展望        ← section label
//   2025年年报          ← report label (年报) → outlook.report
//   <outlook text>      ← multi-line, terminated by 相关基金
//
// All field boundaries use generic NEXT-label anchors (no fund-specific literals). Null-safe:
// a missing label yields null for its field and never throws.

const { lineIdx } = require('../shared');

/** Last index i (>= from) whose trimmed line === anchor exactly (exact-line, not substring). */
const lineIdxExactLast = (lines, anchor, from = 0) => {
  let found = -1;
  for (let i = from; i < lines.length; i++) if (lines[i].trim() === anchor) found = i;
  return found;
};
/** First index i (>= from) whose trimmed line === anchor exactly. */
const lineIdxExact = (lines, anchor, from = 0) => {
  for (let i = from; i < lines.length; i++) if (lines[i].trim() === anchor) return i;
  return -1;
};

// Ordered list of the four prospectus labels — each one terminates the previous block.
const OBJECTIVE_LABEL = '投资目标';
const SCOPE_LABEL = '投资范围';
const STRATEGY_LABEL = '投资策略';
const BENCHMARK_LABEL = '业绩比较基准';
const COMMENTARY_SECTION = '投资策略及运作分析';
const OUTLOOK_SECTION = '基金经理展望';
const NEXT_SECTION_AFTER_OUTLOOK = '相关基金';

// Report-label lines look like "2026年第一季报" / "2025年年报" — year + 第N季报|年报.
const REPORT_LABEL_RE = /^\d{4}年(第一季报|第二季报|第三季报|第四季报|半年报|年报)$/;

/**
 * Join the paragraphs of a text block: lines[start..end) (exclusive), skipping the
 * leading/trailing empties, joining non-empty lines with a single space. Returns null
 * when nothing is left after trimming.
 */
function joinBlock(lines, start, end) {
  if (start < 0 || end <= start) return null;
  const paras = [];
  for (let i = start; i < end && i < lines.length; i++) {
    const t = lines[i].trim();
    if (t) paras.push(t);
  }
  return paras.length ? paras.join(' ') : null;
}

/**
 * Find the FIRST line index in [from, endExclusive) whose trimmed content is exactly one of the
 * candidate labels (exact-line match, so a label embedded inside a paragraph never terminates).
 * Returns -1 if none.
 */
function findExactLabel(lines, candidates, from, endExclusive) {
  const set = new Set(candidates);
  const upper = endExclusive == null ? lines.length : Math.min(endExclusive, lines.length);
  for (let i = from; i < upper; i++) {
    if (set.has(lines[i].trim())) return i;
  }
  return -1;
}

/**
 * Extract a labeled text block: the label sits ALONE on its own line at `labelIdx`; the value is
 * the joined paragraphs from labelIdx+1 up to (but not including) the next exact-match label line
 * among `terminators`, or up to `hardEnd` if no terminator is found.
 */
function labeledBlock(lines, labelIdx, terminators, hardEnd) {
  if (labelIdx < 0) return null;
  const searchFrom = labelIdx + 1;
  const searchEnd = hardEnd == null ? lines.length : hardEnd;
  const termAt = findExactLabel(lines, terminators, searchFrom, searchEnd);
  const end = termAt >= 0 ? termAt : searchEnd;
  return joinBlock(lines, searchFrom, end);
}

/**
 * Extract the latest 季报 commentary under 投资策略及运作分析:
 * the report label line (e.g. 2026年第一季报) is the FIRST line after the section label,
 * followed by the long text until 基金经理展望. Returns { report, date, text }.
 */
function extractCommentary(lines, sectionIdx, endIdx) {
  const out = { report: null, date: null, text: null };
  if (sectionIdx < 0) return out;
  // report label is the first non-empty line after the section label.
  let reportIdx = -1;
  for (let i = sectionIdx + 1; i < endIdx; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    reportIdx = i;
    break;
  }
  if (reportIdx < 0) return out;
  const reportLabel = lines[reportIdx].trim();
  out.report = reportLabel;
  // Derive a date-ish token from the report label (e.g. 2026年第一季报 → 2026-Q1; 年报 → 2025).
  const m = reportLabel.match(/^(\d{4})年(第一季报|第二季报|第三季报|第四季报|半年报|年报)$/);
  if (m) {
    const year = m[1];
    const qmap = { '第一季报': 'Q1', '第二季报': 'Q2', '第三季报': 'Q3', '第四季报': 'Q4', '半年报': 'H1', '年报': '' };
    out.date = qmap[m[2]] ? `${year}-${qmap[m[2]]}` : year;
  }
  out.text = joinBlock(lines, reportIdx + 1, endIdx);
  return out;
}

/**
 * Extract the 年报 outlook under 基金经理展望: report label line (e.g. 2025年年报) is the FIRST
 * non-empty line after the section label, followed by the long text until 相关基金.
 */
function extractOutlook(lines, sectionIdx, endIdx) {
  const out = { report: null, date: null, text: null };
  if (sectionIdx < 0) return out;
  let reportIdx = -1;
  for (let i = sectionIdx + 1; i < endIdx; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    reportIdx = i;
    break;
  }
  if (reportIdx < 0) return out;
  const reportLabel = lines[reportIdx].trim();
  out.report = reportLabel;
  const m = reportLabel.match(/^(\d{4})年(年报|半年报|第一季报|第二季报|第三季报|第四季报)$/);
  if (m) {
    out.date = m[1]; // outlook reports are annual → year is the date.
  }
  out.text = joinBlock(lines, reportIdx + 1, endIdx);
  return out;
}

/**
 * Extract the 策略 tab block. Pure function of (lines, ctx); never throws.
 * @param {string[]} lines  innerText split on newline.
 * @param {{code:string}} ctx  fund code (for diagnostics; not used in extraction).
 * @returns {object} strategy block per fund-dossier.schema.json.
 */
function extractStrategy(lines, ctx) {
  const block = {
    objective: null,
    scope: null,
    strategy: null,
    benchmark: null,
    latestCommentary: { report: null, date: null, text: null },
    outlook: { report: null, date: null, text: null },
  };
  try {
    // Anchor off the LAST 策略 tab section heading. The label "策略" also appears earlier as a
    // tab-nav button in the page header; the SECTION heading is the final occurrence (sits just
    // before the 投资目标 label). Exact-line match avoids the substring 策略 appearing elsewhere.
    const tabIdx = lineIdxExactLast(lines, '策略');
    const searchFrom = tabIdx >= 0 ? tabIdx + 1 : 0;

    // All prospectus labels are matched EXACTLY (whole trimmed line === label). This is load-bearing:
    // 业绩比较基准 appears many times earlier as a chart-legend line ("业绩比较基准\t") and as a
    // substring inside the top-strip benchmark sentence; only the EXACT standalone line inside the
    // 策略 section is the real label. Exact matching also disambiguates 投资策略 (label) from
    // 投资策略及运作分析 (a different section header that contains the substring 投资策略).
    const objIdx = lineIdxExact(lines, OBJECTIVE_LABEL, searchFrom);
    const scopeIdx = lineIdxExact(lines, SCOPE_LABEL, searchFrom);
    const stratIdx = lineIdxExact(lines, STRATEGY_LABEL, searchFrom);
    const benchIdx = lineIdxExact(lines, BENCHMARK_LABEL, searchFrom);
    const commentarySec = lineIdxExact(lines, COMMENTARY_SECTION, searchFrom);
    const outlookSec = lineIdxExact(lines, OUTLOOK_SECTION, searchFrom);
    // Hard cap: the outlook text ends where 相关基金 (next tab's table) begins. Use shared lineIdx
    // (substring) here — 相关基金 appears once as the next-tab section header, so substring is safe
    // and tolerant of any trailing-tab variant on other fund templates.
    const afterOutlook = lineIdx(lines, NEXT_SECTION_AFTER_OUTLOOK, searchFrom);

    // ── four prospectus text fields ──────────────────────────────────────
    // objective: spans until 投资范围
    block.objective = labeledBlock(lines, objIdx, [SCOPE_LABEL], scopeIdx > objIdx ? scopeIdx : null);
    // scope: spans until 投资策略
    block.scope = labeledBlock(lines, scopeIdx, [STRATEGY_LABEL], stratIdx > scopeIdx ? stratIdx : null);
    // strategy: spans until 业绩比较基准
    block.strategy = labeledBlock(lines, stratIdx, [BENCHMARK_LABEL], benchIdx > stratIdx ? benchIdx : null);
    // benchmark: single formula line until 投资策略及运作分析
    block.benchmark = labeledBlock(
      lines,
      benchIdx,
      [COMMENTARY_SECTION],
      commentarySec > benchIdx ? commentarySec : null
    );

    // ── latestCommentary (季报) under 投资策略及运作分析, ends at 基金经理展望 ──
    const commentaryEnd = outlookSec > commentarySec ? outlookSec
      : (commentarySec >= 0 ? lines.length : null);
    block.latestCommentary = extractCommentary(lines, commentarySec, commentaryEnd == null ? lines.length : commentaryEnd);

    // ── outlook (年报) under 基金经理展望, ends at 相关基金 ──
    const outlookEnd = afterOutlook > outlookSec ? afterOutlook
      : (outlookSec >= 0 ? lines.length : null);
    block.outlook = extractOutlook(lines, outlookSec, outlookEnd == null ? lines.length : outlookEnd);
  } catch (_e) {
    // Null-safe by contract: never throw; whatever we have so far is returned.
  }
  return block;
}

module.exports = { extractStrategy };
