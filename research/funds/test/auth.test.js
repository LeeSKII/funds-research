const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadToken, isTokenExpired } = require('../core/auth');

function tmpBundle(obj) {
  const p = path.join(os.tmpdir(), `tok-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('loadToken throws when file missing', () => {
  assert.throws(() => loadToken('/nope/missing.json'), /token file not found/);
});

test('loadToken reads token + exp', () => {
  const p = tmpBundle({ token: 'abc.def.ghi', exp: 1800000000, source: 'localStorage' });
  const t = loadToken(p);
  assert.equal(t.token, 'abc.def.ghi');
  assert.equal(t.exp, 1800000000);
  fs.unlinkSync(p);
});

test('isTokenExpired true when now past exp', () => {
  const bundle = { token: 'x', exp: 1000 }; // exp=1000s (epoch seconds)
  assert.equal(isTokenExpired(bundle, 0, 2_000_000), true); // now(ms) well past 1000s
});

test('isTokenExpired false when token fresh', () => {
  const bundle = { token: 'x', exp: 9999999999 }; // far future (seconds)
  assert.equal(isTokenExpired(bundle, 0, Date.now()), false);
});
