// analyze/shortlist.js — 两段式精排（PLAN「Shortlist ranker — REFRAMED two-stage」）。
//
// Stage 1 (coarse)：snapshot.rows（25 字段）→ 排序宽池。search/es 行里没有 Brinson，只能按
//   α/夏普百分位（越低越好）+ 评级粗排，挑出值得深抓的宽池。这些字段就是 screen.js 能看到的全部。
// Stage 2 (fine)：已深抓的 dossier → 复用 scoreFund（alphaQuality 的 Brinson tier + riskAdjusted
//   的 downsideCapture）→ 按选股目标重加权成单一 fineScore → 最终 ~15-20。
//
// 🔴 DRY：stage 2 不重新推导 Brinson——它消费 scoreFund 的 alphaQuality + riskAdjusted 子分，
//   所以 shortlist 的 α 判定永远和评分卡一致，不会出现「评分卡说 industry_beta_pseudo 但 shortlist 选了」的矛盾。
//   fine 阶段只是为「选股」这个目标把子分再加权（真α选股 + 跌势保护权重更高）。
//
// 🔴 诚实边界：stage 2 只能排已深抓到 dossier 的基金（coarse 宽池 ∩ data/fund/）。未抓的码记入
//   pendingScrape，不假装排了它们——这是「否定式边界」。

const fs = require('fs');
const path = require('path');
const { loadDossiers } = require('./loader');
const { buildSectorFlowHeatmap } = require('./sectorflow-index');
const { scoreFund } = require('./score');
const { validate } = require('../core/validate'); // INVARIANTS (a)：每个 store 写都过 schema

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = x => Math.round((x + Number.EPSILON) * 1000) / 1000;
const pctileQuality = p => (p == null ? 0.5 : clamp(1 - p / 100, 0, 1)); // 0-100 百分位 → 0..1 质量（低百分位=好）

// ---- Stage 1: coarse rank on the 25-field row (no Brinson available here) ----
// 字段都是 search/es 行里的：alphaToIndRankP_3Y / sharpeRatioRankP_3Y（0-100，越低越好）、rating3Y（1-5）。
function coarseRank(rows, config) {
  const w = config.shortlist.coarse.weights;
  const out = [];
  for (const r of rows || []) {
    const alphaQ = pctileQuality(r.alphaToIndRankP_3Y);
    const sharpeQ = pctileQuality(r.sharpeRatioRankP_3Y);
    const ratingQ = clamp(((r.rating3Y || 0) - 1) / 4, 0, 1); // 1星→0, 5星→1
    const value = round(w.alpha * alphaQ + w.sharpe * sharpeQ + w.rating * ratingQ);
    out.push({ code: r.id, name: r.fundName, coarseScore: value, alphaQ, sharpeQ, ratingQ, row: r });
  }
  out.sort((a, b) => b.coarseScore - a.coarseScore);
  out.forEach((o, i) => { o.coarseRank = i + 1; });
  return out;
}

// ---- 跌势保护质量：downsideCapture 越低越好（<100 = 跌得比基准少）----
// 线性映射 [captureFloor .. captureCeil] → [1 .. 0]，null→0.5 中性。负值（逆市）clamp 到 1。
function downsideProtectionQuality(downsideCapture, config) {
  if (downsideCapture == null) return 0.5; // 无数据 = 中性，不奖不罚
  const { captureFloor, captureCeil } = config.shortlist.fine.downside;
  return round(clamp((captureCeil - downsideCapture) / (captureCeil - captureFloor), 0, 1));
}

// ---- Stage 2: fine rank — 复用 scoreFund 子分，按选股目标重加权 ----
// 输入：单张 scoreFund 卡片 → fineScore + 选股摘要。纯函数，便于逐基金测试。
function fineRankCard(card, config) {
  const w = config.shortlist.fine.weights;
  const ra = card.scores.riskAdjusted || {};
  const aq = card.scores.alphaQuality || {};
  const sf = card.scores.sectorFlow || {};        // 防御：与 aq/ra 对称（score.js 总返回 value，但契约显式化）
  const bc = card.scores.bandContribution || {};
  const en = card.scores.endorsement || {};
  const downsideQ = downsideProtectionQuality(ra.downsideCapture, config);
  // trueAlpha contribution: real-Brinion tiers use the aq.value composite; no_brinion (QDII/ETF/index,
  // no Brinson data → aq.value=0) use an α proxy = risk.alpha normalized by alpha5yNormalizeDivisor
  // (same divisor score.js uses for real-α funds), so strong-α no_brinion funds compete instead of
  // being zeroed. 🔴 Caveat: without Brinson we can't confirm the α is stock-selection vs industry-β.
  const divisor = config.alphaQuality.alpha5yNormalizeDivisor;
  const aqContribution = aq.tier === 'no_brinion'
    ? clamp((ra.alpha != null ? ra.alpha : 0) / divisor, 0, 1)
    : clamp(aq.value != null ? aq.value : 0, 0, 1);
  const value = round(
    w.trueAlpha * aqContribution +
    w.downsideProtection * downsideQ +
    w.sectorFlow * clamp(sf.value != null ? sf.value : 0, 0, 1) +
    w.band * clamp(bc.value != null ? bc.value : 0, 0, 1) +
    w.endorsement * clamp(en.value != null ? en.value : 0, 0, 1)
  );
  return {
    code: card.code, name: card.name, fineScore: value,
    alphaTier: aq.tier, stockAlphaShare: aq.stockAlphaShare,
    annualizedAlpha5y: aq.annualizedAlpha5y,
    downsideCapture: ra.downsideCapture, downsideQuality: downsideQ, captureFlag: ra.captureFlag,
    sectorFlowValue: round(card.scores.sectorFlow.value), bandValue: round(card.scores.bandContribution.value),
    endorsementValue: round(card.scores.endorsement.value),
    sizeRiskFlag: card.sizeRisk.flag, flags: card.flags,
    narrative: card.narrative, provenance: card.provenance,
  };
}

// dossier 列表 → fine 排序结果（内部自建 heatmap，与 run-analysis 同款）。
function fineRank(dossiers, config, computedAt) {
  const heatmap = buildSectorFlowHeatmap(dossiers, config);
  const ranked = dossiers
    .map(d => fineRankCard(scoreFund(d, { heatmap, config, computedAt }), config))
    .sort((a, b) => b.fineScore - a.fineScore);
  ranked.forEach((r, i) => { r.fineRank = i + 1; });
  return ranked;
}

// ---- 编排：coarse 宽池 ∩ 已抓 dossier → fine → top N → 写 shortlist-<date>.json ----
function buildShortlist({ rows, dataDir, outDir, date, config, topN }) {
  const cfg = config.shortlist || {};
  const coarseAll = coarseRank(rows, config);
  // null/undefined=用全部；0=空宽池（显式判空，避免 0 || length 把 0 误读成「全部」）
  const widePoolSize = (cfg.coarse && cfg.coarse.widePoolSize != null) ? cfg.coarse.widePoolSize : coarseAll.length;
  const widePool = coarseAll.slice(0, widePoolSize);

  // stage 2 只能排已深抓到的 dossier：宽池码 ∩ data/fund/
  const dossierMap = loadDossiers(dataDir);
  const have = [];
  const pendingScrape = [];
  for (const w of widePool) {
    if (dossierMap.has(w.code)) have.push(dossierMap.get(w.code));
    else pendingScrape.push({ code: w.code, name: w.name, coarseRank: w.coarseRank, coarseScore: w.coarseScore });
  }
  const fine = fineRank(have, config, date);
  const top = fine.slice(0, topN || cfg.fine.defaultTopN || 20);

  const obj = {
    date,
    stage1: { widePoolSize, scoredFromRows: coarseAll.length, widePool: widePool.map(w => ({ code: w.code, name: w.name, coarseRank: w.coarseRank, coarseScore: w.coarseScore })) },
    stage2: { dossiersAvailable: have.length, pendingScrape, topN: top.length },
    shortlist: top,
    ranked: { byFineScore: fine.map(r => r.code), byTrueAlpha: fine.slice().sort((a, b) => (b.stockAlphaShare ?? -1) - (a.stockAlphaShare ?? -1)).map(r => r.code) },
  };
  // 🔴 INVARIANTS (a)：写盘前 schema 校验，失败即拒写（不把坏数据落 store）
  const v = validate('shortlist', obj);
  if (!v.valid) throw new Error(`[shortlist] shortlist-${date} failed schema:\n  - ${v.errors.join('\n  - ')}`);
  atomicWrite(path.join(outDir, `shortlist-${date}.json`), obj);
  return { date, widePoolSize, dossiersAvailable: have.length, pendingScrape: pendingScrape.length, topN: top.length, topCode: top[0] && top[0].code };
}

function atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const candidatesFile = args.find(a => a.endsWith('.json') && /candidates/.test(a))
    || path.join(__dirname, '..', 'store', 'derived', `candidates-${new Date().toISOString().slice(0, 10)}.json`);
  const dataDir = (args.indexOf('--data') >= 0) ? args[args.indexOf('--data') + 1] : path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const outDir = (args.indexOf('--out') >= 0) ? args[args.indexOf('--out') + 1] : path.join(__dirname, '..', 'store', 'derived');
  const date = (args.indexOf('--date') >= 0) ? args[args.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10);
  const topNIdx = args.indexOf('--top'); const topN = topNIdx >= 0 ? Number(args[topNIdx + 1]) : undefined;
  const config = require('../core/config/analysis.json');
  const { rows } = require(path.resolve(candidatesFile));
  const r = buildShortlist({ rows, dataDir, outDir, date, config, topN });
  console.log('[shortlist] done', JSON.stringify(r));
}

module.exports = { coarseRank, fineRankCard, fineRank, buildShortlist, downsideProtectionQuality, pctileQuality };
