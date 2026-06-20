const test = require('node:test');
const assert = require('node:assert/strict');
const { screen } = require('../analyze/screen');
const { DEFAULT_THRESHOLDS } = require('../core/config');

const fund = (id, over = {}) => ({ id, fundName: `F${id}`, rating3Y: 5, rating5Y: 5, longestTenure: 5, fundSize: 50, alphaToIndRankP_3Y: 0.1, sharpeRatioRankP_3Y: 0.1, ...over });
const snap = rows => ({ rows });

test('passes a fund meeting all thresholds', () => {
  const out = screen(snap([fund('005161')]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 1);
});

test('rejects low rating3Y', () => {
  const out = screen(snap([fund('005161', { rating3Y: 3 })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 0);
});

test('rejects short tenure', () => {
  const out = screen(snap([fund('005161', { longestTenure: 1 })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 0);
});

test('rejects too-small fund size', () => {
  const out = screen(snap([fund('005161', { fundSize: 0.5 })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 0);
});

test('null rating5Y does not disqualify (data not yet available)', () => {
  const out = screen(snap([fund('005161', { rating5Y: null })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 1);
});
