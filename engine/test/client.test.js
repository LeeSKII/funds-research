const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { searchFunds, normalizeRow } = require('../core/client');

const captured = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'search-es.sample.json'), 'utf-8'));

function fakeFetchOk(capturedBody) {
  return async () => ({ ok: true, status: 200, json: async () => capturedBody });
}

test('normalizeRow coerces numeric strings and keeps nulls', () => {
  const r = normalizeRow({ id: '005161', fundName: 'X', rating3Y: '5', return1Year_M: '12.5', managerName: 'm', missing: undefined });
  assert.equal(r.id, '005161');
  assert.equal(r.rating3Y, 5);
  assert.equal(r.return1Year_M, 12.5);
});

test('searchFunds returns normalized snapshot from injected fetch', async () => {
  // NOTE: the real fixture carries response_status as a STRING "200011" — this test
  // locks the String()-based guard in client.js (regression guard for the blocker).
  const snap = await searchFunds({ token: 'fake.jwt.token', fetchImpl: fakeFetchOk(captured), date: '2026-06-21' });
  assert.equal(snap.date, '2026-06-21');
  assert.equal(snap.count, 190);
  assert.equal(snap.rows[0].id.length, 6);
  assert.equal(typeof snap.rows[0].rating3Y === 'number' || snap.rows[0].rating3Y === null, true);
});

test('searchFunds throws on bad response_status', async () => {
  const bad = { _meta: { response_status: '401', response_hint: 'no token' }, data: { rows: [] } };
  await assert.rejects(() => searchFunds({ token: 'x', fetchImpl: fakeFetchOk(bad) }), /bad status/);
});

test('searchFunds throws on HTTP error', async () => {
  const fail = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => searchFunds({ token: 'x', fetchImpl: fail }), /HTTP 500/);
});

test('searchFunds retries once on HTTP 429 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return calls === 1
      ? { ok: false, status: 429, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => captured };
  };
  const snap = await searchFunds({ token: 'x', fetchImpl, date: '2026-06-21' });
  assert.equal(calls, 2);       // retried exactly once
  assert.equal(snap.count, 190); // waits ~500ms for backoff; acceptable for one test
});
