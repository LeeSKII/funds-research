// analyze/screen.js — pure: snapshot × thresholds → candidate rows.
// A null in a percentile/rank field is treated as "unknown → don't disqualify"
// (data may not yet exist for newer funds). Required fields (rating3Y, tenure, size) are hard gates.
const BETWEEN = (v, lo, hi) => v !== null && v !== undefined && v >= lo && v <= hi;

/**
 * @param {{ rows: object[] }} snapshot
 * @param {object} t thresholds (see config/thresholds.json)
 * @returns {{ rows: object[] }}
 */
function screen(snapshot, t) {
  const pass = r =>
    r.rating3Y !== null && r.rating3Y >= t.rating3Y_min &&
    (r.rating5Y === null || r.rating5Y >= t.rating5Y_min) &&
    r.longestTenure !== null && r.longestTenure >= t.longestTenure_min_years &&
    BETWEEN(r.fundSize, t.fundSize_min_yi, t.fundSize_max_yi) &&
    (r.alphaToIndRankP_3Y === null || r.alphaToIndRankP_3Y <= t.alphaToIndRankP_3Y_max) &&
    (r.sharpeRatioRankP_3Y === null || r.sharpeRatioRankP_3Y <= t.sharpeRatioRankP_3Y_max);
  return { rows: snapshot.rows.filter(pass) };
}

module.exports = { screen };
