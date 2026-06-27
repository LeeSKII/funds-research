const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path'); const fs = require('fs'); const os = require('os');
const { coarseRank, fineRankCard, fineRank, buildShortlist, downsideProtectionQuality, pctileQuality } = require('../analyze/shortlist');
const { scoreFund } = require('../analyze/score');
const { buildSectorFlowHeatmap } = require('../analyze/sectorflow-index');
const { validate } = require('../core/validate');
const config = require('../core/config/analysis.json');

const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');
const d159994 = require('../../../data/fund/159994/fund-159994-20260620.json');
const heatmap = buildSectorFlowHeatmap([d006502, d159994], config);

test('pctileQuality: 0-100 百分位 → 0..1 质量（低=好）；null=0.5', () => {
  assert.strictEqual(pctileQuality(0), 1);     // top 0% = 最好
  assert.strictEqual(pctileQuality(100), 0);   // bottom 100% = 最差
  assert.strictEqual(pctileQuality(50), 0.5);
  assert.strictEqual(pctileQuality(null), 0.5); // 无数据中性
});

test('downsideProtectionQuality: 线性映射 [40..120]→[1..0]，null=0.5，负值 clamp 1', () => {
  assert.strictEqual(downsideProtectionQuality(40, config), 1);     // floor → 满分保护
  assert.strictEqual(downsideProtectionQuality(120, config), 0);    // ceil → 零保护
  assert.strictEqual(downsideProtectionQuality(null, config), 0.5); // 无数据中性
  assert.strictEqual(downsideProtectionQuality(-21.49, config), 1); // 006502 逆市 → clamp 1
  assert.ok(downsideProtectionQuality(80, config) > downsideProtectionQuality(100, config));
});

test('coarseRank: α/夏普百分位低(好)+评级高 → 排前；coarseScore∈[0,1]，coarseRank 连续', () => {
  const rows = [
    { id: '111111', fundName: '顶A', alphaToIndRankP_3Y: 5, sharpeRatioRankP_3Y: 8, rating3Y: 5 },  // 顶尖
    { id: '222222', fundName: '中B', alphaToIndRankP_3Y: 50, sharpeRatioRankP_3Y: 50, rating3Y: 4 }, // 中
    { id: '333333', fundName: '差C', alphaToIndRankP_3Y: 90, sharpeRatioRankP_3Y: 85, rating3Y: 3 }, // 差
  ];
  const r = coarseRank(rows, config);
  assert.strictEqual(r[0].code, '111111');
  assert.strictEqual(r[2].code, '333333');
  for (const o of r) { assert.ok(o.coarseScore >= 0 && o.coarseScore <= 1); }
  assert.deepStrictEqual(r.map(o => o.coarseRank), [1, 2, 3]);
  // null 字段不崩（中性 0.5）
  const r2 = coarseRank([{ id: '444', fundName: '新基', alphaToIndRankP_3Y: null, sharpeRatioRankP_3Y: null, rating3Y: 4 }], config);
  assert.ok(r2[0].coarseScore >= 0 && r2[0].coarseScore <= 1);
});

test('fineRankCard: 复用 scoreFund → alphaTier 与评分卡一致；fineScore∈[0,1]', () => {
  const card = scoreFund(d006502, { heatmap, config, computedAt: '2026-06-22' });
  const f = fineRankCard(card, config);
  assert.strictEqual(f.alphaTier, card.scores.alphaQuality.tier); // DRY：和评分卡同 tier
  assert.strictEqual(f.alphaTier, 'true_alpha');                   // 006502 是真α
  assert.strictEqual(f.downsideQuality, 1);                        // downsideCapture=-21.49
  assert.ok(f.fineScore >= 0 && f.fineScore <= 1);
  assert.ok(f.flags.includes('true_alpha'));
});

test('fineRank: 多 dossier 按 fineScore 降序，fineRank 连续；真α基金不输给 no_brinion ETF', () => {
  const ranked = fineRank([d006502, d159994], config, '2026-06-22');
  assert.strictEqual(ranked.length, 2);
  assert.deepStrictEqual(ranked.map(r => r.fineRank), [1, 2]);
  for (let i = 0; i < ranked.length - 1; i++) assert.ok(ranked[i].fineScore >= ranked[i + 1].fineScore);
  // 006502 (true_alpha, 强跌势保护) 应排在 159994 (no_brinion ETF) 之前
  assert.strictEqual(ranked[0].code, '006502');
});

test('buildShortlist: 真实 candidates + data/fund → schema 合法；pendingScrape 诚实（宽池多数未抓）', () => {
  const candidates = require('../../../research/funds/store/derived/candidates-2026-06-21.json');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-'));
  const r = buildShortlist({ rows: candidates.rows, dataDir: path.join(__dirname, '..', '..', '..', 'data', 'fund'), outDir, date: '2026-06-22', config, topN: 10 });
  assert.ok(r.dossiersAvailable > 0);
  assert.ok(r.topN > 0);
  const file = path.join(outDir, 'shortlist-2026-06-22.json');
  assert.ok(fs.existsSync(file));
  const obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const v = validate('shortlist', obj); assert.ok(v.valid, JSON.stringify(v.errors));
  // 诚实边界：宽池里没抓到 dossier 的码进 pendingScrape，不混进 shortlist
  const shortlistCodes = new Set(obj.shortlist.map(s => s.code));
  for (const p of obj.stage2.pendingScrape) assert.ok(!shortlistCodes.has(p.code));
  // shortlist 按 fineScore 降序
  for (let i = 0; i < obj.shortlist.length - 1; i++) assert.ok(obj.shortlist[i].fineScore >= obj.shortlist[i + 1].fineScore);
});

test('INVARIANTS (a)：shortlist schema 严格——字段缺失/类型错会被拦（证明写前 validate 有意义）', () => {
  const candidates = require('../../../research/funds/store/derived/candidates-2026-06-21.json');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-'));
  buildShortlist({ rows: candidates.rows, dataDir: path.join(__dirname, '..', '..', '..', 'data', 'fund'), outDir, date: '2026-06-22', config, topN: 5 });
  const obj = JSON.parse(fs.readFileSync(path.join(outDir, 'shortlist-2026-06-22.json'), 'utf-8'));
  // 1) 删 required 字段 fineRank → schema 拒绝
  const corrupt1 = JSON.parse(JSON.stringify(obj)); delete corrupt1.shortlist[0].fineRank;
  assert.ok(!validate('shortlist', corrupt1).valid);
  // 2) alphaTier 越界值 → schema 拒绝
  const corrupt2 = JSON.parse(JSON.stringify(obj)); corrupt2.shortlist[0].alphaTier = 'bogus';
  assert.ok(!validate('shortlist', corrupt2).valid);
  // 3) fineScore 越界（>1）→ schema 拒绝
  const corrupt3 = JSON.parse(JSON.stringify(obj)); corrupt3.shortlist[0].fineScore = 1.5;
  assert.ok(!validate('shortlist', corrupt3).valid);
});
