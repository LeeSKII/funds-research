import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeights, computeDelta, tierBadgeClass, gateLabel, fmt, matchesQuery } from '../public/lib/ui-util.mjs';

test('normalizeWeights: 拖大一个，其余按比例让位，Σ=1', () => {
  const w = { trueAlpha: 0.4, downsideProtection: 0.25, sectorFlow: 0.15, band: 0.1, endorsement: 0.1 };
  const out = normalizeWeights(w, 'sectorFlow', 0.45);
  assert.ok(Math.abs(Object.values(out).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(out.sectorFlow, 0.45);
  assert.ok(out.trueAlpha < 0.4);
});

test('computeDelta: +delta = 上升 (up)', () => {
  assert.equal(computeDelta(5, 3).delta, 2);
  assert.equal(computeDelta(5, 3).dir, 'up');
  assert.equal(computeDelta(3, 5).dir, 'dn');
  assert.equal(computeDelta(4, 4).dir, 'flat');
});

test('tierBadgeClass / gateLabel / fmt', () => {
  assert.equal(tierBadgeClass('true_alpha'), 'true');
  assert.equal(tierBadgeClass('mixed'), 'mix');
  assert.equal(tierBadgeClass('industry_beta_pseudo'), 'beta');
  assert.equal(gateLabel('usd_shareclass'), 'USD份额');
  assert.equal(gateLabel('size_cap'), '规模>100亿');
  assert.equal(fmt(0.834, 'pct1'), '83.4%');
});

test('matchesQuery: empty/whitespace → match all; substring on code or name; case-insensitive', () => {
  assert.equal(matchesQuery('012922', '易方达全球成长精选', ''), true);
  assert.equal(matchesQuery('012922', '易方达全球成长精选', '   '), true);
  assert.equal(matchesQuery('012922', '易方达全球成长精选', '012922'), true);        // code match
  assert.equal(matchesQuery('012922', '易方达全球成长精选', '129'), true);           // code substring
  assert.equal(matchesQuery('012922', '易方达全球成长精选', '易方达全球'), true);    // name substring
  assert.equal(matchesQuery('012922', '易方达全球成长精选', 'XYZ'), false);          // no match
  assert.equal(matchesQuery('006502', '财通集成电路', 'Caitong'), false);            // case: latin name won't match pinyin
});
