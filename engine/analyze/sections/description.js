// engine/analyze/sections/description.js — 顶部摘要条 + 身份 extractor for the v2
// page-structure-aligned fund-detail dossier.
//
// Extracts the top-of-page summary strip ONLY (layout c — label on one line, value on the next),
// plus identity facts that have no other tab home. Per the home-tab rule these are NOT pulled
// here even though they appear in the strip: 综合费率 (→fees.ter), 换手率 (→portfolio.turnover),
// 晨星评级 (→performance.ratings), 基金经理 names (→manager.team).
//
// LAYOUT GOTCHAS:
//   (1) 净值 shares its line with the NAV date — "净值 2026-06-18" — and the NAV number sits on
//       the NEXT line ("1.5258"). So navDate is parsed off the 净值 line itself, while nav uses
//       numAfter('净值'). Generic: the date is the first YYYY-MM-DD on the 净值 line.
//   (2) Values carrying a unit suffix — "267.93亿" (aumYi), "50,000元" (dailyPurchaseLimit),
//       "-0.60%" (dailyChangePct) — parseNum handles them (it greedily matches the numeric head
//       and discards the trailing unit; commas are stripped). So 267.93亿 → 267.93,
//       50,000元 → 50000, -0.60% → -0.6.
//   (3) asOfDate is buried mid-sentence on "业绩数据截至2026-05-31，业绩不足1年..." — extracted by
//       regex for the first YYYY-MM-DD after 截至.
//   (4) The summary strip lives at the TOP of the page; tab-nav labels (业绩/风险/费用/...) start
//       right after it. We bound every strip search above the first tab-nav label so a stray
//       anchor (e.g. a 单日申购限额 re-appearing under 费用) can never leak a wrong value.
//
// Null-safe: missing fields → null, never throws. ctx.code is the canonical fund code.

const { lineIdx, numAfter, parseNum } = require('../shared');

// First of the tab-nav labels that mark the END of the summary strip.
const STRIP_END_ANCHORS = ['业绩', '风险', '费用', '投资组合', '持有人', '策略'];

// First YYYY-MM-DD on a line (used for navDate and asOfDate).
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

/**
 * Return the line index of the FIRST tab-nav label after `from`, or lines.length if none.
 * All strip-field searches are bounded above this so a stray deeper-page match can't win.
 */
function stripEnd(lines, from) {
  const i = lineIdx(lines, '业绩', from);
  // 业绩 is the first tab label and always present; fall back to end-of-array defensively.
  return i >= 0 ? i : lines.length;
}

/**
 * Extract a value following a label, but ONLY if the label sits inside the summary strip
 * (label line index < stripEndIdx). Avoids a deeper-page anchor leaking into the identity block.
 * Returns the trimmed value string or null.
 */
function stripValueAfter(lines, label, stripEndIdx, from = 0) {
  const i = lineIdx(lines, label, from);
  if (i < 0 || i >= stripEndIdx) return null;
  // value is the next non-empty line
  for (let k = i + 1; k < Math.min(i + 1 + 4, lines.length, stripEndIdx + 1); k++) {
    const t = lines[k].trim();
    if (!t) continue;
    return t;
  }
  return null;
}

/**
 * Extract the top-of-page description / identity block.
 * Pure function of (lines, ctx); never throws.
 * @param {string[]} lines  innerText split on newline.
 * @param {{code:string}} ctx  fund code.
 * @returns {object} description block per fund-dossier.schema.json.
 */
function extractDescription(lines, ctx) {
  const block = {
    code: (ctx && ctx.code) ? String(ctx.code) : null,
    name: null,
    category: null,
    fundType: null,
    inceptionDate: null,
    currency: null,
    nav: null,
    navDate: null,
    dailyChangePct: null,
    riskLevel: null,
    styleBox: null,
    aumYi: null,
    dailyPurchaseLimit: null,
    purchaseStatus: null,
    redemptionStatus: null,
    lockupPeriod: null,
    custodian: null,
    asOfDate: null,
  };
  try {
    const end = stripEnd(lines, 0);

    // name = the fund title on line 1 (line 0 is "返回" back-button). Guard against leading
    // whitespace / a different chrome header by scanning the first few lines for the first
    // substantive non-numeric, non-button line.
    for (let i = 0; i < Math.min(end, 6); i++) {
      const t = lines[i] ? lines[i].trim() : '';
      if (!t) continue;
      if (t === '返回' || t === '加入自选') continue; // chrome buttons
      if (/^\d{6}$/.test(t)) continue; // the 6-digit code line
      if (/^\d+星$/.test(t)) continue; // rating badge ("1星")
      block.name = t;
      break;
    }

    // navDate: lives ON the 净值 line ("净值 2026-06-18"). Take the first date on that line.
    const navLineIdx = lineIdx(lines, '净值', 0);
    if (navLineIdx >= 0 && navLineIdx < end) {
      const m = lines[navLineIdx].match(DATE_RE);
      if (m) block.navDate = m[1];
    }
    // nav: numeric value on the line after the 净值 line.
    block.nav = numAfter(lines, '净值', { from: 0, maxScan: 2 });

    // dailyChangePct: "-0.60%" → -0.6
    block.dailyChangePct = numAfter(lines, '日涨跌幅', { from: 0, maxScan: 2 });

    // category: 晨星分类 → value
    block.category = stripValueAfter(lines, '晨星分类', end);
    // fundType: 基金类型 → value
    block.fundType = stripValueAfter(lines, '基金类型', end);
    // inceptionDate: 成立日期 → value
    block.inceptionDate = stripValueAfter(lines, '成立日期', end);
    // riskLevel: 风险等级 → value
    block.riskLevel = stripValueAfter(lines, '风险等级', end);
    // styleBox: 股票投资风格箱 → value
    block.styleBox = stripValueAfter(lines, '股票投资风格箱', end);
    // aumYi: 基金规模 → value, strip 亿
    block.aumYi = numAfter(lines, '基金规模', { from: 0, maxScan: 2 });
    // currency: 计价货币 → value
    block.currency = stripValueAfter(lines, '计价货币', end);
    // dailyPurchaseLimit: 单日申购限额 → value (e.g. "50,000元" → 50000)
    block.dailyPurchaseLimit = numAfter(lines, '单日申购限额', { from: 0, maxScan: 2 });
    // purchaseStatus: 申购状态 → value
    block.purchaseStatus = stripValueAfter(lines, '申购状态', end);
    // redemptionStatus: 赎回状态 → value
    block.redemptionStatus = stripValueAfter(lines, '赎回状态', end);
    // lockupPeriod: 锁定期 → value
    block.lockupPeriod = stripValueAfter(lines, '锁定期', end);
    // custodian: 托管人 → value
    block.custodian = stripValueAfter(lines, '托管人', end);

    // asOfDate: first YYYY-MM-DD on the "业绩数据截至" line (anywhere on the page).
    const asOfIdx = lineIdx(lines, '业绩数据截至', 0);
    if (asOfIdx >= 0) {
      const m = lines[asOfIdx].match(DATE_RE);
      if (m) block.asOfDate = m[1];
    }
  } catch (_e) {
    // Null-safe by contract: never throw; whatever we have so far is returned.
  }
  return block;
}

module.exports = { extractDescription };
