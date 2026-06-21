// engine/analyze/sections/performance.js — 业绩 TAB section extractor.
//
// Extracts: trailing returns (过往回报, period→本基金%), annual calendar returns
// (年度回报, year→本基金%), 晨星评级 (3Y/5Y/10Y stars), and Brinson 业绩归因 attribution
// (超额收益 / 行业配置 / 个股选择 + identity check 超额 ≈ 行业+个股).
//
// Layout gotchas (005827 verified, but generic):
//   • TWO `回报%` headers + TWO `本基金`/`同类平均`/`业绩比较基准` row groups live on the page —
//     one under 年度回报 (calendar years), one under 过往回报 (trailing periods). Scope every
//     tokensBetween/labelsBetween call with `from: <sectionIdx>` so trailing never bleeds into annual.
//   • 近两年 uses 两 (not 二) — shared.js PERIOD_RE covers both, regression-guarded.
//   • 晨星评级: 最新十年评级 often renders `—` for sub-10y funds → null.
//   • Brinson: the 业绩归因 label always renders. If the next ~8 lines contain 暂无/无业绩归因/暂未,
//     the section is `present:true, real:false, reason:'not_computed'` (ETF/QDII/HK). Else grab
//     超额收益/行业配置/个股选择 via numAfter (scanning forward 3 lines each from the 业绩归因 anchor)
//     and identity-check 超额 ≈ 行业+个股 (|Δ| < 0.5).
//
// Fresh port of parse-fund.js v1.1.1 extractReturns + extractBrinson against shared.js.

const {
  lineIdx, parseNum, numAfter,
  tokensBetween, labelsBetween,
  PERIOD_RE,
} = require('../shared');

const ANNUAL_YEAR_RE = /^20\d{2}$/;

/** Parse a 评级 value line ("1星" → 1, "—" → null). */
function parseRating(lines, anchor, from) {
  const i = lineIdx(lines, anchor, from);
  if (i < 0) return null;
  const next = (lines[i + 1] || '').trim();
  return parseNum(next.replace(/星/g, ''));
}

function extractTrailing(lines) {
  const out = { trailing: {}, trailingPeer: {} };
  const trIdx = lineIdx(lines, '过往回报');
  if (trIdx < 0) return out;
  const headers = labelsBetween(lines, '回报%', '本基金', PERIOD_RE, { from: trIdx });
  const fund = tokensBetween(lines, '本基金', '同类平均', { from: trIdx });
  const peer = tokensBetween(lines, '同类平均', '业绩比较基准', { from: trIdx });
  headers.forEach((h, i) => {
    out.trailing[h] = fund[i] ?? null;
    out.trailingPeer[h] = peer[i] ?? null;
  });
  return out;
}

function extractAnnual(lines) {
  const out = { annual: {}, annualPeer: {} };
  const anIdx = lineIdx(lines, '年度回报');
  if (anIdx < 0) return out;
  const headers = labelsBetween(lines, '回报%', '本基金', ANNUAL_YEAR_RE, { from: anIdx });
  const fund = tokensBetween(lines, '本基金', '同类平均', { from: anIdx });
  const peer = tokensBetween(lines, '同类平均', '业绩比较基准', { from: anIdx });
  headers.forEach((y, i) => {
    out.annual[y] = fund[i] ?? null;
    out.annualPeer[y] = peer[i] ?? null;
  });
  return out;
}

function extractRatings(lines) {
  // 晨星评级 block — anchor on the section header so we don't pick up 历史评级 rows.
  const sectIdx = lineIdx(lines, '晨星评级');
  const from = sectIdx >= 0 ? sectIdx : 0;
  return {
    rating3Y: parseRating(lines, '最新三年评级', from),
    rating5Y: parseRating(lines, '最新五年评级', from),
    rating10Y: parseRating(lines, '最新十年评级', from),
  };
}

function extractAttribution(lines) {
  const i = lineIdx(lines, '业绩归因');
  if (i < 0) return { present: false, real: false, reason: 'section_absent' };
  const head = lines.slice(i, i + 8).join(' ');
  if (/暂无|无业绩归因|暂未/.test(head)) {
    return { present: true, real: false, reason: 'not_computed' };
  }
  // grab only matches within ~40 lines of the 业绩归因 anchor (avoid the later 相对收益 超额收益 row).
  const grab = (label) => {
    const j = lineIdx(lines, label, i);
    if (j < 0 || j > i + 40) return null;
    return numAfter(lines, label, { from: i, maxScan: 3 });
  };
  const fundReturn = grab('基金收益');
  const benchReturn = grab('基准收益');
  const excess = grab('超额收益');
  const sector = grab('行业配置');
  const stock = grab('个股选择');
  const real = excess != null || sector != null || stock != null;
  const out = {
    present: true,
    real,
    reason: real ? null : 'values_missing',
    fundReturn,
    benchReturn,
    excess,
    sectorAllocation: sector,
    stockSelection: stock,
  };
  if (real && excess != null && sector != null && stock != null) {
    const recon = Math.round((sector + stock) * 100) / 100;
    out._identityCheck = {
      reconstructed: recon,
      delta: Math.round((excess - recon) * 100) / 100,
      ok: Math.abs(excess - recon) < 0.5,
    };
  }
  return out;
}

/**
 * Extract the 业绩 TAB block: trailing + annual returns + ratings + Brinson attribution.
 * @param {string[]} lines  innerText split on '\n'
 * @param {{ code?: string }} ctx
 * @returns {object} performance block (conforms to fund-dossier.schema.json#performance)
 */
function extractPerformance(lines, ctx) {
  ctx = ctx || {};
  void ctx; // ctx.code reserved for orchestrator/telemetry; section is page-structure-driven.
  const trailing = extractTrailing(lines);
  const annual = extractAnnual(lines);
  const ratings = extractRatings(lines);
  const attribution = extractAttribution(lines);
  return {
    trailing: trailing.trailing,
    trailingPeer: trailing.trailingPeer,
    annual: annual.annual,
    annualPeer: annual.annualPeer,
    ratings,
    attribution,
  };
}

module.exports = { extractPerformance };
