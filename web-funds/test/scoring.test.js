import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sizeRiskOf, downsideQuality, alphaQualityScore, endorsementScore,
  bandContributionScore, riskAdjusted, fineScore, scoreFundCard,
} from '../public/lib/scoring.mjs';

test('sizeRiskOf: >100亿 → capacity_erosion; <2 → liquidation; null → unknown', () => {
  assert.equal(sizeRiskOf(150, { capacityErosionYi: 100, liquidationRiskYi: 2 }).flag, 'capacity_erosion');
  assert.equal(sizeRiskOf(1, { capacityErosionYi: 100, liquidationRiskYi: 2 }).flag, 'liquidation_risk');
  assert.equal(sizeRiskOf(50, { capacityErosionYi: 100, liquidationRiskYi: 2 }).flag, 'ok');
  assert.equal(sizeRiskOf(null, { capacityErosionYi: 100, liquidationRiskYi: 2 }).flag, 'unknown');
});

test('downsideQuality: null→0.5, neg→1, floor→1, ceil→0, linear between', () => {
  assert.equal(downsideQuality(null, 40, 120), 0.5);
  assert.equal(downsideQuality(-21.49, 40, 120), 1);
  assert.equal(downsideQuality(40, 40, 120), 1);
  assert.equal(downsideQuality(120, 40, 120), 0);
  assert.equal(downsideQuality(80, 40, 120), 0.5);
});

test('alphaQualityScore: 真α (share≥0.7) 用 0.5/0.3/0.2 权重', () => {
  const cfg = { weights: { stockAlphaRatio: 0.5, annualizedAlpha5yNorm: 0.3, tenureNorm: 0.2 },
                tierThresholds: { trueAlpha: 0.7, industryBeta: 0.3 }, alpha5yNormalizeDivisor: 50 };
  const aq = alphaQualityScore(
    { attribution: { real: true, excess: 144.34, stockSelection: 154.18, _identityCheck: { ok: true } } },
    { alpha: 103.3 }, { maxTenureYears: 7.6 }, cfg);
  assert.equal(aq.tier, 'true_alpha');
  assert.ok(Math.abs(aq.value - 0.952) < 0.001, `got ${aq.value}`);
  assert.equal(Math.round(aq.stockAlphaShare * 1000) / 1000, 1.068);
});

test('alphaQualityScore: attribution.real !== true → no_brinion, value 0', () => {
  const cfg = { weights: { stockAlphaRatio: 0.5, annualizedAlpha5yNorm: 0.3, tenureNorm: 0.2 },
                tierThresholds: { trueAlpha: 0.7, industryBeta: 0.3 }, alpha5yNormalizeDivisor: 50 };
  const aq = alphaQualityScore({ attribution: { real: false } }, { alpha: 52 }, { maxTenureYears: 4.4 }, cfg);
  assert.equal(aq.tier, 'no_brinion');
  assert.equal(aq.value, 0);
});

test('endorsementScore: 机构+评级加权（无内部人/FOF）', () => {
  const cfg = { weights: { institutional: 0.3, insiders: 0.3, fof: 0.2, ratings: 0.2 }, ratingMax: 5 };
  const en = endorsementScore(
    { holders: { institutional: 40, insiders: {}, fofHeld: '' } },
    { ratings: { rating3Y: 5, rating5Y: 4 } }, cfg);
  assert.ok(Math.abs(en.value - 0.3) < 0.001, `got ${en.value}`);
});

test('bandContributionScore: 一致性 = 跑赢年数/总年数', () => {
  const bc = bandContributionScore(
    { annual: { 2022: -25.64, 2023: -7.24, 2024: 32.38 }, annualPeer: { 2022: -29.32, 2023: 2.53, 2024: 16.5 } },
    { bearYear: 2022 });
  // score.js rounds ratio via round() to 3 dp → 0.667 (NOT raw 2/3). Golden-master parity depends on this rounding.
  assert.equal(bc.consistencyRatio, 0.667);
  assert.equal(bc.bear2022Excess, 3.68);
});

test('riskAdjusted: upside/downside asymmetry + low_benchmark_fit flag', () => {
  const ra = riskAdjusted({ upsideCapture: 166.09, downsideCapture: -21.49, rSquared: 0.59, alpha: 103.3 },
    { rSquaredTrustFloor: 0.7 });
  assert.equal(ra.captureFlag, 'aggressive_upside');
  assert.ok(ra.flags.includes('low_benchmark_fit'));
});

test('fineScore: 默认权重 + 真α卡 = 复现 006502 的 ~0.83', () => {
  // Mirrors shortlist.js#fineRankCard: trueAlpha term uses aq.value (0.952), NOT a 0/1 indicator.
  const card = { alphaTier: 'true_alpha', alphaQualityValue: 0.952, downsideCapture: -21.49,
                 sectorFlowValue: 0.724, bandValue: 0.714, endorsementValue: 0.195 };
  const w = { trueAlpha: 0.4, downsideProtection: 0.25, sectorFlow: 0.15, band: 0.1, endorsement: 0.1 };
  const ds = { captureFloor: 40, captureCeil: 120 };
  // = 0.4*0.952 + 0.25*1(neg→1) + 0.15*0.724 + 0.1*0.714 + 0.1*0.195 = 0.8303 → round3 0.83
  assert.ok(Math.abs(fineScore(card, w, ds) - 0.83) < 0.001, `got ${fineScore(card, w, ds)}`);
});

test('scoreFundCard: 从 dossier 重算子分 + fine（默认权重），tier/flags 正确', () => {
  const dossier = {
    description: { code: '006502', name: '财通集成电路', aumYi: 13.05 },
    performance: { attribution: { real: true, excess: 144.34, stockSelection: 154.18, _identityCheck: { ok: true } },
                   ratings: { rating3Y: 5, rating5Y: 4 },
                   annual: { 2019: 34.67, 2020: 43.07, 2021: 11.41, 2022: -25.64, 2023: -7.24, 2024: 32.38, 2025: 101.46 },
                   annualPeer: { 2019: 52.08, 2020: 33.98, 2021: 9.75, 2022: -29.32, 2023: 2.53, 2024: 16.5, 2025: 42.97 } },
    risk: { alpha: 103.3, rSquared: 0.59, upsideCapture: 166.09, downsideCapture: -21.49 },
    holders: { institutional: 4.93, insiders: {}, fofHeld: '' },
    manager: { maxTenureYears: 7.6 },
  };
  const cfg = {
    alphaQuality: { weights: { stockAlphaRatio: 0.5, annualizedAlpha5yNorm: 0.3, tenureNorm: 0.2 },
                    tierThresholds: { trueAlpha: 0.7, industryBeta: 0.3 }, alpha5yNormalizeDivisor: 50 },
    endorsement: { weights: { institutional: 0.3, insiders: 0.3, fof: 0.2, ratings: 0.2 }, ratingMax: 5 },
    riskAdjusted: { rSquaredTrustFloor: 0.7 }, sizeRisk: { capacityErosionYi: 100, liquidationRiskYi: 2 }, band: { bearYear: 2022 },
  };
  const fineW = { trueAlpha: 0.4, downsideProtection: 0.25, sectorFlow: 0.15, band: 0.1, endorsement: 0.1 };
  const fineDs = { floor: 40, ceil: 120 };
  const card = scoreFundCard(dossier, { sectorFlowValue: 0.724 }, cfg, fineW, fineDs);
  assert.equal(card.alphaTier, 'true_alpha');
  assert.equal(card.sizeRiskFlag, 'ok');
  assert.deepEqual(card.flags.sort(), ['low_benchmark_fit', 'true_alpha'].sort());
  // fineScore mirrors shortlist.js#fineRankCard: trueAlpha uses aq.value (0.952) → 0.4*0.952 + 0.25 + 0.15*0.724 + 0.1*0.714 + 0.1*0.195 ≈ 0.83
  assert.ok(Math.abs(card.fineScore - 0.83) < 0.001);
});

test('fineScore: no_brinion uses α PROXY (alphaRisk/divisor) for trueAlpha term, not aq.value=0', () => {
  // no_brinion (QDII/ETF/index): alphaQualityValue=0 (no Brinson) but alphaRisk=52 → proxy = 52/50 = 1.04 → clamp 1.0.
  // A same-fund true_alpha with aq.value=0.952 would get 0.4*0.952=0.381; the no_brinion proxy gets 0.4*1.0=0.4
  // → strong-α no_brinion funds compete with (even slightly exceed) confirmed-α funds. 🔴 Brinson-source caveat.
  const card = { alphaTier: 'no_brinion', alphaQualityValue: 0, alphaRisk: 52,
    downsideCapture: -54, sectorFlowValue: 0.5, bandValue: 0.7, endorsementValue: 0.3 };
  const w = { trueAlpha: 0.4, downsideProtection: 0.25, sectorFlow: 0.15, band: 0.1, endorsement: 0.1 };
  const ds = { captureFloor: 40, captureCeil: 120 };
  // = 0.4*1.0 + 0.25*1(neg) + 0.15*0.5 + 0.1*0.7 + 0.1*0.3 = 0.4+0.25+0.075+0.07+0.03 = 0.825
  assert.ok(Math.abs(fineScore(card, w, ds, 50) - 0.825) < 0.001, `got ${fineScore(card, w, ds, 50)}`);
});

test('fineScore: no_brinion with low α → proxy low (not buried-zero, but not boosted)', () => {
  const card = { alphaTier: 'no_brinion', alphaQualityValue: 0, alphaRisk: 5,  // α=5 → 5/50=0.1
    downsideCapture: 80, sectorFlowValue: 0.3, bandValue: 0.4, endorsementValue: 0.2 };
  const w = { trueAlpha: 0.4, downsideProtection: 0.25, sectorFlow: 0.15, band: 0.1, endorsement: 0.1 };
  const ds = { captureFloor: 40, captureCeil: 120 };
  // downside 80 → (120-80)/(120-40)=0.5; = 0.4*0.1 + 0.25*0.5 + 0.15*0.3 + 0.1*0.4 + 0.1*0.2 = 0.04+0.125+0.045+0.04+0.02 = 0.27
  assert.ok(Math.abs(fineScore(card, w, ds, 50) - 0.27) < 0.001, `got ${fineScore(card, w, ds, 50)}`);
});
