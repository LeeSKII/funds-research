// core/client.js — morningstar Layer1 API client.
// Layer1 = /cn-api/v2/* (token-only RS256 JWT). Node-side calls bypass browser CORS.
const { withRetry } = require('./retry');
const BASE = 'https://www.morningstar.cn';

const NUM_FIELDS = [
  'rating3Y', 'rating5Y', 'returnYTD_M', 'return1Year_M', 'return3Year_M', 'return5Year_M', 'return10Year_M',
  'alphaToIndRankP_1Y', 'alphaToIndRankP_3Y', 'alphaToInd_3Y', 'sharpeRatio_3Y', 'sharpeRatioRankP_3Y',
  'maximumDrawdown_3Y', 'fundSize', 'top10Holding', 'longestTenure', 'ter', 'managementFee', 'styleBox',
];
const STR_FIELDS = ['fundName', 'categoryName', 'broadCategoryNameCN', 'managerName', 'inceptionDate'];

/** Coerce a raw API row (object keyed by column name) into a typed snapshot row. */
function normalizeRow(raw) {
  const num = v => (v === null || v === undefined || v === '') ? null : (typeof v === 'number' ? v : Number(v));
  const out = { id: String(raw.id) };
  // Detail-page deep link for downstream deep-scrape (Plan 2). Deterministic from id — persisted
  // so the deep-research step never has to re-derive the route. Empirically confirmed 2026-06-21:
  // the live fund detail dossier is at /fund/<id>.html (Nuxt SSR); the legacy /quicktake/<id> is dead.
  // See research/funds/docs/fund-detail-api.md.
  out.detailUrl = `${BASE}/fund/${out.id}.html`;
  for (const f of NUM_FIELDS) out[f] = num(raw[f]);
  for (const f of STR_FIELDS) out[f] = raw[f] ?? null;
  // Star ratings are semantically integers (1-5). Round any stray decimal the API might emit
  // so the snapshot schema's ["integer","null"] never hard-stops a fire on a malformed value.
  for (const f of ['rating3Y', 'rating5Y']) {
    if (out[f] !== null && out[f] !== undefined) out[f] = Math.round(out[f]);
  }
  return out;
}

async function _doSearchEs(fetcher, url, token, filter) {
  return fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': token, 'Accept': 'application/json' },
    body: JSON.stringify(filter),
  });
}

// 单次尝试：fetch + HTTP 状态检查。!ok 时抛带 httpStatus 的错误，供 withRetry.isRetryable 判定。
async function _attemptSearchEs(fetcher, url, token, filter) {
  const res = await _doSearchEs(fetcher, url, token, filter);
  if (!res.ok) { const e = new Error(`[client] search/es HTTP ${res.status}`); e.httpStatus = res.status; throw e; }
  return res;
}

/**
 * POST /cn-api/v2/search/es → normalized snapshot.
 * - Retries via withRetry (core/retry.js) — 默认仅对 HTTP 429（限流）重试一次，500/bad-status 立即抛。
 *   retry 选项可注入（sleep/random/retries/baseDelay），便于测试与调参。
 * - `response_status` arrives as a STRING ("200011") — compare as string, NOT `!== 200011`.
 * @param {object} opts
 * @param {string} opts.token
 * @param {object} [opts.filter] request body (default { sign:'1' } = broad market — VERIFY in Task 12)
 * @param {typeof fetch} [opts.fetchImpl] injectable; defaults to globalThis.fetch
 * @param {string} [opts.date] YYYY-MM-DD (default: today UTC)
 * @param {object} [opts.retry] 透传给 withRetry（retries/baseDelay/sleep/random/isRetryable）
 * @returns {Promise<{ date: string, source: string, count: number, totalCount: number, rows: object[] }>}
 *   `count` = rows actually returned (capped at the API's per-call ceiling). `totalCount` =
 *   `data.count` = the TRUE match total. If `totalCount > count` the API truncated — callers MUST
 *   treat that as silent data loss (the snapshot is incomplete) and either warn or shard the query.
 */
async function searchFunds({ token, filter = { sign: '1' }, fetchImpl, date, retry: retryOpts }) {
  const fetcher = fetchImpl || globalThis.fetch;
  if (!fetcher) throw new Error('[client] no fetch available (Node < 18?)');
  const url = `${BASE}/cn-api/v2/search/es?source=local`;

  const res = await withRetry(() => _attemptSearchEs(fetcher, url, token, filter), {
    retries: 1, baseDelay: 500, isRetryable: (e) => e && e.httpStatus === 429, ...retryOpts,
  });
  const json = await res.json();
  if (String(json?._meta?.response_status) !== '200011') { // API returns status as a STRING
    throw new Error(`[client] search/es bad status: ${json?._meta?.response_status} (${json?._meta?.response_hint})`);
  }
  const rows = (json.data?.rows || []).map(normalizeRow);
  const total = Number(json.data?.count);
  return {
    date: date || new Date().toISOString().slice(0, 10),
    source: 'morningstar:search/es',
    count: rows.length,
    totalCount: Number.isFinite(total) ? total : rows.length, // TRUE match total (uncapped)
    rows,
  };
}

module.exports = { searchFunds, normalizeRow };
