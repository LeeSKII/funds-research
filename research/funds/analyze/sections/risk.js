// research/funds/analyze/sections/risk.js — 风险 tab extractor.
//
// Extracts the three sub-blocks of the 风险 tab:
//   1. 性价比    (sharpe/calmar/sortino)      — caveat-row {fund,peer} pairs via pairAfter
//   2. 风险和波动 (stdDev / maxDrawdown /        — ALL 4 rows are caveat {fund,peer} pairs via pairAfter
//                   downsideRisk / morningstarRisk)  (4-col table: 指标 | 同类表现 | 本基金 | 同类平均)
//   3. 相对收益  (alpha/beta/R2/excessReturn/   — all numAfter singletons (no peer column shown)
//                   trackingError/infoRatio/
//                   monthlyWinRate/upsideCapture/
//                   downsideCapture)
//
// Layout gotchas:
//   - pairAfter accepts the FULL caveat set (优于X%同类 | 负值/正值暂不排名 | 暂不排名), so
//     calmar/sortino survive on funds whose ratio went negative (this fund: 负值暂不排名).
//   - 标准差 appears TWICE in the page (once as chart-axis 标准差%, once as 风险和波动 row 标准差).
//     Scope std/maxDrawdown/downsideRisk searches with from=idx('风险和波动') so the chart label
//     doesn't shadow the real row.
//   - capture ratios can exceed 100 (QDII downsideCapture 178.61) — DO NOT clamp.
//   - Beta/R2 caveat column shows "—" instead of a percentile; the value follows on the SAME caveat
//     line (e.g. "\t—\t\t0.93"). numAfter's parseNum skips the em-dash and still grabs 0.93 because
//     the line is not EXACTLY "—".

const {
  lineIdx, numAfter, pairAfter,
} = require('../shared');

/**
 * Extract the 风险 tab block.
 * @param {string[]} lines  page innerText split on '\n'
 * @param {{code:string}} _ctx  fund code (unused here; present for signature uniformity)
 * @returns {object} risk block per fund-dossier.schema.json
 */
function extractRisk(lines, _ctx) {
  try {
    // ---- 1. 性价比 pairs (sharpe/calmar/sortino) ----
    const sharpe = pairAfter(lines, '夏普比率');
    const calmar = pairAfter(lines, '卡玛比率');
    const sortino = pairAfter(lines, '索提诺比率');

    // ---- 2. 风险和波动 block (4 caveat pairs: stdDev / maxDrawdown / downsideRisk / morningstarRisk) ----
    // All 4 rows share the 4-col layout 指标 | 同类表现 | 本基金 | 同类平均, so each is a {fund,peer} pair.
    // Scope past the chart axis label so '标准差' resolves to the data row, not the axis.
    const volStart = lineIdx(lines, '风险和波动');
    const stdDev = pairAfter(lines, '标准差', { from: volStart });
    const maxDrawdown = pairAfter(lines, '最大回撤', { from: volStart });
    const downsideRisk = pairAfter(lines, '下行风险', { from: volStart });
    const morningstarRisk = pairAfter(lines, '晨星风险', { from: volStart });  // 4th 风险和波动 row: {fund,peer}

    // ---- 3. 相对收益 block (all singletons, no peer column) ----
    const relStart = lineIdx(lines, '相对收益');
    const alpha = numAfter(lines, 'Alpha', { from: relStart });
    const beta = numAfter(lines, 'Beta', { from: relStart });
    const rSquared = numAfter(lines, 'R2', { from: relStart });
    const excessReturn = numAfter(lines, '超额收益', { from: relStart });
    const trackingError = numAfter(lines, '跟踪误差', { from: relStart });
    const infoRatio = numAfter(lines, '信息比率', { from: relStart });
    const monthlyWinRate = numAfter(lines, '月度胜率', { from: relStart });
    const upsideCapture = numAfter(lines, '涨势捕获率', { from: relStart });
    const downsideCapture = numAfter(lines, '跌势捕获率', { from: relStart });

    return {
      sharpe,
      calmar,
      sortino,
      stdDev,
      maxDrawdown,
      downsideRisk,
      morningstarRisk,
      alpha,
      beta,
      rSquared,
      excessReturn,
      trackingError,
      infoRatio,
      monthlyWinRate,
      upsideCapture,
      downsideCapture,
    };
  } catch {
    // Never throw — return a null block so the dossier still assembles.
    return {
      sharpe: null, calmar: null, sortino: null, stdDev: null,
      maxDrawdown: null, downsideRisk: null, morningstarRisk: null, alpha: null, beta: null,
      rSquared: null, excessReturn: null, trackingError: null, infoRatio: null,
      monthlyWinRate: null, upsideCapture: null, downsideCapture: null,
    };
  }
}

module.exports = { extractRisk };
