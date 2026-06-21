// analyze/screen.js — pure: snapshot × thresholds → candidate rows.
//
// TWO-LAYER FUNNEL (design spec §3.1). The layers have DISTINCT jobs and must NOT duplicate:
//
//   SERVER (universe.json search_filter) → structural survival + the one true-alpha discriminant
//     (trackPb 50~100 = active funds, kills closet-indexers). Owns: rating3Y floor, broadCategoryId,
//     index/enhanced/FOF exclusion, oldestShareId dedup, tenure>3, size≥2亿 floor, trackPb.
//
//   CLIENT (this file, thresholds.json) → performance ranking + portfolio-fit + defensive annotation.
//     Owns: alpha3Y/sharpe3Y ranking (server no longer sends these), rating5Y SOFT gate (rescues
//     <5y emerging funds the server deliberately lets through), size UPPER cap, USD share-class
//     exclusion (no server currency filter exists), and a defensive-sleeve annotation.
//
// CONSTRAINT: this screen can only see the 25 fields search/es RETURNS (fixed column set). Fields
// like alphaToIndRankP_5Y / downCaptureRatioRankP_3Y / any *RankP drawdown are valid SERVER filters
// but are NOT in the row — so they cannot be client gates. See engine/docs/screener-filters.md §2.
//
// Null policy: a missing percentile/rating5Y means "new fund, data not yet" → keep, judge on 3Y.
// Structural fields (rating3Y, tenure, size floor) are hard — null fails (server guarantees them).

const USD_SHARECLASS_REGEX = /美元|USD|US\$|美金/;

/**
 * @param {{ rows: object[] }} snapshot
 * @param {object} t thresholds (see config/thresholds.json)
 * @returns {{ rows: object[] }}  each row gains a `defensive: boolean` annotation
 */
function screen(snapshot, t) {
  const out = [];
  for (const r of snapshot.rows) {
    // --- structural asserts (server-guaranteed; kept as defense-in-depth) ---
    if (r.rating3Y === null || r.rating3Y === undefined || r.rating3Y < t.rating3Y_min) continue;
    if (r.longestTenure === null || r.longestTenure === undefined || r.longestTenure < t.longestTenure_min_years) continue;
    if (r.fundSize === null || r.fundSize === undefined || r.fundSize < t.fundSize_min_yi) continue;

    // --- CLIENT quality floor (server no longer sends alpha3Y / sharpe3Y).
    //     NOTE: fields are 0-100 percentile points (NOT 0-1 fractions), so threshold 50 = top half.
    //     Empirically near-REDUNDANT on the trackPb server net (96% pass — active funds are already
    //     alpha-elite, mean top-13.7%). Kept as a defense-in-depth floor, NOT a tight ranking cut;
    //     the real alpha work is the server's trackPb gate. Tighten (e.g. 10/5) for a smaller pool. ---
    if (r.alphaToIndRankP_3Y !== null && r.alphaToIndRankP_3Y !== undefined && r.alphaToIndRankP_3Y > t.alphaToIndRankP_3Y_max) continue;
    if (r.sharpeRatioRankP_3Y !== null && r.sharpeRatioRankP_3Y !== undefined && r.sharpeRatioRankP_3Y > t.sharpeRatioRankP_3Y_max) continue;

    // --- rating5Y SOFT gate: null-tolerant (rescues <5y emerging true-alpha funds) ---
    if (r.rating5Y !== null && r.rating5Y !== undefined && r.rating5Y < t.rating5Y_min) continue;

    // --- CLIENT portfolio-fit: size UPPER cap (server has no upper bound; mega-funds dilute alpha) ---
    if (r.fundSize !== null && r.fundSize !== undefined && r.fundSize > t.fundSize_max_yi) continue;

    // --- CLIENT forced: USD share-class exclusion (no server currency filter — §5b) ---
    if (t.exclude_usd_shareclass && r.fundName && USD_SHARECLASS_REGEX.test(r.fundName)) continue;

    // --- defensive-sleeve annotation (NOT a gate): shallow 3Y drawdown → candidate for the
    //     smart-beta-adjacent defensive sleeve the north star wants. Uses the raw field available. ---
    const defensive = t.defensive_drawdown_floor != null
      && r.maximumDrawdown_3Y !== null && r.maximumDrawdown_3Y !== undefined
      && r.maximumDrawdown_3Y >= t.defensive_drawdown_floor;

    out.push({ ...r, defensive });
  }
  return { rows: out };
}

module.exports = { screen };
