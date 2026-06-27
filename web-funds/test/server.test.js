import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from '../server.js';

test('buildBundle: loads snapshot/score/changes + dossiers with correct shape', () => {
  const b = buildBundle();
  assert.equal(b.asOfDate, '2026-06-27');
  assert.equal(b.fundCount, 317);
  // snapshot.count is the LIVE market screener output — varies day-to-day as funds enter/leave the
  // universe. Assert a stable lower bound + internal consistency, NOT a hardcoded count.
  assert.ok(b.snapshot.count > 380, `snapshot.count ${b.snapshot.count} unexpectedly low`);
  assert.ok(Array.isArray(b.snapshot.rows) && b.snapshot.rows.length === b.snapshot.count);
  assert.equal(b.cards.length, 317);
  assert.equal(b.defaults.fineWeights.trueAlpha, 0.4);
  assert.equal(b.screenThresholds.rating3Y_min, 4);
  assert.ok(Array.isArray(b.changes));
  assert.ok(Array.isArray(b.resolutions?.resolved), 'resolutions.resolved is an array');
  assert.ok(Object.keys(b.dossiers).length > 200, 'dossiers loaded');
});

test('buildBundle: heatmap sectors + ranked arrays present', () => {
  const b = buildBundle();
  assert.ok(b.heatmap.sectors.length > 0);
  assert.ok(Array.isArray(b.ranked.bySectorFlow));
});
