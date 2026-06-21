const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path');
const { loadDossiers, latestDossierForCode } = require('../analyze/loader');

test('loadDossiers aggregates latest dossier per code from data/fund/', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const map = loadDossiers(dir);
  assert.ok(map.size > 0);
  assert.ok(map.has('006502'));
  const d = map.get('006502');
  assert.strictEqual(d.description.code, '006502');
});

test('every loaded dossier has description + _diagnostics', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const map = loadDossiers(dir);
  for (const d of map.values()) { assert.ok(d.description); assert.ok(d._diagnostics); }
});

test('latestDossierForCode returns null for a missing code dir', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'data', 'fund', 'NONEXISTENT');
  assert.strictEqual(latestDossierForCode(dir, 'NONEXISTENT'), null);
});
