const test = require('node:test'); const assert = require('node:assert');
const { buildSectorFlowHeatmap, sectorFlowScore, detailSectors } = require('../analyze/sectorflow-index');
const config = require('../core/config/analysis.json');
const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');

test('detailSectors excludes super-categories 周期性/敏感性/防御性', () => {
  const ds = detailSectors(d006502.portfolio.sectorAllocation);
  assert.ok(!ds.some(s => ['周期性','敏感性','防御性'].includes(s.sector)));
  assert.ok(ds.some(s => s.sector === '科技'));
});

test('buildSectorFlowHeatmap ranks sectors, rankNorm in [0,1]', () => {
  const hm = buildSectorFlowHeatmap([d006502], config);
  assert.ok(hm.sectors.length > 0);
  for (const r of hm.sectors) assert.ok(r.rankNorm >= 0 && r.rankNorm <= 1.0001);
  assert.strictEqual(hm.sectors[0].sector, '科技'); // 006502 98% 科技 → top
});

test('sectorFlowScore: 006502 (科技 98% + 大盘成长) scores high', () => {
  const hm = buildSectorFlowHeatmap([d006502], config);
  const s = sectorFlowScore(d006502, hm, config);
  assert.ok(s.value > 0.5, `expected high sectorFlow, got ${s.value}`);
  assert.strictEqual(s.liquidity.styleBoxTier, '大盘成长');
  assert.ok(s.topSectors.length > 0 && s.topSectors[0].sector === '科技');
});

test('sectorFlowScore: no-sector dossier → low score, no throw', () => {
  const hm = buildSectorFlowHeatmap([d006502], config);
  const s = sectorFlowScore({ description:{styleBox:'小盘价值'}, portfolio:{} }, hm, config);
  // prosperity 0 (no sectors), liquidity 小盘=0.3 → value = 0.4*0.3 = 0.12
  assert.ok(s.value < 0.2, `expected low, got ${s.value}`);
  assert.strictEqual(s.prosperityAlignment, 0);
});

test('buildSectorFlowHeatmap handles empty pool without throwing', () => {
  const hm = buildSectorFlowHeatmap([], config);
  assert.strictEqual(hm.sectors.length, 0);
  assert.strictEqual(hm.fundCount, 0);
});

test('AUM-invariance: sectorFlowScore is identical regardless of fund aumYi (guards #6: size is not prosperity)', () => {
  const small = JSON.parse(JSON.stringify(d006502)); small.description.aumYi = 0.01;
  const huge = JSON.parse(JSON.stringify(d006502)); huge.description.aumYi = 9999;
  // NOTE: heatmap is rebuilt per-input, but score depends only on sectorAllocation + styleBox.
  const hmSmall = buildSectorFlowHeatmap([small], config);
  const hmHuge = buildSectorFlowHeatmap([huge], config);
  const sSmall = sectorFlowScore(small, hmSmall, config);
  const sHuge = sectorFlowScore(huge, hmHuge, config);
  assert.strictEqual(sSmall.value, sHuge.value);
  assert.strictEqual(sSmall.prosperityAlignment, sHuge.prosperityAlignment);
});
