const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDaily } = require('../orchestrate/run');

test('offline runDaily chains sweep→diff→screen and writes all three artifacts', async () => {
  const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  process.env.ENGINE_STORE_DIR = tmpStore;

  // first run: no prior snapshot → diff skipped, suspiciousIdentical false
  const r1 = await runDaily({ offline: true, date: '2026-06-20' });
  assert.ok(r1.swept > 0);
  assert.equal(r1.changes, 0); // no prior day
  assert.equal(r1.suspiciousIdentical, false);
  assert.ok(r1.candidates >= 0);

  // second run (next day) → same fixture both days = byte-identical → guard fires (changes still 0, idempotent)
  const r2 = await runDaily({ offline: true, date: '2026-06-21' });
  assert.equal(r2.changes, 0);
  assert.equal(r2.suspiciousIdentical, true); // correctly flags the artificial identical fixture
  assert.ok(fs.existsSync(path.join(tmpStore, 'snapshots', '2026-06-21.json')));
  assert.ok(fs.existsSync(path.join(tmpStore, 'changes', '2026-06-21.json')));
  assert.ok(fs.existsSync(path.join(tmpStore, 'derived', 'candidates-2026-06-21.json')));

  delete process.env.ENGINE_STORE_DIR;
  fs.rmSync(tmpStore, { recursive: true, force: true });
});
