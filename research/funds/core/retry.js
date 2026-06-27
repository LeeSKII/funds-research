// core/retry.js — 指数退避 + 抖动重试包装（ops 硬化）。
//
// 给所有外发调用（search/es、bulk-sweep 逐页抓取）一个统一的重试层，替换 client.js 里手写的
// 单次 429 重试。isRetryable(err, attempt) 决定哪些错误值得重试（默认全重）。sleep/random 可注入
// → 测试确定性：传 random=()=>0.5 抖动归零，delay 纯指数；传 fake sleep 收集 delay 序列断言单调递增。
//
// backoff = baseDelay * factor^(attempt-1) * (1 + jitter*(random*2-1))，random=0.5 → 恰好指数无偏移。

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {(attempt:number) => Promise<any>} fn  被 retry 的异步函数；接收当前 attempt(0-based)
 * @param {object} [opts]
 * @param {number} [opts.retries=3]              最多重试次数（总尝试 = retries+1）
 * @param {number} [opts.baseDelay=500]          首次重试延迟 ms
 * @param {number} [opts.factor=2]               退避倍数
 * @param {number} [opts.jitter=0.25]            抖动幅度 ±25%
 * @param {(ms:number)=>Promise} [opts.sleep]    注入（测试用）
 * @param {()=>number} [opts.random]             注入 [0,1)（测试用，默认 Math.random）
 * @param {(err:Error,attempt:number,delay:number)=>void} [opts.onRetry]
 * @param {(err:Error,attempt:number)=>boolean} [opts.isRetryable] false=立即抛出不重试
 */
async function withRetry(fn, opts = {}) {
  const {
    retries = 3, baseDelay = 500, factor = 2, jitter = 0.25,
    sleep = defaultSleep, random = Math.random, onRetry, isRetryable,
  } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      attempt++;
      const retryable = isRetryable ? isRetryable(err, attempt) : true;
      if (!retryable || attempt > retries) throw err;
      const backoff = baseDelay * Math.pow(factor, attempt - 1);
      const delay = Math.max(0, Math.round(backoff * (1 + jitter * (random() * 2 - 1))));
      if (onRetry) onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }
}

module.exports = { withRetry };
