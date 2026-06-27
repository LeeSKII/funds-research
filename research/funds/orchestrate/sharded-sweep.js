// orchestrate/sharded-sweep.js — 分片检索 runner（ops 硬化「pagination if universe >1000」）。
//
// 当单次 search/es 截断（totalCount>count）时，用 shardFilter 把 search_filter 拆成 disjoint 子调用，
// 逐个 searchFunds（已带 withRetry），聚合 + 按 id 去重 → 100% 捕获的合并快照。
// 子调用若仍截断（维度不够细），truncated 计数告警（不静默）。
//
// 离线可测：注入 fake searchFunds，按子 filter 返回 disjoint 行集，断言聚合 == 并集。

const { shardFilter } = require('./shard');
const { validate } = require('../core/validate');

/**
 * @param {object} opts
 * @param {(o:object)=>Promise<object>} opts.searchFunds  注入（生产用 core/client.searchFunds）
 * @param {string} [opts.token]
 * @param {object} opts.baseFilter     universe.search_filter
 * @param {{field:string,values:string[]}[]} opts.dimensions  分片维度
 * @param {string} [opts.date]
 * @param {typeof fetch} [opts.fetchImpl]  透传给 searchFunds
 * @returns {Promise<{date,source,count,totalCount,rows,shards,truncated}>}
 */
async function shardedSweep({ searchFunds, token, baseFilter, dimensions, date, fetchImpl }) {
  const day = date || new Date().toISOString().slice(0, 10);
  const subs = shardFilter(baseFilter, dimensions);
  const rows = [];
  const seen = new Set();
  let truncated = 0;
  for (const sub of subs) {
    const snap = await searchFunds({ token, filter: sub, fetchImpl, date: day });
    if (typeof snap.totalCount === 'number' && snap.totalCount > snap.count) {
      truncated += snap.totalCount - snap.count; // 子调用仍截断 → 维度不够细，告警不静默
    }
    for (const r of snap.rows || []) {
      if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
    }
  }
  const combined = { date: day, source: 'morningstar:search/es:sharded', count: rows.length, totalCount: rows.length, rows, shards: subs.length, truncated };
  const v = validate('snapshot', combined);
  if (!v.valid) throw new Error(`[sharded-sweep] combined snapshot failed schema:\n  - ${v.errors.join('\n  - ')}`);
  return combined;
}

module.exports = { shardedSweep };
