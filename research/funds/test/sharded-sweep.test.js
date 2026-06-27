const test = require('node:test'); const assert = require('node:assert');
const { shardedSweep } = require('../orchestrate/sharded-sweep');

const base = { rating3Y: ['4', '5'], broadCategoryId: ['$BCG$EQUTY', '$BCG$ALLOC'], fundSize: ['2~5', '5~10'], sign: '1' };
const dims = [
  { field: 'broadCategoryId', values: ['$BCG$EQUTY', '$BCG$ALLOC'] },
  { field: 'fundSize', values: ['2~5', '5~10'] },
];

// fake searchFunds：按子 filter 的 (broadCategoryId, fundSize) 返回 disjoint 的 2 行/分片
function fakeSearchFunds() {
  let n = 0;
  return async ({ filter }) => {
    const key = `${filter.broadCategoryId[0]}|${filter.fundSize[0]}`;
    const rows = [1, 2].map(() => ({
      id: String(100000 + n++), fundName: key, rating3Y: 4, managerName: 'm',
      detailUrl: `https://www.morningstar.cn/fund/${100000 + n - 1}.html`,
    }));
    return { date: '2026-06-27', source: 'fake', count: rows.length, totalCount: rows.length, rows };
  };
}

test('shardedSweep: 4 分片 × 2 行 = 8 行，disjoint 无重复，schema 合法', async () => {
  const snap = await shardedSweep({ searchFunds: fakeSearchFunds(), baseFilter: base, dimensions: dims, date: '2026-06-27' });
  assert.strictEqual(snap.shards, 4);
  assert.strictEqual(snap.count, 8);
  assert.strictEqual(snap.rows.length, 8);
  const ids = snap.rows.map(r => r.id);
  assert.strictEqual(new Set(ids).size, 8); // 无重复
});

test('shardedSweep: 跨分片重复 id 被去重（防御性）', async () => {
  let first = true;
  const searchFunds = async () => {
    // 两个分片都返回同一个 id（模拟维度非完全 disjoint）
    const rows = [{ id: '777777', fundName: 'dup', rating3Y: 4, managerName: 'm', detailUrl: 'https://www.morningstar.cn/fund/777777.html' }];
    return { date: '2026-06-27', source: 'fake', count: 1, totalCount: 1, rows };
  };
  const snap = await shardedSweep({ searchFunds, baseFilter: base, dimensions: dims, date: '2026-06-27' });
  assert.strictEqual(snap.count, 1); // 4 分片全重复 → 去重为 1
});

test('shardedSweep: 子调用截断 → truncated 计数告警（不静默）', async () => {
  const searchFunds = async () => ({ date: '2026-06-27', source: 'fake', count: 2, totalCount: 10, rows: [{ id: '100001', fundName: 'x', rating3Y: 4, managerName: 'm', detailUrl: 'https://www.morningstar.cn/fund/100001.html' }, { id: '100002', fundName: 'x', rating3Y: 4, managerName: 'm', detailUrl: 'https://www.morningstar.cn/fund/100002.html' }] });
  const snap = await shardedSweep({ searchFunds, baseFilter: base, dimensions: dims, date: '2026-06-27' });
  assert.ok(snap.truncated > 0); // 每分片丢 8，4 分片 = 32
  assert.strictEqual(snap.truncated, 32);
});
