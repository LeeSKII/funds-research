const test = require('node:test');
const assert = require('node:assert/strict');
const { diffSnapshots } = require('../analyze/diff');

const mk = rows => ({ rows });
const fund = (id, over = {}) => ({ id, fundName: `F${id}`, rating3Y: 5, rating5Y: 5, managerName: 'M1', ...over });

test('detects new fund', () => {
  const e = diffSnapshots(mk([]), mk([fund('005161')]), '2026-06-21').events;
  assert.equal(e.find(x => x.type === 'new_fund').code, '005161');
});

test('detects removed fund', () => {
  const e = diffSnapshots(mk([fund('005161')]), mk([]), '2026-06-21').events;
  assert.equal(e.find(x => x.type === 'removed').code, '005161');
});

test('detects rating drop 5→4', () => {
  const e = diffSnapshots(mk([fund('006502')]), mk([fund('006502', { rating3Y: 4 })]), '2026-06-21').events;
  const rc = e.find(x => x.type === 'rating_change');
  assert.equal(rc.field, 'rating3Y');
  assert.equal(rc.before, 5);
  assert.equal(rc.after, 4);
});

test('detects manager change', () => {
  const e = diffSnapshots(mk([fund('001048')]), mk([fund('001048', { managerName: 'M2' })]), '2026-06-21').events;
  assert.equal(e.find(x => x.type === 'manager_change').after, 'M2');
});

test('unchanged funds produce no events', () => {
  const e = diffSnapshots(mk([fund('005161')]), mk([fund('005161')]), '2026-06-21').events;
  assert.equal(e.length, 0);
});
