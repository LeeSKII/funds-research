// analyze/run-analysis.js — 第三步编排：load all → buildHeatmap → score each → rank → atomicWrite。
const fs = require('fs'); const path = require('path');
const { loadDossiers } = require('./loader');
const { buildSectorFlowHeatmap } = require('./sectorflow-index');
const { scoreFund, riskAdjusted } = require('./score');
const { computePoolStats } = require('./prqc');
const { validate } = require('../core/validate'); // INVARIANTS (a)：每个 store 写都过 schema
const config = require('../core/config/analysis.json');

function atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function rankBy(cards, key) {
  return cards.slice().sort((a, b) => ((b.scores[key] && b.scores[key].value) || -1) - ((a.scores[key] && a.scores[key].value) || -1)).map(c => c.code);
}

function runAnalysis({ dataDir, outDir, date, computedAt }) {
  const map = loadDossiers(dataDir);
  const dossiers = [];
  for (const d of map.values()) {
    if (!d.description) continue; // 边界保险：跳过 legacy 扁平 schema（loadDossiers 已过滤，此处 defense-in-depth）
    dossiers.push(d);
  }
  const heatmap = buildSectorFlowHeatmap(dossiers, config);
  // 🔴 PRQC poolStats：从所有 dossier 提取 risk + ra.asymmetry（computePoolStats 接受 dossier-shape：
  //   读 risk.sharpe.fund / risk.maxDrawdown.fund 等 + ra.asymmetry）。pool 横跨全部基金
  //   （no_brinion 占多数；混入少量 real-α 基金不污染百分位，反而让 pool 更稳）。
  const poolFunds = dossiers.map(d => {
    const ra = riskAdjusted(d, config);
    return { risk: { ...(d.risk || {}) }, ra: { asymmetry: ra.asymmetry } };
  });
  const poolStats = computePoolStats(poolFunds);
  const cards = dossiers.map(d => scoreFund(d, { heatmap, config, computedAt, poolStats }));
  // 🔴 INVARIANTS (a)：写盘前逐卡 schema 校验，任一非法即拒写（不把坏评分落 store）
  for (const card of cards) {
    const v = validate('analysis-score', card);
    if (!v.valid) throw new Error(`[analysis] card ${card.code} failed schema:\n  - ${v.errors.join('\n  - ')}`);
  }
  const obj = { date, fundCount: cards.length, sectorFlowHeatmap: heatmap, cards,
    _meta: { poolStats, computedAt },
    ranked: { bySectorFlow: rankBy(cards, 'sectorFlow'), byAlphaQuality: rankBy(cards, 'alphaQuality'), byBandContribution: rankBy(cards, 'bandContribution') } };
  atomicWrite(path.join(outDir, `score-${date}.json`), obj);
  return { date, fundCount: cards.length, ranked: obj.ranked };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dataDir = (args.indexOf('--data') >= 0) ? args[args.indexOf('--data') + 1] : path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const outDir = (args.indexOf('--out') >= 0) ? args[args.indexOf('--out') + 1] : path.join(__dirname, '..', 'store', 'derived');
  const date = (args.indexOf('--date') >= 0) ? args[args.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10);
  const r = runAnalysis({ dataDir, outDir, date, computedAt: date });
  console.log('[analysis] done', JSON.stringify({ date: r.date, fundCount: r.fundCount, topSectorFlow: r.ranked.bySectorFlow.slice(0, 5) }));
}

module.exports = { runAnalysis, atomicWrite, rankBy };
