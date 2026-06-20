const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { marketSweep } = require('../ingest/market-sweep');

test('offline marketSweep writes a schema-valid snapshot', async () => {
  const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  // point the module's SNAP_DIR at the temp dir via env override
  process.env.ENGINE_STORE_DIR = tmpStore;
  const { count, path: outPath } = await marketSweep({ offline: true, date: '2026-06-21' });
  assert.ok(count > 0);
  assert.match(outPath, /2026-06-21\.json$/);
  const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  assert.equal(written.date, '2026-06-21');
  assert.equal(written.count, count);
  delete process.env.ENGINE_STORE_DIR;
  fs.rmSync(tmpStore, { recursive: true, force: true });
});
