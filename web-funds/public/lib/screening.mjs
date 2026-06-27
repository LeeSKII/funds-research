// lib/screening.mjs — PURE port of research/funds/analyze/screen.js.
// Difference: returns {passed, gate, detail} instead of silently `continue`-ing.
// Gate order matches screen.js so the FIRST firing gate is reported.
const USD_RE = /美元|USD|US\$|美金/;

// null policy mirrors screen.js: missing percentile/rating5Y → keep; structural (rating3Y/tenure/size-floor) → null fails.
export function screenRow(r, t) {
  if (r.rating3Y == null || r.rating3Y < t.rating3Y_min) return { passed: false, gate: 'rating3Y', detail: { rating3Y: r.rating3Y } };
  if (r.longestTenure == null || r.longestTenure < t.longestTenure_min_years) return { passed: false, gate: 'longest_tenure', detail: { longestTenure: r.longestTenure } };
  if (r.fundSize == null || r.fundSize < t.fundSize_min_yi) return { passed: false, gate: 'size_floor', detail: { fundSize: r.fundSize } };
  if (r.alphaToIndRankP_3Y != null && r.alphaToIndRankP_3Y > t.alphaToIndRankP_3Y_max) return { passed: false, gate: 'alpha_rank', detail: { alphaToIndRankP_3Y: r.alphaToIndRankP_3Y } };
  if (r.sharpeRatioRankP_3Y != null && r.sharpeRatioRankP_3Y > t.sharpeRatioRankP_3Y_max) return { passed: false, gate: 'sharpe_rank', detail: { sharpeRatioRankP_3Y: r.sharpeRatioRankP_3Y } };
  if (r.rating5Y != null && r.rating5Y < t.rating5Y_min) return { passed: false, gate: 'rating5Y', detail: { rating5Y: r.rating5Y } };
  if (r.fundSize != null && r.fundSize > t.fundSize_max_yi) return { passed: false, gate: 'size_cap', detail: { fundSize: r.fundSize } };
  if (t.exclude_usd_shareclass && r.fundName && USD_RE.test(r.fundName)) return { passed: false, gate: 'usd_shareclass', detail: { fundName: r.fundName } };
  const defensive = t.defensive_drawdown_floor != null && r.maximumDrawdown_3Y != null && r.maximumDrawdown_3Y >= t.defensive_drawdown_floor;
  return { passed: true, gate: null, detail: { defensive } };
}

export function screenAll(rows, t) {
  const passed = [], rejected = [];
  for (const r of rows) {
    const res = screenRow(r, t);
    if (res.passed) passed.push({ ...r, defensive: res.detail.defensive });
    else rejected.push({ row: r, gate: res.gate, detail: res.detail });
  }
  return { passed, rejected };
}
