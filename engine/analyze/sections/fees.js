// engine/analyze/sections/fees.js — 费用 tab section extractor.
//
// Extracts the 5 canonical fee fields from the 费用 tab:
//   ter             — 综合费率 from the top SUMMARY block (value AFTER the label, layout c).
//                     Anchors on the FIRST `综合费率` occurrence, which is the summary KPI strip
//                     (line 23 in 005827), NOT the 费率与成本 waterfall `综合费率 1.51%` (layout b).
//   managementFee   — 管理费(每年) prospectus row (购买费用 block, value ON the anchor line, layout b).
//   custodianFee    — 托管费(每年) prospectus row (layout b).
//   salesServiceFee — 销售服务费(每年) prospectus row (layout b); null when the row reads
//                     该份额不收取销售服务费 (parseNum returns null on the Chinese text).
//   minInvestment   — 最小投资额度 → value on a later line (layout c via numAfter); the row is
//                     `最小投资额度\t\n申购\t1元`, so numAfter skips the empty line and parses `1元`.
//
// CRITICAL GOTCHA (v1.0 bug, per spec): the 费率与成本 waterfall has its OWN rows
//   `管理费(年)` / `托管费(年)` / `销售服务费(年)` (no 每, layout a — value BEFORE label).
// These are NOT the anchors. We anchor EXCLUSIVELY on the prospectus labels WITH 每:
//   `管理费(每年)` / `托管费(每年)` / `销售服务费(每年)`.
// Using `管理费(年)` would also substring-match `管理费(每年)` because `(年)` is a prefix of `(每年)` —
// but since we use the EXACT `(每年)` string in numOnLine, lineIdx finds the prospectus row first and
// we never read the waterfall. The waterfall rows use layout (a) (value before label), so even if a
// naive anchor hit them, numOnLine (layout b) would return null — defense in depth.
//
// purchaseFeeTiers / redemptionFeeTiers are intentionally NOT extracted (per spec: optional, skip).

const {
  numAfter,
  numOnLine,
} = require('../shared');

/**
 * Extract the 费用 tab block.
 * @param {string[]} lines  innerText split on newline.
 * @param {{code?: string}} ctx  fund code (unused by this section, present for shape parity).
 * @returns {{ter:number|null, managementFee:number|null, custodianFee:number|null,
 *            salesServiceFee:number|null, minInvestment:number|null}}
 */
function extractFees(lines, ctx) {
  const block = {
    ter: null,
    managementFee: null,
    custodianFee: null,
    salesServiceFee: null,
    minInvestment: null,
  };
  if (!Array.isArray(lines) || lines.length === 0) return block;

  try {
    // 综合费率 — top summary strip (first occurrence). Value on the line AFTER.
    block.ter = numAfter(lines, '综合费率');

    // Prospectus (购买费用) rows — value ON the anchor line, layout (b).
    // Anchor on the 每 variant to avoid the 费率与成本 waterfall rows.
    block.managementFee = numOnLine(lines, '管理费(每年)');
    block.custodianFee = numOnLine(lines, '托管费(每年)');
    // 该份额不收取销售服务费 → parseNum returns null → stays null. Correct.
    block.salesServiceFee = numOnLine(lines, '销售服务费(每年)');

    // 最小投资额度 — row is `最小投资额度\t\n申购\t1元`; numAfter skips the empty line, parses `1元`.
    block.minInvestment = numAfter(lines, '最小投资额度');
  } catch {
    // Null-safe: never throw. Partial block is returned with nulls for any field that failed.
  }

  return block;
}

module.exports = { extractFees };
