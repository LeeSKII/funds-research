// research/funds/analyze/sections/holders.js — 持有人 tab extractor (v2 page-structure-aligned).
//
// Extracts:
//   institutional / retail   — 持有人结构 block: 机构 / 个人 value-after-label (layout c).
//   insiders                 — 内部人员持有 block, 4 fixed-order sub-sections:
//        基金经理自持 / 高管投研跟投 / 内部员工持有 / 基金公司直接持有.
//   fofHeld                  — 被FOF持有情况 line (truthy text or false when absent).
//   dividends                — 分红与拆分 line (text or null).
//
// LAYOUT GOTCHA — the insider sub-sections have 3 different micro-layouts but all share the
// same skeleton once you slice each sub-section to its bounded range (title → next title | end):
//   * value line precedes the literal `万份` token (so the shares magnitude sits on the line
//     BEFORE `万份`). For `经理自持`/`高管投研跟投` that value is `>100` (a bin label, not a
//     parseable number) — capture as a STRING `>100万份`, do NOT run it through parseNum.
//   * `估算金额` → next line is `>186 万元` / `2,982.5 万元` etc.
//   * `占总份额比例` → next line is a bare `0.18%`.
// The bounded-range approach means a missing optional field (e.g. no 占总份额比例 on 经理自持)
// simply yields pct:null — no cross-talk between sub-sections. Boundaries are anchored on the
// 4 fixed sub-section titles + the trailing `基金经理在管产品内部持有信息` header that closes
// the 内部人员持有 block. No fund-specific literals.

const {
  lineIdx, numAfter, parseNum,
} = require('../shared');

// The four insider sub-sections, in the fixed order they render on the page. Each title is
// searched for as a substring (robust to trailing whitespace / tab joins).
const INSIDER_TITLES = ['基金经理自持', '高管投研跟投', '内部员工持有', '基金公司直接持有'];
const INSIDER_KEYS = ['managerSelf', 'executive', 'employee', 'companyDirect'];
// Anything after the last insider sub-section that still belongs to 内部人员持有 (closes the block).
const INSIDER_BLOCK_END = '基金经理在管产品内部持有信息';

/**
 * Capture one insider sub-section as {shares, estAmount, pct} by scanning a bounded line range.
 * Bounded range = [titleLine+1, nextTitleLine) so fields never leak across sub-sections.
 * - shares:      line immediately preceding the literal `万份` token (string; bin labels like
 *                `>100` are preserved verbatim, magnitudes like `1,601.5` are normalised to the
 *                number). Joined as `<value>万份` so callers always see the unit.
 * - estAmount:   the line after `估算金额`.
 * - pct:         the numeric % after `占总份额比例` (null when the sub-section has no ratio row).
 */
function captureInsider(lines, lo, hi) {
  let shares = null;
  let estAmount = null;
  let pct = null;
  let trend = null;
  for (let i = lo; i < hi; i++) {
    const t = lines[i].trim();
    if (t === '万份') {
      const prev = (lines[i - 1] || '').trim();
      if (prev) {
        // Pure-magnitude rows (e.g. `1,601.5`, `7,046.2`) → normalise to the number + unit.
        // Bin-label rows (`>100`, `0-10`, `50-100`, `>100万份`) carry non-numeric prefix/suffix
        // chars; parseNum would silently drop the `>` and corrupt the bin → keep verbatim.
        const isPureMagnitude = /^-?[\d,]+\.?\d*$/.test(prev);
        shares = isPureMagnitude ? `${parseNum(prev)}万份` : `${prev}万份`;
      }
      // Trend marker (增持/减持/持平) sits on the line right AFTER `万份`; the change % follows
      // on the next line (or `无` / a non-numeric token when there is no change).
      const dir = (lines[i + 1] || '').trim();
      if (/^(增持|减持|持平)$/.test(dir)) {
        const chg = (lines[i + 2] || '').trim();
        trend = { direction: dir, changePct: /^-?\d/.test(chg) ? parseNum(chg) : null };
      }
    } else if (t === '估算金额') {
      const next = (lines[i + 1] || '').trim();
      if (next) estAmount = next;
    } else if (t === '占总份额比例') {
      const next = (lines[i + 1] || '').trim();
      pct = parseNum(next);
    }
  }
  // All-null sub-section means the block is absent on this page → caller drops it.
  if (shares == null && estAmount == null && pct == null && trend == null) return null;
  return { shares, estAmount, pct, trend };
}

/**
 * Extract the 持有人 tab block.
 * @param {string[]} lines  page innerText split on newline
 * @param {{code:string}} ctx
 * @returns {{institutional:number|null, retail:number|null, insiders:object, fofHeld:(string|boolean|null), dividends:(string|null)}}
 */
function extractHolders(lines, ctx) {
  // ── 持有人结构: 机构 / 个人 (value after label). ──────────────────────────
  let institutional = null;
  let retail = null;
  const hsIdx = lineIdx(lines, '持有人结构');
  if (hsIdx >= 0) {
    institutional = numAfter(lines, '机构', { from: hsIdx, maxScan: 4 });
    retail = numAfter(lines, '个人', { from: hsIdx, maxScan: 4 });
  }

  // ── 内部人员持有: 4 bounded sub-sections. ────────────────────────────────
  const insiders = {};
  // Block starts at 内部人员持有 (or fall back to the first insider title if the header is gone).
  let blockStart = lineIdx(lines, '内部人员持有');
  if (blockStart < 0) blockStart = lineIdx(lines, INSIDER_TITLES[0]);
  const blockEnd = lineIdx(lines, INSIDER_BLOCK_END);  // -1 if absent → scan to EOF

  for (let k = 0; k < INSIDER_TITLES.length; k++) {
    const title = INSIDER_TITLES[k];
    const from = blockStart >= 0 ? blockStart : 0;
    const titleLine = lineIdx(lines, title, from);
    if (titleLine < 0) continue;
    // Upper bound = next insider title after this one, or the block-end header, or EOF.
    let upper = lines.length;
    for (let j = k + 1; j < INSIDER_TITLES.length; j++) {
      const nextTitleLine = lineIdx(lines, INSIDER_TITLES[j], titleLine + 1);
      if (nextTitleLine >= 0) { upper = nextTitleLine; break; }
    }
    if (blockEnd > titleLine && blockEnd < upper) upper = blockEnd;
    const captured = captureInsider(lines, titleLine + 1, upper);
    if (captured != null) insiders[INSIDER_KEYS[k]] = captured;
  }

  // ── fofHeld: full text after 被FOF持有情况; false if the section is absent. ─
  let fofHeld = null;
  const fofIdx = lineIdx(lines, '被FOF持有情况');
  if (fofIdx >= 0) {
    const next = (lines[fofIdx + 1] || '').trim();
    fofHeld = next || null;
  }

  // ── dividends: full text after 分红与拆分. ───────────────────────────────
  let dividends = null;
  const divIdx = lineIdx(lines, '分红与拆分');
  if (divIdx >= 0) {
    const next = (lines[divIdx + 1] || '').trim();
    dividends = next || null;
  }

  return { institutional, retail, insiders, fofHeld, dividends };
}

module.exports = { extractHolders };
