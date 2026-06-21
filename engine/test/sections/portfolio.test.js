// test/sections/portfolio.test.js — locks the 投资组合 section extractor on the 005827 ground truth.
//
// Covers: asset allocation {fund,peer} pairs, 10 holdings (multi-market tickers, in order, with weight),
// top10 concentration, 14-row sector allocation (fund/benchmark/excess), 14-row region allocation
// (1-col — benchmark/excess null is CORRECT, not a miss), and turnover (换手率 = 31).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractPortfolio } = require('../../analyze/sections/portfolio');

const SNAP = path.join(__dirname, '..', '..', '..', 'research', 'funds', 'raw-snapshots', 'morningstar-fund-005827-20260621-innertext.json');

function loadLines() {
  const raw = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const text = typeof raw === 'string' ? raw : (raw.innerText || '');
  return text.split('\n');
}

test('extractPortfolio — 005827 asset allocation (股票/债券/现金/商品/其他 with fund+peer)', () => {
  const lines = loadLines();
  const p = extractPortfolio(lines, { code: '005827' });
  assert.deepEqual(p.assetAllocation.stock, { fund: 94.39, peer: 87.57 });
  assert.deepEqual(p.assetAllocation.bond, { fund: 0, peer: 1.59 });
  assert.deepEqual(p.assetAllocation.cash, { fund: 6.26, peer: 10.81 });
  assert.deepEqual(p.assetAllocation.commodity, { fund: 0, peer: 0 });
  assert.deepEqual(p.assetAllocation.other, { fund: -0.65, peer: 0.03 });
});

test('extractPortfolio — 005827 top 10 holdings, in order, with ticker+name+industry+weight', () => {
  const lines = loadLines();
  const p = extractPortfolio(lines, { code: '005827' });
  assert.equal(p.topHoldings.length, 10, 'exactly 10 holdings');

  const expected = [
    { code: '600519', name: '贵州茅台', industry: '必选消费', weightPct: 9.91 },
    { code: '000858', name: '五粮液', industry: '必选消费', weightPct: 9.90 },
    { code: '000568', name: '泸州老窖', industry: '必选消费', weightPct: 9.87 },
    { code: '00700', name: '腾讯控股', industry: '通信服务', weightPct: 9.60 },
    { code: 'YUMC', name: '百胜中国', industry: '可选消费', weightPct: 9.56 },
    { code: '00883', name: '中国海洋石油', industry: '能源', weightPct: 9.28 },
    { code: '600809', name: '山西汾酒', industry: '必选消费', weightPct: 9.27 },
    { code: '09988', name: '阿里巴巴-W', industry: '可选消费', weightPct: 9.22 },
    { code: '06618', name: '京东健康', industry: '医疗保健', weightPct: 4.39 },
    { code: '002027', name: '分众传媒', industry: '通信服务', weightPct: 3.96 },
  ];
  expected.forEach((e, i) => {
    const h = p.topHoldings[i];
    assert.equal(h.code, e.code, `holding ${i} code`);
    assert.equal(h.name, e.name, `holding ${i} name`);
    assert.equal(h.industry, e.industry, `holding ${i} industry`);
    assert.equal(h.weightPct, e.weightPct, `holding ${i} weightPct`);
  });
});

test('extractPortfolio — 005827 top10 concentration = 84.96', () => {
  const lines = loadLines();
  const p = extractPortfolio(lines, { code: '005827' });
  assert.equal(p.top10Concentration, 84.96);
});

test('extractPortfolio — 005827 sector allocation (14 rows, fund/benchmark/excess)', () => {
  const lines = loadLines();
  const p = extractPortfolio(lines, { code: '005827' });
  assert.equal(p.sectorAllocation.length, 14, '14 sector rows (3 super-groups + 11 leaf)');

  const byName = Object.fromEntries(p.sectorAllocation.map(r => [r.sector, r]));
  // super-groups + spot-check leaves from the EXPECTED brief.
  assert.deepEqual(byName['周期性'], { sector: '周期性', fund: 23.48, benchmark: 40.17, excess: -16.69 });
  assert.deepEqual(byName['敏感性'], { sector: '敏感性', fund: 24.87, benchmark: 44.10, excess: -19.23 });
  assert.deepEqual(byName['防御性'], { sector: '防御性', fund: 51.65, benchmark: 15.73, excess: 35.92 });
  assert.deepEqual(byName['公用事业'], { sector: '公用事业', fund: 0, benchmark: 2.86, excess: -2.86 });
  // a mid leaf for completeness
  assert.deepEqual(byName['必选消费'], { sector: '必选消费', fund: 41.01, benchmark: 7.84, excess: 33.16 });
});

test('extractPortfolio — 005827 region allocation (14 rows, 1-col: benchmark/excess null is CORRECT)', () => {
  const lines = loadLines();
  const p = extractPortfolio(lines, { code: '005827' });
  assert.equal(p.regionAllocation.length, 14, '14 region rows');

  const byName = Object.fromEntries(p.regionAllocation.map(r => [r.region, r]));
  assert.deepEqual(byName['大亚洲地区'], { region: '大亚洲地区', fund: 100.00, benchmark: null, excess: null });
  assert.deepEqual(byName['发达亚洲'], { region: '发达亚洲', fund: 3.77, benchmark: null, excess: null });
  assert.deepEqual(byName['新兴亚洲'], { region: '新兴亚洲', fund: 96.23, benchmark: null, excess: null });
  assert.deepEqual(byName['日本'], { region: '日本', fund: 0, benchmark: null, excess: null });
  assert.deepEqual(byName['未分类'], { region: '未分类', fund: 0, benchmark: null, excess: null }); // -0.00 parses to 0

  // every region row: benchmark/excess null on this fund (page has NO 基准% column for region).
  for (const r of p.regionAllocation) {
    assert.equal(r.benchmark, null, `${r.region} benchmark null (1-col table)`);
    assert.equal(r.excess, null, `${r.region} excess null (1-col table)`);
  }
});

test('extractPortfolio — 005827 turnover (换手率) = 31', () => {
  const lines = loadLines();
  const p = extractPortfolio(lines, { code: '005827' });
  assert.equal(p.turnover, 31);
});

test('extractPortfolio — null-safe on empty input (never throws, all aggregations null/empty)', () => {
  const p = extractPortfolio([], { code: '000000' });
  assert.deepEqual(p.assetAllocation, {});
  assert.deepEqual(p.topHoldings, []);
  assert.equal(p.top10Concentration, null);
  assert.deepEqual(p.sectorAllocation, []);
  assert.deepEqual(p.regionAllocation, []);
  assert.equal(p.turnover, null);
});
