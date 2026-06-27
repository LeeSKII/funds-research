const test = require('node:test'); const assert = require('node:assert');
const { summarize, aumBracket, createWatchlist, trackDossier, CAPACITY_YI, LIQUIDATION_YI } = require('../core/watchlist');
const analysisConfig = require('../core/config/analysis.json');
const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');

const clone = (d) => JSON.parse(JSON.stringify(d));

test('summarize: 压成稳定摘要（慢变字段，剔噪声）', () => {
  const s = summarize(d006502);
  assert.strictEqual(s.code, '006502');
  assert.strictEqual(s.rating3Y, 5);
  assert.strictEqual(s.rating5Y, 4);
  assert.strictEqual(s.managerName, '金梓才');
  assert.strictEqual(s.aumYi, 13.05);
  assert.strictEqual(s.styleBox, '大盘成长');
});

test('aumBracket: >100=mega, <2=tiny, 其余=normal, null=unknown', () => {
  assert.strictEqual(aumBracket(150), 'mega');
  assert.strictEqual(aumBracket(1.5), 'tiny');
  assert.strictEqual(aumBracket(13.05), 'normal');
  assert.strictEqual(aumBracket(null), 'unknown');
});

test('单源：CAPACITY/LIQUIDATION 从 config.sizeRisk 派生 + opts 可注入覆盖（review #2 fix）', () => {
  // 默认阈值与 config 同源（不漂移）
  assert.strictEqual(CAPACITY_YI, analysisConfig.sizeRisk.capacityErosionYi);
  assert.strictEqual(LIQUIDATION_YI, analysisConfig.sizeRisk.liquidationRiskYi);
  // opts 注入：用自定义阈值判定
  assert.strictEqual(aumBracket(60, { capacityYi: 50 }), 'mega');  // 60>50 → mega
  assert.strictEqual(aumBracket(60, { capacityYi: 50 }), 'mega');
  assert.strictEqual(aumBracket(40, { capacityYi: 50, liquidationYi: 30 }), 'normal'); // 30<40<50
  assert.strictEqual(aumBracket(20, { liquidationYi: 30 }), 'tiny'); // 20<30
});


test('trackDossier: 首次 → first_seen；再次相同 → 无事件', () => {
  const wl = createWatchlist(['006502']);
  const e1 = trackDossier(wl, d006502);
  assert.strictEqual(e1.length, 1);
  assert.strictEqual(e1[0].type, 'first_seen');
  const e2 = trackDossier(wl, d006502);
  assert.strictEqual(e2.length, 0);
});

test('trackDossier: 评级降级 → rating_change', () => {
  const wl = createWatchlist(['006502']);
  trackDossier(wl, d006502);
  const next = clone(d006502); next.performance.ratings.rating3Y = 3;
  const e = trackDossier(wl, next);
  assert.ok(e.some(x => x.type === 'rating_change' && x.field === 'rating3Y' && x.before === 5 && x.after === 3));
});

test('trackDossier: 经理变更 → manager_change', () => {
  const wl = createWatchlist(['006502']);
  trackDossier(wl, d006502);
  const next = clone(d006502); next.manager.team = [{ name: '张三', tenureStart: '2024-01-01', tenureEnd: null }];
  const e = trackDossier(wl, next);
  assert.ok(e.some(x => x.type === 'manager_change' && /张三/.test(x.after)));
});

test('trackDossier: 规模越 100亿线 → size_bracket_change', () => {
  const wl = createWatchlist(['006502']);
  trackDossier(wl, d006502); // 13.05 normal
  const next = clone(d006502); next.description.aumYi = 180; // → mega
  const e = trackDossier(wl, next);
  assert.ok(e.some(x => x.type === 'size_bracket_change' && x.after === 180));
});

test('trackDossier: 风格箱变 → style_drift', () => {
  const wl = createWatchlist(['006502']);
  trackDossier(wl, d006502);
  const next = clone(d006502); next.description.styleBox = '大盘价值';
  const e = trackDossier(wl, next);
  assert.ok(e.some(x => x.type === 'style_drift'));
});
