const test = require('node:test'); const assert = require('node:assert');
const { detectTheme } = require('../analyze/theme-detector');
const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');

test('detectTheme: topSectorBets = 细分层超配正值最大的行业', () => {
  const t = detectTheme(d006502);
  assert.ok(t.topSectorBets.length > 0);
  assert.strictEqual(t.topSectorBets[0].sector, '科技'); // 细分层最大正超配
  // super-cats must NOT appear
  assert.ok(!t.topSectorBets.some(s => ['周期性','敏感性','防御性'].includes(s.sector)));
});

test('detectTheme: holdingsCluster 按行业聚合 weightPct, 科技居首', () => {
  const t = detectTheme(d006502);
  assert.ok(t.holdingsCluster.length > 0);
  assert.strictEqual(t.holdingsCluster[0].industry, '科技');
  assert.ok(t.holdingsCluster[0].weightPct > 50, `expected >50, got ${t.holdingsCluster[0].weightPct}`);
});

test('detectTheme: styleBox + driftSinceLast=insufficient_history (单期)', () => {
  const t = detectTheme(d006502);
  assert.strictEqual(t.styleBox, '大盘成长');
  assert.strictEqual(t.driftSinceLast, 'insufficient_history');
});

test('detectTheme: 2 期 history 比对 → stable/sector_rotation/style_drift', () => {
  const a = JSON.parse(JSON.stringify(d006502));
  const b = JSON.parse(JSON.stringify(d006502));
  const ta = detectTheme(a, { history: [a, b] }); // identical → stable
  assert.strictEqual(ta.driftSinceLast, 'stable');
  b.description.styleBox = '小盘价值'; // style change
  const tb = detectTheme(b, { history: [a, b] });
  assert.strictEqual(tb.driftSinceLast, 'style_drift');
});

test('detectTheme: missing portfolio → empty arrays, no throw', () => {
  const t = detectTheme({ description: {} });
  assert.deepStrictEqual(t.topSectorBets, []);
  assert.deepStrictEqual(t.holdingsCluster, []);
});
