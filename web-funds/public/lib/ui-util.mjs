// lib/ui-util.mjs — PURE UI helpers (testable, no DOM).

// Pure: does a fund match a search query? Empty/whitespace query → match all. Case-insensitive
// substring on code OR name. Used by 推演 list + 出局审计 search boxes.
export function matchesQuery(code, name, query) {
  if (!query) return true;
  const q = String(query).trim().toLowerCase();
  if (!q) return true;
  return String(code || '').toLowerCase().includes(q) || String(name || '').toLowerCase().includes(q);
}

export function normalizeWeights(w, changedKey, newVal) {
  const keys = Object.keys(w);
  const others = keys.filter((k) => k !== changedKey);
  const oldOthersSum = others.reduce((s, k) => s + w[k], 0);
  const remaining = Math.max(0, 1 - newVal);
  const out = { ...w, [changedKey]: newVal };
  if (oldOthersSum <= 0) {
    others.forEach((k) => { out[k] = remaining / others.length; });
  } else {
    others.forEach((k) => { out[k] = (w[k] / oldOthersSum) * remaining; });
  }
  return out;
}

export function computeDelta(baselineRank, currentRank) {
  const delta = baselineRank - currentRank;   // positive = moved up
  return { delta, dir: delta > 0 ? 'up' : delta < 0 ? 'dn' : 'flat' };
}

export function tierBadgeClass(tier) {
  return tier === 'true_alpha' ? 'true' : tier === 'mixed' ? 'mix' : tier === 'industry_beta_pseudo' ? 'beta' : 'none';
}

const GATE_LABELS = {
  rating3Y: '评级3Y', rating5Y: '评级5Y', longest_tenure: '任期<3y',
  size_floor: '规模<2亿', size_cap: '规模>100亿',
  alpha_rank: 'α排名', sharpe_rank: '夏普排名', usd_shareclass: 'USD份额',
  trailing: '历史档案/服务端层',
};
export function gateLabel(g) { return GATE_LABELS[g] || g; }

export function fmt(v, kind) {
  if (v == null) return '—';
  if (kind === 'pct1') return (v * 100).toFixed(1) + '%';
  if (kind === 'pct0') return (v * 100).toFixed(0) + '%';
  if (kind === 'fixed2') return v.toFixed(2);
  if (kind === 'yi') return v.toFixed(1) + '亿';
  if (kind === 'score') return '.' + Math.round(v * 100).toString().padStart(2, '0');
  return String(v);
}
