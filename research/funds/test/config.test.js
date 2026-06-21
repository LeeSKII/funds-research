const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, DEFAULT_THRESHOLDS } = require('../core/config');

test('loadConfig returns thresholds merged with defaults', () => {
  const { thresholds } = loadConfig();
  assert.equal(thresholds.rating3Y_min, 4);
  assert.equal(typeof thresholds.fundSize_max_yi, 'number');
});

test('loadConfig returns universe with a search_filter', () => {
  const { universe } = loadConfig();
  assert.ok(universe.search_filter);
  assert.ok(Array.isArray(universe.watchlist));
});

test('DEFAULT_THRESHOLDS has all screen keys', () => {
  for (const k of ['rating3Y_min', 'rating5Y_min', 'longestTenure_min_years', 'fundSize_min_yi', 'fundSize_max_yi', 'alphaToIndRankP_3Y_max', 'sharpeRatioRankP_3Y_max']) {
    assert.ok(k in DEFAULT_THRESHOLDS, `missing ${k}`);
  }
});
