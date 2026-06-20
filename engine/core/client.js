// core/client.js — morningstar Layer1 API client.
// Layer1 = /cn-api/v2/* (token-only RS256 JWT). Node-side calls bypass browser CORS.
const BASE = 'https://www.morningstar.cn';

const NUM_FIELDS = [
  'rating3Y', 'rating5Y', 'returnYTD_M', 'return1Year_M', 'return3Year_M', 'return5Year_M', 'return10Year_M',
  'alphaToIndRankP_1Y', 'alphaToIndRankP_3Y', 'alphaToInd_3Y', 'sharpeRatio_3Y', 'sharpeRatioRankP_3Y',
  'maximumDrawdown_3Y', 'fundSize', 'top10Holding', 'longestTenure', 'ter', 'managementFee',
];
const STR_FIELDS = ['fundName', 'categoryName', 'broadCategoryNameCN', 'styleBox', 'managerName', 'inceptionDate'];

/** Coerce a raw API row (object keyed by column name) into a typed snapshot row. */
function normalizeRow(raw) {
  const num = v => (v === null || v === undefined || v === '') ? null : (typeof v === 'number' ? v : Number(v));
  const out = { id: String(raw.id) };
  for (const f of NUM_FIELDS) out[f] = num(raw[f]);
  for (const f of STR_FIELDS) out[f] = raw[f] ?? null;
  return out;
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function _doSearchEs(fetcher, url, token, filter) {
  return fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': token, 'Accept': 'application/json' },
    body: JSON.stringify(filter),
  });
}

/**
 * POST /cn-api/v2/search/es → normalized snapshot.
 * - Retries once on HTTP 429 (rate limit, spec §11) with a short backoff.
 * - `response_status` arrives as a STRING ("200011") — compare as string, NOT `!== 200011`.
 * @param {object} opts
 * @param {string} opts.token
 * @param {object} [opts.filter] request body (default { sign:'1' } = broad market — VERIFY in Task 12)
 * @param {typeof fetch} [opts.fetchImpl] injectable; defaults to globalThis.fetch
 * @param {string} [opts.date] YYYY-MM-DD (default: today UTC)
 * @returns {Promise<{ date: string, source: string, count: number, rows: object[] }>}
 */
async function searchFunds({ token, filter = { sign: '1' }, fetchImpl, date }) {
  const fetcher = fetchImpl || globalThis.fetch;
  if (!fetcher) throw new Error('[client] no fetch available (Node < 18?)');
  const url = `${BASE}/cn-api/v2/search/es?source=local`;

  let res = await _doSearchEs(fetcher, url, token, filter);
  if (res.status === 429) { // rate limit: back off once and retry
    await _sleep(500);
    res = await _doSearchEs(fetcher, url, token, filter);
  }
  if (!res.ok) throw new Error(`[client] search/es HTTP ${res.status}`);
  const json = await res.json();
  if (String(json?._meta?.response_status) !== '200011') { // API returns status as a STRING
    throw new Error(`[client] search/es bad status: ${json?._meta?.response_status} (${json?._meta?.response_hint})`);
  }
  const rows = (json.data?.rows || []).map(normalizeRow);
  return { date: date || new Date().toISOString().slice(0, 10), source: 'morningstar:search/es', count: rows.length, rows };
}

module.exports = { searchFunds, normalizeRow };
