const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../core/validate');

test('snapshot schema accepts a valid snapshot', () => {
  const snap = {
    date: '2026-06-21', source: 'morningstar:search/es', count: 1,
    rows: [{ id: '005161', fundName: '华商上游产业股票A', rating3Y: 5, rating5Y: 5, managerName: '某经理', detailUrl: 'https://www.morningstar.cn/fund/005161.html' }],
  };
  const r = validate('snapshot', snap);
  assert.equal(r.valid, true, r.errors.join('; '));
});

test('snapshot schema rejects a 5-digit id and out-of-range rating', () => {
  const snap = {
    date: '2026-06-21', source: 'x', count: 1,
    rows: [{ id: '12345', fundName: 'bad', rating3Y: 9, managerName: 'm', detailUrl: 'https://www.morningstar.cn/fund/12345.html' }],
  };
  const r = validate('snapshot', snap);
  assert.equal(r.valid, false);
  assert.ok(r.errors.length >= 1);
});

test('change-event schema accepts new_fund + rating_change', () => {
  const ce = { date: '2026-06-21', events: [
    { code: '005161', fundName: 'x', type: 'new_fund', field: null, before: null, after: null },
    { code: '006502', fundName: 'y', type: 'rating_change', field: 'rating3Y', before: 5, after: 4 },
  ] };
  assert.equal(validate('change-event', ce).valid, true);
});
