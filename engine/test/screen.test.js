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

// --- CLIENT-layer behaviors (server no longer sends alpha3Y/sharpe3Y; new portfolio-fit gates) ---

test('rejects high alpha percentile (client quality floor — fields are 0-100, threshold 50 = top half)', () => {
  const out = screen(snap([fund('005161', { alphaToIndRankP_3Y: 80 })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 0);
});

test('null alpha percentile does not disqualify (new fund, judge on 3Y)', () => {
  const out = screen(snap([fund('005161', { alphaToIndRankP_3Y: null })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 1);
});

test('rejects mega fund size (client portfolio-fit cap; server has no upper bound)', () => {
  const out = screen(snap([fund('005161', { fundSize: 250 })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 0);
});

test('excludes USD share class by fundName (no server currency filter — forced client)', () => {
  const usd = screen(snap([fund('006374', { fundName: '富兰克林国海全球科技互联混合（QDII）美元现汇 A' })]), DEFAULT_THRESHOLDS);
  assert.equal(usd.rows.length, 0);
  const rmb = screen(snap([fund('006373', { fundName: '富兰克林国海全球科技互联混合（QDII）人民币 A' })]), DEFAULT_THRESHOLDS);
  assert.equal(rmb.rows.length, 1);
});

test('annotates defensive sleeve (shallow drawdown) without gating', () => {
  const shallow = screen(snap([fund('005161', { maximumDrawdown_3Y: -18 })]), DEFAULT_THRESHOLDS);
  assert.equal(shallow.rows.length, 1);
  assert.equal(shallow.rows[0].defensive, true);
  const deep = screen(snap([fund('005161', { maximumDrawdown_3Y: -55 })]), DEFAULT_THRESHOLDS);
  assert.equal(deep.rows.length, 1);
  assert.equal(deep.rows[0].defensive, false);
});
