// orchestrate/shard.js — search/es 分片检索（ops 硬化 + PLAN「Sharded retrieval if universe >cap」）。
//
// 当 snapshot.totalCount > count（静默截断，见 market-sweep 截断守卫）时，把单次 search_filter 拆成
// 多个 DISJOINT 子调用，按维度值切分，并集 = 原范围，无重叠 → 100% 捕获，永不静默丢基金。
//
// 维度示例（universe.json）：broadCategoryId × fundSize 桶 → 2×4=8 个 disjoint 子 filter。
// 每个子 filter = {...base, [dimField]: [singleValue]}（覆盖 base 的该字段数组，留其余结构 gate 不变）。
//
// 纯函数：给 base filter + 维度列表 → 子 filter 数组。无 IO，易测。

/**
 * @param {object} baseFilter  原 search_filter（如 universe.search_filter）
 * @param {{field:string, values:string[]}[]} dimensions  分片维度（每个 values 必须 disjoint 且覆盖原范围）
 * @returns {object[]}  disjoint 子 filter 数组
 */
function shardFilter(baseFilter, dimensions) {
  if (!Array.isArray(dimensions) || dimensions.length === 0) return [JSON.parse(JSON.stringify(baseFilter))];
  // 各维度的取值列表 → 笛卡尔积，每组合产一个子 filter
  let combos = [{}];
  for (const dim of dimensions) {
    const next = [];
    for (const c of combos) for (const v of dim.values) next.push({ ...c, [dim.field]: v });
    combos = next;
  }
  return combos.map(combo => {
    const sub = JSON.parse(JSON.stringify(baseFilter));
    for (const dim of dimensions) sub[dim.field] = [combo[dim.field]]; // 单值数组，覆盖原
    return sub;
  });
}

/**
 * 校验分片正确性：子 filter 数 == 笛卡尔积大小；各子 filter 在分片维度上取值唯一组合（disjoint）。
 * @returns {{ok:boolean, reason?:string, count:number}}
 */
function verifyShard(subs, dimensions) {
  const expected = dimensions.reduce((n, d) => n * d.values.length, 1);
  if (subs.length !== expected) return { ok: false, reason: `count ${subs.length} != expected ${expected}`, count: subs.length };
  const keys = subs.map(s => dimensions.map(d => s[d.field].join(',')).join('|'));
  if (new Set(keys).size !== keys.length) return { ok: false, reason: 'overlapping sub-filters (duplicate dimension combo)', count: subs.length };
  return { ok: true, count: subs.length };
}

module.exports = { shardFilter, verifyShard };
