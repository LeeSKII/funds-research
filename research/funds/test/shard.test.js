const test = require('node:test'); const assert = require('node:assert');
const { shardFilter, verifyShard } = require('../orchestrate/shard');

const base = {
  rating3Y: ['4', '5'],
  broadCategoryId: ['$BCG$EQUTY', '$BCG$ALLOC'],
  indexFund: 'false', enhancedIndexFund: 'false', fundOfFunds: 'false',
  oldestShareId: 'true', longestTenure: '>3',
  fundSize: ['2~5', '5~10', '10~50', '50~100'],
  trackPb36mRankPer: '50~100', sign: '1',
};

const dims = [
  { field: 'broadCategoryId', values: ['$BCG$EQUTY', '$BCG$ALLOC'] },
  { field: 'fundSize', values: ['2~5', '5~10', '10~50', '50~100'] },
];

test('shardFilter: 2×4 维度 → 8 个子 filter', () => {
  const subs = shardFilter(base, dims);
  assert.strictEqual(subs.length, 8);
});

test('shardFilter: 每个子 filter 单值覆盖分片维度 + 保留 base 结构 gate', () => {
  const subs = shardFilter(base, dims);
  for (const s of subs) {
    assert.strictEqual(s.broadCategoryId.length, 1);
    assert.strictEqual(s.fundSize.length, 1);
    // 结构 gate 原样保留
    assert.deepStrictEqual(s.rating3Y, ['4', '5']);
    assert.strictEqual(s.indexFund, 'false');
    assert.strictEqual(s.trackPb36mRankPer, '50~100');
  }
});

test('shardFilter: 子 filter 在分片维度上 disjoint（无重复组合）+ 并集覆盖', () => {
  const subs = shardFilter(base, dims);
  const v = verifyShard(subs, dims);
  assert.ok(v.ok, v.reason);
  // 每个组合唯一
  const combos = subs.map(s => `${s.broadCategoryId[0]}|${s.fundSize[0]}`);
  assert.strictEqual(new Set(combos).size, combos.length);
  // 并集覆盖原 base 的全交叉（EQUTY/ALLOC × 4 桶）
  assert.ok(combos.includes('$BCG$EQUTY|2~5'));
  assert.ok(combos.includes('$BCG$ALLOC|50~100'));
});

test('shardFilter: 无维度 → [base 拷贝]（不拆）', () => {
  const subs = shardFilter(base, []);
  assert.strictEqual(subs.length, 1);
  assert.deepStrictEqual(subs[0].broadCategoryId, base.broadCategoryId); // 原样
});

test('shardFilter: 改 base 不污染原对象（深拷贝）', () => {
  const subs = shardFilter(base, dims);
  assert.deepStrictEqual(base.broadCategoryId, ['$BCG$EQUTY', '$BCG$ALLOC']); // 原对象未被改
  assert.strictEqual(subs[0].broadCategoryId.length, 1);
});
