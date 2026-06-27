// lib/scoring.mjs — PURE port of research/funds/analyze/score.js (per-fund sub-scores).
// 🔴 sectorFlow is POOL-dependent → NOT ported (taken from card, see spec §5.1/§5.4).
// 🔴 theme is descriptive → NOT ported. Keep these two faithful-by-omission, not wrong.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;

export function sizeRiskOf(aumYi, cfg) {
  if (aumYi == null) return { aumYi: null, flag: 'unknown' };
  if (aumYi > cfg.capacityErosionYi) return { aumYi, flag: 'capacity_erosion' };
  if (aumYi < cfg.liquidationRiskYi) return { aumYi, flag: 'liquidation_risk' };
  return { aumYi, flag: 'ok' };
}

export function downsideQuality(downsCap, floor, ceil) {
  if (downsCap == null) return 0.5;
  if (downsCap < 0) return 1;
  return clamp((ceil - downsCap) / (ceil - floor), 0, 1);
}

// Signature: caller passes pre-extracted {attribution}, a riskLike bundle ({alpha}), the manager
// ({maxTenureYears}), and cfg. Mirrors score.js which reads dossier.risk.alpha + dossier.manager.maxTenureYears.
export function alphaQualityScore({ attribution }, riskLike, mgr, cfg) {
  const out = { value: 0, stockAlphaShare: null, tier: 'no_brinion', annualizedAlpha5y: null, tenureNorm: 0, identityCheckOk: null };
  const a = attribution;
  if (a && a.real === true && typeof a.excess === 'number' && a.excess !== 0) {
    const share = a.stockSelection / a.excess;
    out.stockAlphaShare = round3(share);
    const t = cfg.tierThresholds;
    out.tier = share >= t.trueAlpha ? 'true_alpha' : share >= t.industryBeta ? 'mixed' : 'industry_beta_pseudo';
    out.identityCheckOk = a._identityCheck ? a._identityCheck.ok : null;
    const tenureNorm = clamp(((mgr && mgr.maxTenureYears) || 0) / 10, 0, 1);
    out.tenureNorm = round3(tenureNorm);
    const alpha5y = (riskLike && riskLike.alpha != null) ? riskLike.alpha : null;
    out.annualizedAlpha5y = alpha5y;
    const alphaNorm = alpha5y != null ? clamp(alpha5y / cfg.alpha5yNormalizeDivisor, 0, 1) : 0;
    const w = cfg.weights;
    out.value = round3(w.stockAlphaRatio * clamp(share, 0, 1) + w.annualizedAlpha5yNorm * alphaNorm + w.tenureNorm * tenureNorm);
  }
  return out;
}

const USD_NEG = /暂未|没有|无/;
export function endorsementScore({ holders }, { ratings }, cfg) {
  const w = cfg.weights;
  const h = holders || {};
  const institutional = clamp((h.institutional || 0) / 100, 0, 1);
  const ins = h.insiders || {};
  const insiderStrong = ['managerSelf', 'executive', 'employee', 'companyDirect']
    .filter((k) => ins[k] && ins[k].trend && ins[k].trend.direction === '增持').length / 4;
  const fofText = h.fofHeld || '';
  const fof = (/20\d{2}/.test(fofText) && /持有|FOF/.test(fofText) && !USD_NEG.test(fofText)) ? 1 : 0;
  const r = ratings || {};
  const ratingsNorm = clamp((((r.rating3Y || 0) + (r.rating5Y || 0)) / 2) / cfg.ratingMax, 0, 1);
  const value = round3(w.institutional * institutional + w.insiders * insiderStrong + w.fof * fof + w.ratings * ratingsNorm);
  return { value, institutional: h.institutional != null ? h.institutional : null, fofHeld: fof ? true : (fofText || null), ratings: r };
}

export function bandContributionScore({ annual, annualPeer }, cfg) {
  const a = annual || {}, p = annualPeer || {};
  const years = Object.keys(a);
  if (years.length === 0) return { value: 0, annualExcess: [], consistencyRatio: 0, bear2022Excess: null, effectiveBandDensity: 0 };
  const annualExcess = years.map((y) => ({ year: y, excess: round3((a[y] || 0) - (p[y] || 0)) }));
  const beat = annualExcess.filter((x) => x.excess > 0).length;
  const bear = annualExcess.find((x) => x.year === String(cfg.bearYear));
  const ratio = round3(beat / years.length);
  return { value: ratio, annualExcess, consistencyRatio: ratio, bear2022Excess: bear ? bear.excess : null,
           effectiveBandDensity: round3(annualExcess.filter((x) => (a[x.year] || 0) > 0 && x.excess > 0).length / years.length) };
}

export function riskAdjusted(risk, cfg) {
  const r = risk || {}; const flags = [];
  if (typeof r.rSquared === 'number' && r.rSquared < cfg.rSquaredTrustFloor) flags.push('low_benchmark_fit');
  const asymmetry = (r.upsideCapture != null && r.downsideCapture != null) ? r.upsideCapture / (Math.abs(r.downsideCapture) || 1) : null;
  let captureFlag = 'unknown';
  if (asymmetry != null) captureFlag = asymmetry >= 1.2 ? 'aggressive_upside' : asymmetry <= 0.8 ? 'defensive' : 'balanced';
  return { alpha: r.alpha ?? null, rSquared: r.rSquared ?? null, beta: r.beta ?? null,
           upsideCapture: r.upsideCapture ?? null, downsideCapture: r.downsideCapture ?? null,
           asymmetry: asymmetry != null ? round3(asymmetry) : null, captureFlag, flags };
}

// fine-rank composite (spec §5.2). card = precomputed/recomputed components.
// 🔴 MUST mirror research/funds/analyze/shortlist.js#fineRankCard exactly — golden-master
// parity (test/parity.test.js) gates this. Three faithfulness points vs the naive port:
//   (a) trueAlpha term uses aq.value (the 0..1 alphaQuality composite), NOT a 0/1 tier indicator.
//   (b) downside config keys are captureFloor/captureCeil (analysis.json), and the quality is rounded.
//   (c) no_brinion tier (QDII/ETF/index, no Brinson) uses an α PROXY = card.alphaRisk / divisor for
//       the trueAlpha term (instead of aq.value=0), so strong-α funds aren't buried. 🔴 Brinson-source
//       (stock vs industry-β) is unconfirmed for these — proxy assumes α quality.
export function fineScore(card, w, ds, divisor = 50) {
  const floor = ds.captureFloor != null ? ds.captureFloor : ds.floor;   // back-compat for unit fixtures
  const ceil = ds.captureCeil != null ? ds.captureCeil : ds.ceil;
  const aqContribution = card.alphaTier === 'no_brinion'
    ? clamp((card.alphaRisk != null ? card.alphaRisk : 0) / divisor, 0, 1)
    : clamp(card.alphaQualityValue != null ? card.alphaQualityValue : 0, 0, 1);
  return round3(
    w.trueAlpha * aqContribution
    + w.downsideProtection * downsideQuality(card.downsideCapture, floor, ceil)
    + w.sectorFlow * clamp(card.sectorFlowValue ?? 0, 0, 1)     // 🔴 frozen card value (v1); clamp mirrors shortlist.js#fineRankCard
    + w.band * clamp(card.bandValue ?? 0, 0, 1)
    + w.endorsement * clamp(card.endorsementValue ?? 0, 0, 1)
  );
}

// Recompute a full judgment card from a dossier (used live in browser when sub-weights change).
// sectorFlowValue is PASSED IN (pool-derived, frozen v1). Returns the same shape score.js emits.
export function scoreFundCard(dossier, { sectorFlowValue }, cfg, fineW, fineDs) {
  const desc = dossier.description || {};
  const perf = dossier.performance || {};
  const risk = dossier.risk || {};
  const aq = alphaQualityScore({ attribution: perf.attribution }, risk, dossier.manager || {}, cfg.alphaQuality);
  const en = endorsementScore({ holders: dossier.holders }, { ratings: perf.ratings }, cfg.endorsement);
  const bc = bandContributionScore({ annual: perf.annual, annualPeer: perf.annualPeer }, cfg.band);
  const ra = riskAdjusted(risk, cfg.riskAdjusted);
  const sizeRisk = sizeRiskOf(desc.aumYi, cfg.sizeRisk);
  const flags = [...new Set([
    ...(aq.tier === 'true_alpha' ? ['true_alpha'] : aq.tier === 'industry_beta_pseudo' ? ['industry_beta_pseudo'] : []),
    ...(aq.identityCheckOk === false ? ['data_noise'] : []),
    ...ra.flags,
    ...(sizeRisk.flag !== 'ok' && sizeRisk.flag !== 'unknown' ? [sizeRisk.flag] : []),
  ])];
  const card = {
    code: desc.code, name: desc.name,
    alphaTier: aq.tier, stockAlphaShare: aq.stockAlphaShare, annualizedAlpha5y: aq.annualizedAlpha5y,
    alphaQualityValue: aq.value, endorsementValue: en.value, bandValue: bc.value,
    sectorFlowValue, downsideCapture: ra.downsideCapture, captureFlag: ra.captureFlag,
    sizeRiskFlag: sizeRisk.flag, aumYi: sizeRisk.aumYi, flags,
  };
  card.fineScore = fineScore(card, fineW, fineDs);
  return card;
}
