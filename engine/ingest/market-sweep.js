// ingest/market-sweep.js — search/es full market → store/snapshots/<date>.json
const fs = require('fs');
const path = require('path');
const { searchFunds, normalizeRow } = require('../core/client');
const { loadToken } = require('../core/auth');
const { loadConfig } = require('../core/config');
const { validate } = require('../core/validate');

function _storeDir() {
  return process.env.ENGINE_STORE_DIR || path.join(__dirname, '..', 'store');
}
const FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'search-es.sample.json');

/**
 * @param {object} [opts]
 * @param {boolean} [opts.offline=false]  read fixture instead of hitting the API
 * @param {string} [opts.date]            YYYY-MM-DD (default today UTC)
 * @param {typeof fetch} [opts.fetchImpl] injected into searchFunds (tests)
 * @returns {Promise<{ path: string, count: number }>}
 */
async function marketSweep(opts = {}) {
  const { offline = false, date, fetchImpl } = opts;
  const day = date || new Date().toISOString().slice(0, 10);

  let snapshot;
  if (offline) {
    const captured = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
    const rows = (captured.data?.rows || []).map(normalizeRow);
    snapshot = { date: day, source: 'fixture:search-es', count: rows.length, rows };
  } else {
    const { token } = loadToken();
    const { universe } = loadConfig();
    snapshot = await searchFunds({ token, filter: universe.search_filter, fetchImpl, date: day });
  }

  const v = validate('snapshot', snapshot);
  if (!v.valid) throw new Error(`[market-sweep] snapshot failed schema:\n  - ${v.errors.join('\n  - ')}`);
  if (snapshot.count === 0) {
    // spec §11: a 0-row response is never "no funds today" — it's a rate limit or 改版.
    // Refuse to write an empty snapshot so diff/screen don't silently run on a void market.
    throw new Error('[market-sweep] search/es returned 0 rows — suspected rate limit or API change; refusing empty snapshot');
  }

  const snapDir = path.join(_storeDir(), 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  const outPath = path.join(snapDir, `${day}.json`);
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmp, outPath); // atomic write
  return { path: outPath, count: snapshot.count };
}

module.exports = { marketSweep };
