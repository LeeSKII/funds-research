// research/funds/test/sections/performance.test.js — node:test suite for the 业绩 section extractor.
// Loads the 005827 ground-truth snapshot (易方达蓝筹精选混合, 张坤) and asserts exact numbers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { extractPerformance } = require('../../analyze/sections/performance');

const SNAPSHOT = path.join(__dirname, '..', 'fixtures', 'mock-fund-innertext.json');

function loadLines() {
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const text = typeof raw === 'string' ? raw : (raw.innerText || raw.text || raw.body || '');
  return text.split('\n');
}

test('performance: trailing returns (8 cols, includes 近两年)', () => {
  const lines = loadLines();
  const { trailing } = extractPerformance(lines, { code: '005827' });

  // 8 columns present
  const keys = ['近一月', '近三月', '近六月', '近一年', '近两年', '近三年', '近五年', '今年以来'];
  for (const k of keys) assert.ok(k in trailing, `trailing.${k} missing`);

  // exact values
  assert.equal(trailing['近一月'], -7.95);
  assert.equal(trailing['近三月'], -14.26);
  assert.equal(trailing['近六月'], -18.98);
  assert.equal(trailing['近一年'], -11.02);
  assert.equal(trailing['近两年'], -4.81);   // v1.0 regex 近二-vs-近两 regression guard
  assert.equal(trailing['近三年'], -5.51);
  assert.equal(trailing['近五年'], -12.56);
  assert.equal(trailing['今年以来'], -14.03);

  // 近十年 absent (fund <10y)
  assert.ok(!('近十年' in trailing), '近十年 must be absent for a <10y fund');
});

test('performance: annual calendar returns (7 years 2019-2025)', () => {
  const lines = loadLines();
  const { annual } = extractPerformance(lines, { code: '005827' });

  assert.equal(annual['2019'], 55.12);
  assert.equal(annual['2020'], 95.09);
  assert.equal(annual['2021'], -9.89);
  assert.equal(annual['2022'], -16.03);
  assert.equal(annual['2023'], -20.99);
  assert.equal(annual['2024'], 1.70);
  assert.equal(annual['2025'], 6.86);
});

test('performance: 晨星评级 (3Y=1, 5Y=1, 10Y=null)', () => {
  const lines = loadLines();
  const { ratings } = extractPerformance(lines, { code: '005827' });

  assert.equal(ratings.rating3Y, 1);
  assert.equal(ratings.rating5Y, 1);
  assert.equal(ratings.rating10Y, null);
});

test('performance: Brinson attribution real + identity check', () => {
  const lines = loadLines();
  const { attribution } = extractPerformance(lines, { code: '005827' });

  assert.equal(attribution.present, true);
  assert.equal(attribution.real, true);
  assert.equal(attribution.reason, null);

  assert.equal(attribution.excess, -19.5);
  assert.equal(attribution.sectorAllocation, -7.1);
  assert.equal(attribution.stockSelection, -12.41);

  // identity: 行业配置 + 个股选择 ≈ 超额收益
  assert.ok(attribution._identityCheck, '_identityCheck must exist for real Brinson');
  assert.equal(attribution._identityCheck.reconstructed, -19.51);
  assert.equal(attribution._identityCheck.delta, 0.01);
  assert.equal(attribution._identityCheck.ok, true);
});

test('performance: never throws on empty input', () => {
  const block = extractPerformance([], { code: '005827' });
  assert.deepEqual(block.trailing, {});
  assert.deepEqual(block.annual, {});
  assert.equal(block.attribution.present, false);
  assert.equal(block.attribution.real, false);
  assert.equal(block.attribution.reason, 'section_absent');
});

test('performance: schema-shape — top-level keys present', () => {
  const lines = loadLines();
  const block = extractPerformance(lines, { code: '005827' });
  for (const k of ['trailing', 'trailingPeer', 'annual', 'annualPeer', 'ratings', 'attribution']) {
    assert.ok(k in block, `performance.${k} must be present`);
  }
  for (const k of ['rating3Y', 'rating5Y', 'rating10Y']) {
    assert.ok(k in block.ratings, `ratings.${k} must be present`);
  }
  for (const k of ['present', 'real', 'reason', 'excess', 'sectorAllocation', 'stockSelection', '_identityCheck']) {
    assert.ok(k in block.attribution, `attribution.${k} must be present`);
  }
});
