const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path'); const fs = require('fs'); const os = require('os');
const { emptyState, loadState, saveState, isDone, isFailed, markDone, markFailed, nextPending, summary } = require('../core/state');

test('emptyState / loadState(缺失) → 空 state', () => {
  assert.strictEqual(Object.keys(emptyState().done).length, 0);
  const s = loadState(path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.json'));
  assert.strictEqual(Object.keys(s.done).length, 0);
  assert.strictEqual(Object.keys(s.failed).length, 0);
});

test('markDone/markFailed/isDone/nextPending：去重 + 续跑', () => {
  const s = emptyState();
  markDone(s, '006502'); markDone(s, '001048');
  markFailed(s, '999999', 'timeout');
  assert.ok(isDone(s, '006502'));
  assert.ok(!isDone(s, '518880'));
  assert.ok(isFailed(s, '999999'));
  assert.deepStrictEqual(nextPending(s, ['006502', '518880', '001048', '000411']), ['518880', '000411']);
  // markDone 清 failed
  markDone(s, '999999'); assert.ok(!isFailed(s, '999999'));
  assert.deepStrictEqual(summary(s), { done: 3, failed: 0, updatedAt: s.updatedAt });
});

test('saveState/loadState 往返：done/failed 保持', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'state-')), 'state.json');
  const s = emptyState();
  markDone(s, '006502'); markFailed(s, '000001', 'err');
  saveState(file, s, 1700000000000);
  const loaded = loadState(file);
  assert.ok(isDone(loaded, '006502'));
  assert.ok(isFailed(loaded, '000001'));
  assert.strictEqual(loaded.failed['000001'], 'err');
  assert.ok(loaded.updatedAt);
});

test('loadState 损坏文件 → 优雅返回空（最坏重抓，不致命）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{ not valid json');
  const s = loadState(file);
  assert.strictEqual(Object.keys(s.done).length, 0);
});
