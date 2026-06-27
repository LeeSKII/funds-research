const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path'); const fs = require('fs'); const os = require('os');
const { runSmoke } = require('../orchestrate/smoke');

test('runSmoke: offline 全链路自检通过（snapshot/score/shortlist/report 都 schema 合法）', async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  const r = await runSmoke({ storeDir: store, date: '2026-06-27', offline: true });
  if (!r.ok) { console.log(JSON.stringify(r.steps, null, 2)); }
  assert.ok(r.ok, 'smoke should pass: ' + r.failed);
  // 关键步骤都在且 ok
  const names = r.steps.map(s => s.name);
  for (const key of ['daily:runDaily', 'daily:snapshot-valid', 'analysis:score-valid', 'shortlist:build', 'report:build']) {
    assert.ok(names.includes(key), `missing step ${key}`);
  }
  assert.ok(r.steps.every(s => s.ok));
});

test('runSmoke: 产物实际落盘（snapshot + score + shortlist + report）', async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  const r = await runSmoke({ storeDir: store, date: '2026-06-27', offline: true });
  assert.ok(r.ok);
  assert.ok(fs.existsSync(path.join(store, 'snapshots', '2026-06-27.json')));
  assert.ok(fs.existsSync(path.join(store, 'derived', 'score-2026-06-27.json')));
  assert.ok(fs.existsSync(path.join(store, 'derived', 'shortlist-2026-06-27.json')));
  assert.ok(fs.existsSync(path.join(store, 'derived', 'reports', 'pool-summary-2026-06-27.md')));
});
