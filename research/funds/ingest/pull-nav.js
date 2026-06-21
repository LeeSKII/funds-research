// research/funds/ingest/pull-nav.js — standalone NAV puller (the Node half of the browser-hybrid architecture).
//
// POSTs /cn-api/v2/funds/<id>/growth-data with the SAME token auth as search/es (core/client.js).
// Keyed by the 6-digit id in the path — NO secId needed (live-confirmed 2026-06-21; the earlier
// "needs F00 secId" premise was an unverified assumption, now dropped — see fund-detail-api.md §5).
// Returns the daily cumulative-return series (rebased to initValue=10000 ≡ effective NAV), which is
// exactly what the backtest consumes. Browser is NOT needed for this half — only the JWT + the id.
//
// `catAvgSecId` affects ONLY the peer-average series, never the fund's own series (keyed by secIds).
// So a wrong/default catAvg degrades the peer line, not the NAV line the backtest reads.
//
// USAGE:
//   node research/funds/ingest/pull-nav.js <6-digit-id> [catAvgSecId] [-o <out.json>] [--start DATE] [--end DATE]
//   node research/funds/ingest/pull-nav.js 006502
//
// Output : data/fund/nav-<id>-<date>.json  (-o overrides). Module export: pullNav(id, opts).

const fs = require('fs');
const path = require('path');

const BASE = 'https://www.morningstar.cn';

function loadToken() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'secrets', 'token.json'), 'utf8')).token;
}

/**
 * Pull a fund's daily cumulative-return (NAV) series + manager-change events.
 * @param {string} id  6-digit fund id (the universal key).
 * @param {object} [opts]
 * @param {string} [opts.token]  JWT (default: read from research/funds/secrets/token.json).
 * @param {string} [opts.catAvgSecId]  category-average secId (peer series only; default generic).
 * @param {string} [opts.startDate]  ISO date (default 2015-01-01 — wide; API returns what exists).
 * @param {string} [opts.endDate]    ISO date (default today).
 * @param {typeof fetch} [opts.fetchImpl]  injectable for tests (default globalThis.fetch).
 * @returns {Promise<object>}  { meta, dates, fundSeries, catAvgSeries, bmkSeries, managerIds, ... }
 */
async function pullNav(id, opts = {}) {
  const token = opts.token || loadToken();
  const fetcher = opts.fetchImpl || globalThis.fetch;
  const catAvgSecId = opts.catAvgSecId || 'CHCA000000';
  const endDate = opts.endDate || new Date().toISOString().slice(0, 10);
  const startDate = opts.startDate || '2015-01-01';
  const body = {
    growthDataPoint: 'cumulativeReturn',
    initValue: 10000, freq: '1d', currency: 'CNY', type: 'return',
    calcBmkSecId: 'PBMK',       // benchmark placeholder (NOT the fund secId)
    catAvgSecId,
    bmk1SecId: 'PBMK',
    startDate, endDate,
    outputs: ['tsData', 'pr', 'dividend', 'management'],
  };

  // Retry once on HTTP 429 (same policy as core/client.js searchFunds).
  let res, attempt = 0;
  for (;;) {
    res = await fetcher(`${BASE}/cn-api/v2/funds/${id}/growth-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': token, 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status !== 429 || attempt++) break;
    await new Promise(r => setTimeout(r, 800));
  }

  const json = await res.json();
  if (String(json._meta?.response_status) !== '200011') {
    throw new Error(`growth-data for ${id} failed: response_status=${json._meta?.response_status} hint=${json._meta?.response_hint} http=${res.status}`);
  }

  const d = json.data || {};
  const ts = d.tsData || {};
  const fundSeries = ts.funds?.[0] || [];
  const dates = ts.dates || [];

  // manager ids ride along for free in managerChangeEvents (→ drives the mgr-* XHR family).
  const mgrIds = new Set();
  for (const e of (d.managerChangeEvents || [])) {
    [...(e.beforeManagers || []), ...(e.afterManagers || [])].forEach(m => m.managerId && mgrIds.add(m.managerId));
  }

  return {
    meta: {
      id, pulled_at: new Date().toISOString(),
      window: { startDate: d.startDate || startDate, endDate: d.endDate || endDate },
      secIds: d.secIds || [id],
      points: fundSeries.length,
      currency: d.cur || 'CNY',
      // the trailing point is often null (incomplete latest day) — flag for consumers
      trailingPointIncomplete: fundSeries.length && fundSeries[fundSeries.length - 1] == null,
    },
    dates,
    fundSeries,
    catAvgSeries: ts.catAvg || null,
    bmkSeries: ts.bmk1 || null,
    managerIds: [...mgrIds],
    managerChangeEvents: d.managerChangeEvents || [],
    pr: d.pr || null,
    dividends: d.dividend || [],
    rollingReturn: d.rollingReturn || null,
  };
}

function atomicWrite(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function main(argv) {
  const args = argv.slice(2);
  const id = args.find(a => /^\d{6}$/.test(a));
  if (!id) { console.error('Usage: node research/funds/ingest/pull-nav.js <6-digit-id> [catAvgSecId] [-o <out>] [--start DATE] [--end DATE]'); process.exit(1); }
  const catAvg = args.find(a => /^CHCA/.test(a));
  const outIdx = args.indexOf('-o');
  const outOverride = outIdx >= 0 ? args[outIdx + 1] : null;
  const startIdx = args.indexOf('--start');
  const endIdx = args.indexOf('--end');
  const opts = {
    ...(catAvg ? { catAvgSecId: catAvg } : {}),
    ...(startIdx >= 0 ? { startDate: args[startIdx + 1] } : {}),
    ...(endIdx >= 0 ? { endDate: args[endIdx + 1] } : {}),
  };

  (async () => {
    const t0 = Date.now();
    const result = await pullNav(id, opts);
    const ms = Date.now() - t0;
    const nav = result.fundSeries;
    const real = [...nav].reverse().find(x => x != null && x !== 0);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const outPath = path.resolve(outOverride || `data/fund/nav-${id}-${date}.json`);
    atomicWrite(outPath, result);
    console.log(`✓ pulled ${id} → ${outPath}  (${ms}ms, response_status 200011)`);
    console.log(`  window ${result.meta.window.startDate} → ${result.meta.window.endDate}   points=${nav.length}   peak≈${real != null ? real.toFixed(2) + '%' : 'n/a'}   managerIds=${result.managerIds.join(',') || 'none'}   dividends=${result.dividends.length}`);
    if (result.meta.trailingPointIncomplete) console.log(`  note: trailing point null (incomplete latest day) — consumers should read last NON-null`);
  })().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}

module.exports = { pullNav, loadToken, BASE };
if (require.main === module) main(process.argv);
