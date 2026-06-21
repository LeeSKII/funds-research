const test = require('node:test'); const assert = require('node:assert');
const { scoreFund } = require('../analyze/score');
const config = require('../core/config/analysis.json');
const { buildSectorFlowHeatmap } = require('../analyze/sectorflow-index');
const { validate } = require('../core/validate');
const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');
// 🔴 518880 is a LEGACY flat-shape dossier (no `description`/`performance.attribution`/`portfolio`),
// not the new schema score.js consumes. Use 159994 — a real new-schema no_brinion ETF
// (attribution.real=false, reason=not_computed). See status report for the full shape audit.
const d159994 = require('../../../data/fund/159994/fund-159994-20260620.json');

const heatmap = buildSectorFlowHeatmap([d006502, d159994], config);

test('真α型 006502: tier=true_alpha, flag true_alpha, sizeRisk ok, schema-valid', () => {
  const card = scoreFund(d006502, { heatmap, config, computedAt: '2026-06-21' });
  assert.strictEqual(card.scores.alphaQuality.tier, 'true_alpha');
  assert.ok(card.flags.includes('true_alpha'));
  assert.strictEqual(card.sizeRisk.flag, 'ok'); // 13.05亿
  const v = validate('analysis-score', card); assert.ok(v.valid, JSON.stringify(v.errors));
});

test('no_brinion ETF 159994: tier=no_brinion, flag no_brinion, stockAlphaShare null', () => {
  const card = scoreFund(d159994, { heatmap, config, computedAt: '2026-06-21' });
  assert.strictEqual(card.scores.alphaQuality.tier, 'no_brinion');
  assert.ok(card.flags.includes('no_brinion'));
  assert.strictEqual(card.scores.alphaQuality.stockAlphaShare, null);
  const v = validate('analysis-score', card); assert.ok(v.valid, JSON.stringify(v.errors));
});

test('大规模 capacity_erosion: aumYi>100 → flag capacity_erosion', () => {
  const big = JSON.parse(JSON.stringify(d006502)); big.description.aumYi = 150;
  const card = scoreFund(big, { heatmap, config, computedAt: '2026-06-21' });
  assert.strictEqual(card.sizeRisk.flag, 'capacity_erosion');
  assert.ok(card.flags.includes('capacity_erosion'));
});

test('小规模 liquidation_risk: aumYi<2', () => {
  const tiny = JSON.parse(JSON.stringify(d006502)); tiny.description.aumYi = 1.5;
  const card = scoreFund(tiny, { heatmap, config, computedAt: '2026-06-21' });
  assert.strictEqual(card.sizeRisk.flag, 'liquidation_risk');
  assert.ok(card.flags.includes('liquidation_risk'));
});

test('rSquared<floor (006502 rSquared=0.59) → flag low_benchmark_fit', () => {
  const card = scoreFund(d006502, { heatmap, config, computedAt: '2026-06-21' });
  assert.ok(card.flags.includes('low_benchmark_fit'));
});

test('narrative 四句非空且与 subscore 一致 (006502 重仓科技)', () => {
  const card = scoreFund(d006502, { heatmap, config, computedAt: '2026-06-21' });
  for (const k of ['whatItBetsOn','whoDrivesAlpha','sectorFlowVerdict','bandVerdict']) {
    assert.ok(typeof card.narrative[k] === 'string' && card.narrative[k].length > 0, k);
  }
  assert.ok(/科技/.test(card.narrative.whatItBetsOn));
});

test('all 0..1 subscore values within [0,1]', () => {
  for (const d of [d006502, d159994]) {
    const card = scoreFund(d, { heatmap, config, computedAt: '2026-06-21' });
    for (const k of ['alphaQuality','endorsement','bandContribution','sectorFlow']) {
      const val = card.scores[k].value;
      assert.ok(val >= 0 && val <= 1, `${k}.value=${val} out of [0,1]`);
    }
  }
});

test('fofHeld 表头泄漏("FOF持有人数量")不触发 fof_endorsed (B1 fix)', () => {
  // 159994 的 holders.fofHeld 是 parse-fund 泄漏的表头标签, 无日期 → 不应计为 FOF 背书
  const card = scoreFund(d159994, { heatmap, config, computedAt: '2026-06-21' });
  assert.ok(!card.flags.includes('fof_endorsed'), 'header leak must not set fof_endorsed');
});

test('fofHeld 真实持有记录(日期+持有+非否定)触发 fof_endorsed', () => {
  const d = JSON.parse(JSON.stringify(d006502));
  d.holders.fofHeld = '截止2025-12-31，该基金被3只FOF基金持有';
  const card = scoreFund(d, { heatmap, config, computedAt: '2026-06-21' });
  assert.ok(card.flags.includes('fof_endorsed'));
});
