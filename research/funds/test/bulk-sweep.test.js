const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path'); const fs = require('fs'); const os = require('os');
const { bulkSweep } = require('../orchestrate/bulk-sweep');
const { loadState, isDone, isFailed } = require('../core/state');

const fixture = require('../test/fixtures/mock-fund-innertext.json');
const mockInnerText = (code) => fixture.innerText.replace(/005827/g, code);

test('bulkSweep: 3 码 → 写 3 dossier + state 记 done；validateDossier 真实校验通过', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-'));
  const stateFile = path.join(out, 'state.json');
  const fetchPage = async (code) => mockInnerText(code);
  const r = await bulkSweep({ codes: ['100001', '100002', '100003'], fetchPage, outDir: out, stateFile, date: '20260627', throttleMs: 0, sleep: async () => {} });
  assert.strictEqual(r.swept, 3);
  assert.strictEqual(r.done, 3);
  assert.strictEqual(r.failed, 0);
  for (const c of ['100001', '100002', '100003']) {
    assert.ok(fs.existsSync(path.join(out, c, `fund-${c}-20260627.json`)), `dossier for ${c} missing`);
  }
  const st = loadState(stateFile);
  assert.ok(isDone(st, '100001'));
  assert.strictEqual(Object.keys(st.done).length, 3);
});

test('bulkSweep: 断点续跑 — state 已 done 的码被 skip', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-'));
  const stateFile = path.join(out, 'state.json');
  const fetchPage = async (code) => mockInnerText(code);
  await bulkSweep({ codes: ['200001', '200002'], fetchPage, outDir: out, stateFile, date: '20260627', throttleMs: 0, sleep: async () => {} });
  // 第二次：全部已 done → skipped=2, swept=0，fetchPage 不再被调用
  let calls = 0;
  const r2 = await bulkSweep({ codes: ['200001', '200002'], fetchPage: async (c) => { calls++; return mockInnerText(c); }, outDir: out, stateFile, date: '20260627', throttleMs: 0, sleep: async () => {} });
  assert.strictEqual(r2.swept, 0);
  assert.strictEqual(r2.skipped, 2);
  assert.strictEqual(calls, 0);
});

test('bulkSweep: 单码失败（retry 耗尽）→ markFailed，其余正常完成', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-'));
  const stateFile = path.join(out, 'state.json');
  const fetchPage = async (code) => { if (code === '300002') throw new Error('network down'); return mockInnerText(code); };
  const r = await bulkSweep({ codes: ['300001', '300002', '300003'], fetchPage, outDir: out, stateFile, date: '20260627', throttleMs: 0, sleep: async () => {}, retry: { retries: 1, sleep: async () => {} } });
  assert.strictEqual(r.done, 2);
  assert.strictEqual(r.failed, 1);
  assert.ok(r.failures.some(f => f.code === '300002'));
  const st = loadState(stateFile);
  assert.ok(isDone(st, '300001'));
  assert.ok(isFailed(st, '300002'));
});

test('bulkSweep: throttle 每只之间调用 sleep', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-'));
  const stateFile = path.join(out, 'state.json');
  let sleeps = 0;
  const r = await bulkSweep({ codes: ['400001', '400002'], fetchPage: async (c) => mockInnerText(c), outDir: out, stateFile, date: '20260627', throttleMs: 100, sleep: async () => { sleeps++; } });
  assert.strictEqual(r.done, 2);
  assert.ok(sleeps >= 2); // 每只之后都 throttle
});

test('bulkSweep: fetchPage 缺失 → 显式报错（防误用）', async () => {
  await assert.rejects(() => bulkSweep({ codes: ['500001'], outDir: os.tmpdir() }), /fetchPage required/);
});

test('bulkSweep: fetchPage 返回空串 → 该码标记失败（根因明确，不静默落空 dossier）', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-'));
  const stateFile = path.join(out, 'state.json');
  const r = await bulkSweep({ codes: ['600001', '600002'], fetchPage: async (c) => c === '600001' ? mockInnerText(c) : '', outDir: out, stateFile, date: '20260627', throttleMs: 0, sleep: async () => {}, retry: { retries: 0, sleep: async () => {} } });
  assert.strictEqual(r.done, 1);
  assert.strictEqual(r.failed, 1);
  assert.ok(r.failures.some(f => f.code === '600002' && /empty text/.test(f.error)));
});
