const test = require('node:test'); const assert = require('node:assert');
const { withRetry } = require('../core/retry');

test('withRetry: 首次成功 → 只调一次', async () => {
  let calls = 0;
  const r = await withRetry(async () => { calls++; return 'ok'; }, { sleep: async () => {} });
  assert.strictEqual(r, 'ok'); assert.strictEqual(calls, 1);
});

test('withRetry: 失败 2 次后成功 → 调 3 次，返回成功值', async () => {
  let calls = 0;
  const r = await withRetry(async () => { calls++; if (calls < 3) throw new Error('boom'); return 'ok'; }, { retries: 3, sleep: async () => {} });
  assert.strictEqual(r, 'ok'); assert.strictEqual(calls, 3);
});

test('withRetry: 持续失败 → retries+1 次后抛出', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error('always'); }, { retries: 2, sleep: async () => {} }), /always/);
  assert.strictEqual(calls, 3); // 1 + 2 retries
});

test('withRetry: isRetryable=false → 立即抛出不重试', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error('fatal'); }, { retries: 5, sleep: async () => {}, isRetryable: () => false }), /fatal/);
  assert.strictEqual(calls, 1);
});

test('withRetry: 指数退避延迟（random=0.5 抖动归零）→ [500,1000,2000] 单调递增', async () => {
  const delays = [];
  let calls = 0;
  await withRetry(async () => { calls++; if (calls <= 3) throw new Error('x'); return 'ok'; },
    { retries: 3, baseDelay: 500, factor: 2, jitter: 0.25, random: () => 0.5, sleep: async (ms) => { delays.push(ms); } });
  assert.deepStrictEqual(delays, [500, 1000, 2000]);
});

test('withRetry: onRetry 收到 attempt + delay', async () => {
  const seen = [];
  let calls = 0;
  await withRetry(async () => { calls++; if (calls < 2) throw new Error('x'); return 'ok'; },
    { retries: 3, baseDelay: 100, random: () => 0.5, sleep: async () => {}, onRetry: (err, attempt, delay) => seen.push({ attempt, delay, msg: err.message }) });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].attempt, 1);
  assert.strictEqual(seen[0].delay, 100);
});
