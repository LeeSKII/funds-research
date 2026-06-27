import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenRow, screenAll } from '../public/lib/screening.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

const t = {
  rating3Y_min: 4, rating5Y_min: 4, rating5Y_null_tolerant: true,
  longestTenure_min_years: 3, fundSize_min_yi: 2, fundSize_max_yi: 100,
  alphaToIndRankP_3Y_max: 50, sharpeRatioRankP_3Y_max: 50,
  exclude_usd_shareclass: true, defensive_drawdown_floor: -30,
};

test('screenRow: 全过的精英行 → passed', () => {
  const r = screenRow({ rating3Y: 5, rating5Y: 5, longestTenure: 4.7, fundSize: 10,
    alphaToIndRankP_3Y: 0.69, sharpeRatioRankP_3Y: 2.02, maximumDrawdown_3Y: -52, fundName: 'X' }, t);
  assert.equal(r.passed, true);
  assert.equal(r.gate, null);
});

test('screenRow: 012921 易方达全球成长精选 A(美元现汇) → gate=usd_shareclass', () => {
  const r = screenRow({ rating3Y: 5, rating5Y: null, longestTenure: 4.46, fundSize: 98.66,
    alphaToIndRankP_3Y: 1, sharpeRatioRankP_3Y: 1.74, maximumDrawdown_3Y: -20.48,
    fundName: '易方达全球成长精选混合（QDII）A(美元现汇份额)' }, t);
  assert.equal(r.passed, false);
  assert.equal(r.gate, 'usd_shareclass');
});

test('screenRow: 规模>100 → size_cap; α排名>50 → alpha_rank; 评级<4 → rating3Y', () => {
  assert.equal(screenRow({ rating3Y: 5, longestTenure: 5, fundSize: 150, alphaToIndRankP_3Y: 1, sharpeRatioRankP_3Y: 1, fundName: 'A' }, t).gate, 'size_cap');
  assert.equal(screenRow({ rating3Y: 5, longestTenure: 5, fundSize: 50, alphaToIndRankP_3Y: 80, sharpeRatioRankP_3Y: 1, fundName: 'A' }, t).gate, 'alpha_rank');
  assert.equal(screenRow({ rating3Y: 3, longestTenure: 5, fundSize: 50, alphaToIndRankP_3Y: 1, sharpeRatioRankP_3Y: 1, fundName: 'A' }, t).gate, 'rating3Y');
});

test('parity: default thresholds 过关 set == candidates-2026-06-26.json (by id)', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/snapshots/2026-06-26.json'), 'utf8'));
  const cands = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/derived/candidates-2026-06-26.json'), 'utf8'));
  const thresholds = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/core/config/thresholds.json'), 'utf8'));
  const { passed } = screenAll(snap.rows, thresholds);
  const passedIds = new Set(passed.map((r) => r.id));
  const candIds = new Set((cands.rows || cands).map((r) => r.id || r.code));
  for (const id of candIds) assert.ok(passedIds.has(id), `candidate ${id} not reproduced`);
  assert.equal(passedIds.size, candIds.size, `passed ${passedIds.size} vs candidates ${candIds.size}`);
});

test('parity: 012921 (易方达全球成长精选 A 美元现汇) rejected as usd_shareclass', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/snapshots/2026-06-26.json'), 'utf8'));
  const thresholds = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/core/config/thresholds.json'), 'utf8'));
  const { rejected } = screenAll(snap.rows, thresholds);
  const row = rejected.find((x) => x.row.id === '012921');
  assert.ok(row, '012921 must be in snapshot');
  assert.equal(row.gate, 'usd_shareclass');
  assert.match(row.row.fundName, /美元/);
});
