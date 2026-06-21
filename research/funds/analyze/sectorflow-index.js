// analyze/sectorflow-index.js — 哲学 #6：板块资金流向（高景气度/高流动性）。🔴 非基金规模。
function detailSectors(sectorAllocation, config) {
  if (!Array.isArray(sectorAllocation)) return [];
  // 从 config 读取 superCategories（避免 config-drift）；未传 config 时回退硬编码（向后兼容，theme-detector 单参调用仍可工作）
  const superCats = (config && config.sectorFlow && config.sectorFlow.superCategories) || ['周期性', '敏感性', '防御性'];
  return sectorAllocation.filter(s => s && s.sector && !superCats.includes(s.sector));
}

// (a) 池级板块景气 heatmap：候选池自己当资金流向传感器
function buildSectorFlowHeatmap(dossiers, config) {
  const acc = Object.create(null);
  const fundCount = dossiers.length || 1;
  for (const d of dossiers) {
    const sectors = detailSectors(d && d.portfolio && d.portfolio.sectorAllocation, config);
    const aum = (d && d.description && d.description.aumYi) || 0;
    for (const s of sectors) {
      if (!acc[s.sector]) acc[s.sector] = { holderCount: 0, excessSum: 0, overweightCount: 0, moneyMass: 0 };
      const ex = s.excess || 0;
      acc[s.sector].holderCount++;
      acc[s.sector].excessSum += ex;
      if (ex > 0) acc[s.sector].overweightCount++;
      acc[s.sector].moneyMass += aum * ((s.fund || 0) / 100);
    }
  }
  const rows = Object.keys(acc).map(sector => {
    const v = acc[sector];
    return { sector, holderCount: v.holderCount, avgExcess: round(v.excessSum / v.holderCount),
             overweightRatio: v.overweightCount / fundCount, moneyMass: round(v.moneyMass) };
  });
  const maxAbsExcess = Math.max(1, ...rows.map(r => Math.abs(r.avgExcess)));
  for (const r of rows) {
    // prosperity = 资金聚集广度 × 超配幅度（仅正向计入）
    r.prosperityRaw = r.overweightRatio * (r.avgExcess > 0 ? r.avgExcess / maxAbsExcess : 0);
  }
  const maxProsperity = Math.max(0, ...rows.map(r => r.prosperityRaw)) || 1;
  for (const r of rows) r.rankNorm = round(r.prosperityRaw / maxProsperity);
  rows.sort((a, b) => b.rankNorm - a.rankNorm);
  return { sectors: rows, fundCount: dossiers.length };
}

// (b) 逐基金 SectorFlow 得分
function sectorFlowScore(dossier, heatmap, config) {
  const w = config.sectorFlow.weights;
  const sectors = detailSectors(dossier && dossier.portfolio && dossier.portfolio.sectorAllocation, config);
  let num = 0, den = 0; const top = [];
  for (const s of sectors) {
    const hm = heatmap.sectors.find(h => h.sector === s.sector);
    const rank = hm ? hm.rankNorm : 0;
    num += (s.fund || 0) * rank; den += (s.fund || 0);
    top.push({ sector: s.sector, fund: s.fund, excess: s.excess, rank });
  }
  const prosperityAlignment = den > 0 ? num / den : 0;
  top.sort((a, b) => (b.fund || 0) - (a.fund || 0));
  const sb = (dossier && dossier.description && dossier.description.styleBox) || '';
  const tier = config.sectorFlow.liquidityTier;
  let liquidity = tier._null;
  for (const k of ['大盘', '中盘', '小盘']) if (sb.startsWith(k)) { liquidity = tier[k]; break; }
  const total = w.prosperityAlignment * prosperityAlignment + w.liquidity * liquidity;
  return { value: round(total), prosperityAlignment: round(prosperityAlignment),
           topSectors: top.slice(0, 5), liquidity: { value: round(liquidity), styleBoxTier: sb || null } };
}

function round(x) { return Math.round((x + Number.EPSILON) * 1000) / 1000; }
module.exports = { buildSectorFlowHeatmap, sectorFlowScore, detailSectors };
