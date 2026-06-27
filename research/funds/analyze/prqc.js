// research/funds/analyze/prqc.js — PRQC (Performance-Risk Quality Composite) for no_brinion funds.
//
// Replaces the single-number α-proxy (risk.alpha/divisor) with a principled 5-factor composite for the
// 59 no_brinion funds (QDII / ETF / conservative-mix — no Brinson attribution available).
//
// Pure CommonJS module. NO I/O, NO coupling to score.js / shortlist.js / scoring.mjs.
// Integration into the scoring pipeline is a separate follow-on task.
//
// 5 factors:
//   F1 收益能力      (0.30)  Sharpe + Sortino, degrade→α/divisor if both missing
//   F2 下行保护      (0.25)  downsideCapture + asymmetry + maxDD (bucketed)
//   F3 一致性        (0.20)  infoRatio + consistencyRatio + monthlyWinRate
//   F4 Calmar绝对下限 (0.15)  Calmar winsorized
//   F5 板块流向      (0.10)  sectorFlowValue (external signal)
//
// All factor inputs are winsorized + linearly mapped onto [0,1] against pool-derived percentiles,
// so a single exploding ratio (e.g. Sortino=700) cannot dominate the composite.

'use strict';

// ───────────────────────── helpers ─────────────────────────

const winsor = (x, lo, hi) => (x == null ? null : Math.max(lo, Math.min(hi, x)));
const clip01 = x => Math.max(0, Math.min(1, x));
const linearMap = (x, lo, hi) => (x == null ? null : clip01((x - lo) / (hi - lo)));
const round = (x, n = 3) => {
  if (x == null) return null;
  const f = Math.pow(10, n);
  return Math.round(x * f) / f;
};

/**
 * Percentile via linear interpolation on a SORTED ascending array.
 * p in [0,1]. Empty array → null. Single value → that value.
 * Uses the "linear interpolation between closest ranks" method (R-7 / numpy default).
 */
const percentile = (sortedAsc, p) => {
  if (!sortedAsc || sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = p * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const frac = rank - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
};

const median = arr => {
  const s = [...arr].sort((a, b) => a - b);
  return percentile(s, 0.5);
};

// ───────────────────────── computePoolStats ─────────────────────────

/**
 * Precompute pool-level normalization stats from the 59 (or however many) no_brinion funds.
 *
 * Input: `funds` = array of normalized fund-metric objects of shape:
 *   { risk: { sharpe:{fund}, sortino:{fund}, calmar:{fund}, maxDrawdown:{fund},
 *             stdDev:{fund}, monthlyWinRate, infoRatio },
 *     ra:   { alpha, downsideCapture, asymmetry, infoRatio },
 *     bc:   { consistencyRatio } }
 * (any field may be null/missing).
 *
 * Output: pool-stats object consumed by computePRQC.
 */
function computePoolStats(funds) {
  const fundList = Array.isArray(funds) ? funds : [];

  // Collect non-null values per metric. Each ratio lives under risk.<name>.fund OR a flat alias.
  const pick = (f, ...paths) => {
    for (const p of paths) {
      const v = p.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), f);
      if (v != null && !Number.isNaN(v)) return v;
    }
    return null;
  };

  const sharpeVals = [];
  const sortinoVals = [];
  const calmarVals = [];
  const asymVals = [];
  const maxDD_cons = []; // conservative bucket: stdDev<15
  const maxDD_qdii = []; // qdii bucket: stdDev>=15

  for (const f of fundList) {
    const sh = pick(f, 'risk.sharpe.fund', 'sharpe');
    if (sh != null) sharpeVals.push(sh);
    const so = pick(f, 'risk.sortino.fund', 'sortino');
    if (so != null) sortinoVals.push(so);
    const ca = pick(f, 'risk.calmar.fund', 'calmar');
    if (ca != null) calmarVals.push(ca);
    const as = pick(f, 'ra.asymmetry', 'asymmetry');
    if (as != null) asymVals.push(as);

    const std = pick(f, 'risk.stdDev.fund', 'stdDev');
    const mdd = pick(f, 'risk.maxDrawdown.fund', 'maxDrawdown');
    if (mdd != null) {
      if (std != null && std < 15) maxDD_cons.push(mdd);
      else maxDD_qdii.push(mdd);
    }
  }

  sharpeVals.sort((a, b) => a - b);
  sortinoVals.sort((a, b) => a - b);
  calmarVals.sort((a, b) => a - b);
  asymVals.sort((a, b) => a - b);
  maxDD_cons.sort((a, b) => a - b);
  maxDD_qdii.sort((a, b) => a - b);

  // Percentile with <3-value fallback: use median (or null if 0 values).
  const pctOrMedian = (sorted, p) => {
    if (sorted.length === 0) return null;
    if (sorted.length < 3) return median(sorted);
    return percentile(sorted, p);
  };

  const maxDD_byBucket = {};
  if (maxDD_cons.length > 0) {
    maxDD_byBucket.conservative = {
      p25: pctOrMedian(maxDD_cons, 0.25),
      p75: pctOrMedian(maxDD_cons, 0.75),
    };
  }
  if (maxDD_qdii.length > 0) {
    maxDD_byBucket.qdii = {
      p25: pctOrMedian(maxDD_qdii, 0.25),
      p75: pctOrMedian(maxDD_qdii, 0.75),
    };
  }

  return {
    sharpeP25: pctOrMedian(sharpeVals, 0.25),
    sharpeP75: pctOrMedian(sharpeVals, 0.75),
    sortinoP75: pctOrMedian(sortinoVals, 0.75),
    calmarP75: pctOrMedian(calmarVals, 0.75),
    asymP75: pctOrMedian(asymVals, 0.75),
    irClip: 5,
    sharpeClip: 3,
    calmarClip: 8,
    sortinoClip: 10,
    maxDD_byBucket,
    alphaNormDivisor: 50,
    captureFloor: 40,
    captureCeil: 120,
  };
}

// ───────────────────────── computePRQC ─────────────────────────

/**
 * Compute the PRQC composite for a single no_brinion fund.
 *
 * @param {object} fm  flat fund-metrics object (nullable fields):
 *   { sharpe, sortino, calmar, maxDrawdown, stdDev, monthlyWinRate, infoRatio,
 *     alpha, downsideCapture, asymmetry, consistencyRatio, sectorFlowValue }
 * @param {object} pool  output of computePoolStats
 * @returns {{ value: number, factors: {F1,F2,F3,F4,F5}, proxyMethod: 'full_ratios'|'ratio_proxy_only' }}
 */
function computePRQC(fm, pool) {
  fm = fm || {};

  // ── F1 收益能力 (0.30) ────────────────────────────────────────────
  const sharpeW = winsor(fm.sharpe, 0, pool.sharpeClip);
  const sortinoW = winsor(fm.sortino, 0, pool.sortinoClip);
  const sharpeQ = linearMap(sharpeW, 0.8, pool.sharpeP75);
  const sortinoQ = linearMap(sortinoW, 1.0, pool.sortinoP75);

  let F1 = (sharpeQ != null && sortinoQ != null) ? 0.6 * sharpeQ + 0.4 * sortinoQ : null;
  if (F1 == null) {
    // Degrade path: ratios unavailable. If α exists, use α/divisor (the historical proxy).
    // If α is ALSO missing, neutral 0.5 is more principled than 0 (a fund with zero information
    // should score neutral, not rock-bottom) — matches the all-null edge-case contract.
    F1 = (fm.alpha == null) ? 0.5 : clip01(fm.alpha / pool.alphaNormDivisor);
  }

  // ── F2 下行保护 (0.25) ────────────────────────────────────────────
  const downsideQ = (fm.downsideCapture == null)
    ? 0.5
    : clip01((pool.captureCeil - fm.downsideCapture) / (pool.captureCeil - pool.captureFloor));
  const asymQ = linearMap(fm.asymmetry, 0.8, pool.asymP75);
  const bucket = (fm.stdDev != null && fm.stdDev < 15) ? 'conservative' : 'qdii';
  const bucketStats = pool.maxDD_byBucket[bucket];
  const maxDDQ = (fm.maxDrawdown != null && bucketStats)
    ? linearMap(fm.maxDrawdown, bucketStats.p25, bucketStats.p75)
    : null;

  let F2;
  if (maxDDQ != null) {
    F2 = 0.5 * downsideQ + 0.3 * (asymQ ?? 0) + 0.2 * maxDDQ;
    // If asymmetry missing, redistribute its weight to downside (keep weights summing to 1).
    if (asymQ == null) F2 = (0.5 + 0.3) / 1.0 * downsideQ + 0.2 * maxDDQ;
  } else {
    F2 = 0.7 * downsideQ + 0.3 * (asymQ ?? 0);
    if (asymQ == null) F2 = downsideQ; // only signal available
  }

  // ── F3 一致性 (0.20) ──────────────────────────────────────────────
  let irQ;
  if (fm.infoRatio == null) {
    irQ = null;
  } else {
    const irWinsor = Math.sign(fm.infoRatio) * Math.min(Math.abs(fm.infoRatio), pool.irClip);
    irQ = linearMap(irWinsor, -1.0, 1.5);
  }
  const consistQ = fm.consistencyRatio ?? 0.5;
  const winRateQ = linearMap(fm.monthlyWinRate, 40, 70);

  let F3;
  if (winRateQ != null) {
    // irQ may be null — collapse its weight proportionally if so
    if (irQ == null) {
      F3 = 0.5 * consistQ + 0.5 * winRateQ; // renormalized from 0.35/0.35/0.30 dropping IR
    } else {
      F3 = 0.35 * irQ + 0.35 * consistQ + 0.30 * winRateQ;
    }
  } else {
    if (irQ == null) {
      F3 = consistQ; // only signal
    } else {
      F3 = 0.5 * irQ + 0.5 * consistQ;
    }
  }

  // ── F4 风险绝对下限 Calmar (0.15) ────────────────────────────────
  const calmarW = winsor(fm.calmar, 0, pool.calmarClip);
  const calmarQ = linearMap(calmarW, 0.5, pool.calmarP75);
  const F4 = calmarQ ?? 0.5; // missing = neutral

  // ── F5 板块流向 (0.10) ───────────────────────────────────────────
  const F5 = fm.sectorFlowValue ?? 0.5;

  // ── Composite ────────────────────────────────────────────────────
  const value = round(0.30 * F1 + 0.25 * F2 + 0.20 * F3 + 0.15 * F4 + 0.10 * F5, 3);
  const proxyMethod = (fm.sharpe == null && fm.sortino == null) ? 'ratio_proxy_only' : 'full_ratios';

  return {
    value,
    factors: {
      F1: round(F1, 3),
      F2: round(F2, 3),
      F3: round(F3, 3),
      F4: round(F4, 3),
      F5: round(F5, 3),
    },
    proxyMethod,
  };
}

module.exports = { computePoolStats, computePRQC, _internals: { winsor, clip01, linearMap, percentile, median } };
