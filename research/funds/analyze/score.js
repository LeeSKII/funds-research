// analyze/score.js — 第三步核心编排器：dossier + heatmap → 多维判定卡。
// 哲学：#6 SectorFlow (非基金规模) + 多维分项 + flags + 4 句 narrative（不做单一黑箱打分）。
// size>100亿 = capacity_erosion 风险；size<2亿 = liquidation_risk。
const { sectorFlowScore } = require('./sectorflow-index');
const { detectTheme } = require('./theme-detector');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = x => Math.round((x + Number.EPSILON) * 1000) / 1000;

function scoreFund(dossier, { heatmap, config, computedAt }) {
  const flags = [];
  const a = dossier.performance && dossier.performance.attribution;

  // alphaQuality (#3)：Brinson 归因 → 真 α / 行业 β / 无归因三分。
  const aq = { value: 0, stockAlphaShare: null, tier: 'no_brinion', annualizedAlpha5y: null, tenureNorm: 0, identityCheckOk: null };
  // 🔴 ETF/指数/QDII 的 attribution 常为 {present:true, real:false, reason:'not_computed'} 或缺席。
  // 条件 a.real===true && excess≠0 才进入 Brinson 打分，否则 no_brinion。
  if (a && a.real === true && typeof a.excess === 'number' && a.excess !== 0) {
    const share = a.stockSelection / a.excess;
    aq.stockAlphaShare = round(share);
    const t = config.alphaQuality.tierThresholds;
    aq.tier = share >= t.trueAlpha ? 'true_alpha' : share >= t.industryBeta ? 'mixed' : 'industry_beta_pseudo';
    aq.identityCheckOk = a._identityCheck ? a._identityCheck.ok : null;
    const w = config.alphaQuality.weights;
    const tenureNorm = clamp(((dossier.manager && dossier.manager.maxTenureYears) || 0) / 10, 0, 1);
    aq.tenureNorm = round(tenureNorm);
    const alpha5y = (dossier.risk && dossier.risk.alpha) != null ? dossier.risk.alpha : null;
    aq.annualizedAlpha5y = alpha5y;
    const alphaNorm = alpha5y != null ? clamp(alpha5y / config.alphaQuality.alpha5yNormalizeDivisor, 0, 1) : 0;
    aq.value = round(w.stockAlphaRatio * clamp(share, 0, 1) + w.annualizedAlpha5yNorm * alphaNorm + w.tenureNorm * tenureNorm);
    if (aq.tier === 'true_alpha') flags.push('true_alpha');
    if (aq.tier === 'industry_beta_pseudo') flags.push('industry_beta_pseudo');
    if (aq.identityCheckOk === false) flags.push('data_noise');
  } else {
    flags.push('no_brinion');
  }

  const en = endorsementScore(dossier, config);
  if (en.flags) { flags.push(...en.flags); delete en.flags; }
  const bc = bandScore(dossier, config);
  const sf = sectorFlowScore(dossier, heatmap, config);
  const theme = detectTheme(dossier);
  const ra = riskAdjusted(dossier, config);
  if (ra.flags) { flags.push(...ra.flags); delete ra.flags; }
  const sizeRisk = sizeRiskOf(dossier, config);
  if (sizeRisk.flag !== 'ok' && sizeRisk.flag !== 'unknown') flags.push(sizeRisk.flag);

  return {
    code: dossier.description.code, name: dossier.description.name,
    asOfDate: dossier.description.asOfDate, bandWindowLabel: '年度近似（无逐日净值）',
    sizeRisk,
    scores: { alphaQuality: aq, endorsement: en, bandContribution: bc, sectorFlow: sf, theme, riskAdjusted: ra },
    flags: [...new Set(flags)],
    narrative: buildNarrative(dossier, { aq, sf, bc, theme }),
    provenance: { dossierFile: dossier.__file || null, dossierDate: (dossier._diagnostics && dossier._diagnostics.parsedAt) || null,
                  scriptVersion: '1.0.0', computedAt },
  };
}

// endorsement (#2)：机构/内部人/FOF/评级 加权背书。
function endorsementScore(d, cfg) {
  const w = cfg.endorsement.weights; const flags = [];
  const h = d.holders || {};
  const institutional = clamp((h.institutional || 0) / 100, 0, 1);
  const ins = h.insiders || {};
  const insiderStrong = ['managerSelf','executive','employee','companyDirect']
    .filter(k => ins[k] && ins[k].trend && ins[k].trend.direction === '增持').length / 4;
  if (ins.managerSelf && ins.managerSelf.trend && ins.managerSelf.trend.direction === '增持') flags.push('skin_in_game');
  const fofText = h.fofHeld || '';
  const fof = (/持有|FOF/.test(fofText) && !/暂未|没有|无/.test(fofText)) ? 1 : 0;
  if (fof) flags.push('fof_endorsed');
  const r = (d.performance && d.performance.ratings) || {};
  const ratings = clamp((((r.rating3Y || 0) + (r.rating5Y || 0)) / 2) / cfg.endorsement.ratingMax, 0, 1);
  const value = round(w.institutional * institutional + w.insiders * insiderStrong + w.fof * fof + w.ratings * ratings);
  return { value, institutional: h.institutional != null ? h.institutional : null, insiders: ins, fofHeld: fof ? true : (fofText || null), ratings: r, flags };
}

// bandContribution (#4)：年度跑赢同类比例 + 2022 熊市超额（无逐日净值 → 年度近似）。
function bandScore(d, cfg) {
  const annual = (d.performance && d.performance.annual) || {};
  const peer = (d.performance && d.performance.annualPeer) || {};
  const years = Object.keys(annual);
  if (years.length === 0) return { value: 0, annualExcess: [], consistencyRatio: 0, bear2022Excess: null, effectiveBandDensity: 0 };
  const annualExcess = years.map(y => ({ year: y, excess: round((annual[y] || 0) - (peer[y] || 0)) }));
  const beat = annualExcess.filter(x => x.excess > 0).length;
  const effective = annualExcess.filter(x => (annual[x.year] || 0) > 0 && x.excess > 0).length;
  const bear = annualExcess.find(x => x.year === String(cfg.band.bearYear));
  const ratio = round(beat / years.length);
  return { value: ratio, annualExcess, consistencyRatio: ratio, bear2022Excess: bear ? bear.excess : null, effectiveBandDensity: round(effective / years.length) };
}

// riskAdjusted：α/IR/r²/beta/捕获比 + low_benchmark_fit flag (r²<floor)。
function riskAdjusted(d, cfg) {
  const r = d.risk || {}; const flags = [];
  if (typeof r.rSquared === 'number' && r.rSquared < cfg.riskAdjusted.rSquaredTrustFloor) flags.push('low_benchmark_fit');
  const asymmetry = (r.upsideCapture != null && r.downsideCapture != null) ? r.upsideCapture / (Math.abs(r.downsideCapture) || 1) : null;
  let captureFlag = 'unknown';
  if (asymmetry != null) captureFlag = asymmetry >= 1.2 ? 'aggressive_upside' : asymmetry <= 0.8 ? 'defensive' : 'balanced';
  return { alpha: r.alpha != null ? r.alpha : null, infoRatio: r.infoRatio != null ? r.infoRatio : null, rSquared: r.rSquared != null ? r.rSquared : null,
           beta: r.beta != null ? r.beta : null, upsideCapture: r.upsideCapture != null ? r.upsideCapture : null,
           downsideCapture: r.downsideCapture != null ? r.downsideCapture : null, asymmetry: asymmetry != null ? round(asymmetry) : null, captureFlag, flags };
}

// sizeRisk：#6 反向锚定——规模≠景气，过大=容量侵蚀，过小=清盘风险。
function sizeRiskOf(d, cfg) {
  const aum = (d.description && d.description.aumYi) != null ? d.description.aumYi : null;
  if (aum == null) return { aumYi: null, flag: 'unknown' };
  if (aum > cfg.sizeRisk.capacityErosionYi) return { aumYi: aum, flag: 'capacity_erosion' };
  if (aum < cfg.sizeRisk.liquidationRiskYi) return { aumYi: aum, flag: 'liquidation_risk' };
  return { aumYi: aum, flag: 'ok' };
}

// narrative：4 句人类可读判定——押注什么 / 谁驱动 α / 板块流向裁定 / 区间表现。
function buildNarrative(d, { aq, sf, bc, theme }) {
  const topBet = theme.topSectorBets[0];
  const cluster0 = theme.holdingsCluster[0];
  const what = topBet || cluster0
    ? `重仓${(cluster0 && cluster0.industry) || (topBet && topBet.sector) || '—'}（持仓聚合 ${(cluster0 && cluster0.weightPct || 0).toFixed(1)}%${topBet ? `，超配 ${topBet.sector} ${(topBet.excess||0).toFixed(1)}%` : ''}）`
    : '行业暴露不明确';
  const sharePct = aq.stockAlphaShare != null ? (clamp(aq.stockAlphaShare,0,1)*100).toFixed(0) : '—';
  const who = aq.tier === 'no_brinion' ? '无 Brinson 归因（ETF/指数/QDII），用捕获比代理 α'
            : aq.tier === 'true_alpha' ? `选股贡献占超额 ${sharePct}%（真 α 选股型）`
            : aq.tier === 'industry_beta_pseudo' ? `行业配置主导（伪 α，${sharePct}% 选股）`
            : `选股/行业混合（${sharePct}% 选股）`;
  const sfv = `板块资金流向对齐度 ${(sf.prosperityAlignment*100).toFixed(0)}%，流动性 ${sf.liquidity.styleBoxTier || '未知'}`;
  const band = bc.consistencyRatio != null && bc.annualExcess.length
    ? `近 ${bc.annualExcess.length} 年 ${(bc.consistencyRatio*100).toFixed(0)}% 跑赢同类${bc.bear2022Excess!=null?`，2022 熊市超额 ${bc.bear2022Excess.toFixed(1)}%`:''}`
    : '无年度数据';
  return { whatItBetsOn: what, whoDrivesAlpha: who, sectorFlowVerdict: sfv, bandVerdict: band };
}

module.exports = { scoreFund, endorsementScore, bandScore, riskAdjusted, sizeRiskOf };
