// engine/test/sections/risk.test.js — self-test for the 风险 tab extractor.
// Ground truth: 易方达蓝筹精选混合 005827 (张坤) snapshot 2026-06-21.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractRisk } = require('../../analyze/sections/risk');

const SNAP = path.join(
  __dirname, '..', '..', '..',
  'research', 'funds', 'raw-snapshots',
  'morningstar-fund-005827-20260621-innertext.json'
);

function loadLines() {
  const j = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  return j.innerText.split('\n');
}

test('extractRisk on 005827 — all expected values', () => {
  const lines = loadLines();
  const r = extractRisk(lines, { code: '005827' });

  // 性价比 pairs — {fund, peer}
  assert.deepEqual(r.sharpe, { fund: -15.8, peer: 1.86 });
  // calmar/sortino are 负值暂不排名 on this fund — must still come through.
  assert.deepEqual(r.calmar, { fund: -0.46, peer: 4.09 });
  assert.deepEqual(r.sortino, { fund: -0.89, peer: 3.92 });

  // 风险和波动 block
  assert.deepEqual(r.stdDev, { fund: 16.56, peer: 20.06 });
  assert.equal(r.maxDrawdown, -23.88);
  assert.equal(r.downsideRisk, 12.79);
  assert.deepEqual(r.morningstarRisk, { fund: 2.19, peer: 5.10 });  // 4th 风险和波动 row

  // 相对收益 block — singletons
  assert.equal(r.alpha, -17.46);
  assert.equal(r.beta, 0.93);
  assert.equal(r.rSquared, 0.52);
  assert.equal(r.excessReturn, -19.7);
  assert.equal(r.trackingError, 10.21);
  assert.equal(r.infoRatio, -201.05);
  assert.equal(r.monthlyWinRate, 33.33);

  // Capture ratios — may exceed 100; do NOT clamp.
  assert.equal(r.upsideCapture, 57.02);
  assert.equal(r.downsideCapture, 178.61);
});

test('extractRisk returns all 16 schema fields, never undefined', () => {
  const lines = loadLines();
  const r = extractRisk(lines, { code: '005827' });
  const keys = [
    'sharpe', 'calmar', 'sortino', 'stdDev',
    'maxDrawdown', 'downsideRisk', 'morningstarRisk', 'alpha', 'beta', 'rSquared',
    'excessReturn', 'trackingError', 'infoRatio', 'monthlyWinRate',
    'upsideCapture', 'downsideCapture',
  ];
  for (const k of keys) {
    assert.ok(k in r, `missing field ${k}`);
    assert.notEqual(r[k], undefined, `${k} is undefined`);
  }
});

test('extractRisk is null-safe on empty input', () => {
  const r = extractRisk([], { code: '005827' });
  assert.equal(r.downsideCapture, null);
  assert.equal(r.sharpe, null);
  assert.equal(r.maxDrawdown, null);
});
