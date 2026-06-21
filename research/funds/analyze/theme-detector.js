// analyze/theme-detector.js — 哲学 #5：识别基金真正在炒什么。
const SUPER_CATS = ['周期性', '敏感性', '防御性'];

function detectTheme(dossier, opts = {}) {
  const sa = (dossier && dossier.portfolio && dossier.portfolio.sectorAllocation) || [];
  const detail = sa.filter(s => s && s.sector && !SUPER_CATS.includes(s.sector));
  const topSectorBets = detail.filter(s => (s.excess || 0) > 0)
    .sort((a, b) => (b.excess || 0) - (a.excess || 0)).slice(0, 3)
    .map(s => ({ sector: s.sector, excess: s.excess }));

  const holdings = (dossier && dossier.portfolio && dossier.portfolio.topHoldings) || [];
  const byInd = Object.create(null);
  for (const h of holdings) {
    const ind = h.industry || '未分类';
    byInd[ind] = (byInd[ind] || 0) + (h.weightPct || 0);
  }
  const holdingsCluster = Object.keys(byInd)
    .map(industry => ({ industry, weightPct: round(byInd[industry]) }))
    .sort((a, b) => b.weightPct - a.weightPct);

  const styleBox = (dossier && dossier.description && dossier.description.styleBox) || null;
  const actualVsClaimedGap = null; // v1 占位：benchmark 公式拆解列 v2

  const history = opts.history || [];
  let driftSinceLast = 'insufficient_history';
  if (history.length >= 2) {
    driftSinceLast = computeDrift(history[history.length - 2], history[history.length - 1]);
  }

  return { topSectorBets, holdingsCluster, styleBox, actualVsClaimedGap, driftSinceLast };
}

function computeDrift(prev, curr) {
  const prevTop = topIndustry(prev);
  const currTop = topIndustry(curr);
  const styleChanged =
    (prev && prev.description && prev.description.styleBox) !==
    (curr && curr.description && curr.description.styleBox);
  if (prevTop === currTop && !styleChanged) return 'stable';
  return styleChanged ? 'style_drift' : 'sector_rotation';
}

// 按 weightPct 聚合 topHoldings.industry，返回权重最高行业（sort 一次）。
function topIndustry(d) {
  const h = (d && d.portfolio && d.portfolio.topHoldings) || [];
  const byInd = Object.create(null);
  for (const x of h) {
    const ind = x.industry || '未分类';
    byInd[ind] = (byInd[ind] || 0) + (x.weightPct || 0);
  }
  const sorted = Object.entries(byInd).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : null;
}

function round(x) {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}

module.exports = { detectTheme };
