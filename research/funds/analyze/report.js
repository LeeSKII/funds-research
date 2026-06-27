// analyze/report.js — Plan 3 (Phase 5)：dossier + 判定卡 → Markdown 研究报告。
//
// 渲染纯函数：输入 (card, dossier, {heatmap?, poolTop?}) → Markdown 字符串。无副作用、确定性，
// 便于黄金断言。card 由 score.js 产出（含 scores.theme / bandContribution.annualExcess /
// riskAdjusted / alphaQuality / narrative / flags）；dossier 提供 Brinson 原始拆解增色（可选）。
//
// 🔴 结论只对当前波段负责（否定式边界）：报告显式标注 asOfDate + bandWindowLabel，不做跨波段外推。
//
// PDF：本模块只产 Markdown（零重依赖，符合项目「仅 ajv」约定）。转 PDF 用外部工具一行搞定：
//   `pandoc report-<code>-<date>.md -o report-<code>-<date>.pdf`  或  `npx md-to-pdf report-<code>-<date>.md`
// 不把 puppeteer/chromium 这种重依赖塞进 runtime。

const fs = require('fs');
const path = require('path');
const { loadDossiers } = require('./loader');
const { scoreFund } = require('./score');
const { buildSectorFlowHeatmap } = require('./sectorflow-index');

const pct = (x, d = 1) => (x == null ? '—' : `${Number(x).toFixed(d)}%`);
const num = (x, d = 2) => (x == null ? '—' : Number(x).toFixed(d));

// 单基金报告
function renderReportMarkdown(card, dossier, opts = {}) {
  const aq = (card.scores && card.scores.alphaQuality) || {};
  const ra = (card.scores && card.scores.riskAdjusted) || {};
  const bc = (card.scores && card.scores.bandContribution) || {};
  const sf = (card.scores && card.scores.sectorFlow) || {};
  const theme = (card.scores && card.scores.theme) || {};
  const attr = (dossier && dossier.performance && dossier.performance.attribution) || {};
  const L = [];
  const push = (s) => L.push(s);

  push(`# ${card.name || '—'}（${card.code}）`);
  push('');
  push(`> 研究报告 · 数据截止 ${card.asOfDate || '—'} · ${card.bandWindowLabel || '年度近似'} · 生成 ${card.provenance && card.provenance.computedAt || '—'}`);
  push('');

  // 概要
  push('## 概要');
  push('');
  push(`- **规模风险**：${sizeRiskText(card.sizeRisk)}`);
  push(`- **α 性质**：${tierText(aq.tier)}${aq.stockAlphaShare != null ? `（选股贡献占超额 ${(clamp(aq.stockAlphaShare,0,1)*100).toFixed(0)}%）` : ''}`);
  push(`- **跌势保护**：${ra.downsideCapture != null ? `下行捕获 ${num(ra.downsideCapture)}（${ra.captureFlag || '未知'}）` : '无数据'}`);
  push(`- **信号旗**：${card.flags && card.flags.length ? card.flags.map(f => `\`${f}\``).join(' ') : '无'}`);
  push('');

  // α 来源
  push('## α 来源');
  push('');
  push(`- ${card.narrative && card.narrative.whoDrivesAlpha || '—'}`);
  if (aq.tier !== 'no_brinion' && attr.real) {
    push(`- Brinson 拆解：基金回报 ${pct(attr.fundReturn)} vs 基准 ${pct(attr.benchReturn)} → 超额 ${pct(attr.excess)}`);
    push(`  - 选股贡献 ${pct(attr.stockSelection)} · 行业配置贡献 ${pct(attr.sectorAllocation)}`);
    if (attr._identityCheck) push(`  - 恒等校验：重构 ${pct(attr._identityCheck.reconstructed)}（Δ${num(attr._identityCheck.delta)}）${attr._identityCheck.ok ? '✓' : '⚠ 不一致'}`);
  } else {
    push(`- 无 Brinson 归因（${aq.tier === 'no_brinion' ? 'ETF/指数/QDII' : '数据缺失'}），用捕获比代理 α`);
  }
  push('');

  // 板块流向
  push('## 板块资金流向');
  push('');
  push(`- ${card.narrative && card.narrative.sectorFlowVerdict || '—'}`);
  if (Array.isArray(sf.topSectors) && sf.topSectors.length) {
    push('| 板块 | 本基金权重 | 超配 | 景气排名 |');
    push('|---|---|---|---|');
    for (const s of sf.topSectors.slice(0, 5)) push(`| ${s.sector} | ${pct(s.fund)} | ${pct(s.excess)} | ${num(s.rank, 2)} |`);
  }
  if (opts.poolTop && opts.poolTop.length) {
    push(`- 池级景气 Top：${opts.poolTop.map(s => `${s.sector}(${num(s.rankNorm,2)})`).join('、')}`);
  }
  push('');

  // 区间表现
  push('## 区间表现');
  push('');
  push(`- ${card.narrative && card.narrative.bandVerdict || '—'}`);
  if (Array.isArray(bc.annualExcess) && bc.annualExcess.length) {
    const annual = (dossier && dossier.performance && dossier.performance.annual) || null;
    const annualPeer = (dossier && dossier.performance && dossier.performance.annualPeer) || null;
    if (annual) {
      push('| 年度 | 基金 | 同类 | 超额 |');
      push('|---|---|---|---|');
      for (const e of bc.annualExcess) push(`| ${e.year} | ${pct(annual[e.year])} | ${annualPeer ? pct(annualPeer[e.year]) : '—'} | ${num(e.excess)}% |`);
    } else {
      push('| 年度 | 超额同类 |');
      push('|---|---|');
      for (const e of bc.annualExcess) push(`| ${e.year} | ${num(e.excess)}% |`);
    }
  }
  push('');

  // 风险
  push('## 风险特征');
  push('');
  push(`- α ${num(ra.alpha)} · β ${num(ra.beta)} · R² ${num(ra.rSquared)} · 信息比率 ${num(ra.infoRatio)}`);
  push(`- 上行捕获 ${num(ra.upsideCapture)} · 下行捕获 ${num(ra.downsideCapture)} · 不对称比 ${num(ra.asymmetry)}（${ra.captureFlag || '未知'}）`);
  if (card.flags && card.flags.includes('low_benchmark_fit')) push(`- ⚠ R² 低于信任地板：基准拟合差，α/β 解释力受限`);
  push('');

  // 持仓主题
  push('## 持仓主题');
  push('');
  push(`- ${card.narrative && card.narrative.whatItBetsOn || '—'}`);
  if (Array.isArray(theme.holdingsCluster) && theme.holdingsCluster.length) {
    const top3 = theme.holdingsCluster.slice(0, 3).map(c => `${c.industry}(${pct(c.weightPct)})`).join('、');
    push(`- 持仓聚簇：${top3}`);
  }
  if (theme.driftSinceLast && theme.driftSinceLast !== 'insufficient_history') push(`- 主题漂移：\`${theme.driftSinceLast}\``);
  push('');

  // 结论 + provenance
  push('## 结论');
  push('');
  push(verdictText(card));
  push('');
  push('---');
  push('');
  push(`> 否定式边界：以上判定仅对截至 ${card.asOfDate || '—'} 的当前波段负责，不外推未来。`);
  push(`> provenance：dossier=${card.provenance && card.provenance.dossierFile || '—'} · script ${card.provenance && card.provenance.scriptVersion || '—'}`);
  push('');

  const out = L.join('\n');
  if (/\[object Object\]/.test(out)) throw new Error('[report] Markdown 含 [object Object] — 序列化 bug');
  return out;
}

// 池级摘要报告（输入 score-<date>.json 对象）
function renderPoolReportMarkdown(scoreObj) {
  const L = []; const push = s => L.push(s);
  push(`# 候选池研究摘要 · ${scoreObj.date}`);
  push('');
  push(`> 共 ${scoreObj.fundCount} 只 · 板块流向景气 Top 见下表`);
  push('');
  const hm = scoreObj.sectorFlowHeatmap || {};
  if (Array.isArray(hm.sectors) && hm.sectors.length) {
    push('| 板块 | 持有人数 | 平均超配 | 超配比 | 景气排名 |');
    push('|---|---|---|---|---|');
    for (const s of hm.sectors.slice(0, 10)) push(`| ${s.sector} | ${s.holderCount} | ${pct(s.avgExcess)} | ${pct(s.overweightRatio * 100, 0)} | ${num(s.rankNorm, 2)} |`);
  }
  push('');
  const cards = scoreObj.cards || [];
  const top = [...cards].sort((a, b) => ((b.scores.alphaQuality && b.scores.alphaQuality.value) || 0) - ((a.scores.alphaQuality && a.scores.alphaQuality.value) || 0)).slice(0, 10);
  if (top.length) {
    push('## 真α Top 10');
    push('');
    push('| 代码 | 名称 | α 性质 | 选股占比 | 下行捕获 | 规模风险 |');
    push('|---|---|---|---|---|---|');
    for (const c of top) {
      const aq = c.scores.alphaQuality || {}, ra = c.scores.riskAdjusted || {};
      push(`| ${c.code} | ${c.name || '—'} | ${aq.tier} | ${aq.stockAlphaShare != null ? (clamp(aq.stockAlphaShare,0,1)*100).toFixed(0)+'%' : '—'} | ${num(ra.downsideCapture)} | ${c.sizeRisk.flag} |`);
    }
  }
  return L.join('\n');
}

// ---- 文本辅助 ----
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function sizeRiskText(sr) {
  if (!sr) return '—';
  const aum = sr.aumYi != null ? `${sr.aumYi}亿` : '未知规模';
  const map = { ok: '正常', capacity_erosion: '⚠ 容量侵蚀（>100亿）', liquidation_risk: '⚠ 清盘风险（<2亿）', unknown: '规模未知' };
  return `${aum} · ${map[sr.flag] || sr.flag}`;
}
function tierText(tier) {
  return { true_alpha: '真α（选股型）', industry_beta_pseudo: '伪α（行业β主导）', mixed: '选股/行业混合', no_brinion: '无 Brinson 归因' }[tier] || tier;
}
function verdictText(card) {
  const flags = card.flags || [];
  const aq = (card.scores && card.scores.alphaQuality) || {};
  const red = flags.filter(f => /erosion|liquidation|pseudo|noise|low_benchmark/.test(f));
  let s = '';
  if (aq.tier === 'true_alpha' && red.length === 0) s = `**${card.name}** 是真α选股型，选股贡献主导超额，可作为波段核心候选。`;
  else if (aq.tier === 'true_alpha') s = `**${card.name}** 有真α但存在风险信号（${red.join('、')}），仓位需克制。`;
  else if (aq.tier === 'no_brinion') s = `**${card.name}** 无 Brinson 归因（被动型），用捕获比与板块流向代理判断，工具属性 > 选股属性。`;
  else s = `**${card.name}** α 性质为${tierText(aq.tier)}，非纯选股型，注意行业β敞口。`;
  return s;
}

// ---- 编排：对每只（或 watchlist/shortlist 子集）基金产 report-<code>-<date>.md ----
function buildReports({ dataDir, outDir, date, config, codes, scoreObj }) {
  const map = loadDossiers(dataDir);
  const target = codes && codes.length ? codes : [...map.keys()];
  const dossiers = target.map(c => map.get(c)).filter(Boolean);
  const heatmap = (scoreObj && scoreObj.sectorFlowHeatmap) || buildSectorFlowHeatmap(dossiers, config);
  const poolTop = (heatmap && heatmap.sectors) ? heatmap.sectors.slice(0, 5) : [];
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const d of dossiers) {
    const card = (scoreObj && (scoreObj.cards || []).find(c => c.code === d.description.code))
      || scoreFund(d, { heatmap, config, computedAt: date });
    const md = renderReportMarkdown(card, d, { poolTop });
    const file = path.join(outDir, `report-${d.description.code}-${date}.md`);
    atomicWrite(file, md);
    written.push(d.description.code);
  }
  // 池级摘要
  if (scoreObj) {
    const poolMd = renderPoolReportMarkdown(scoreObj);
    atomicWrite(path.join(outDir, `pool-summary-${date}.md`), poolMd);
  }
  return { date, reports: written.length, codes: written };
}

function atomicWrite(file, str) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, str);
  fs.renameSync(tmp, file);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dataDir = (args.indexOf('--data') >= 0) ? args[args.indexOf('--data') + 1] : path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const outDir = (args.indexOf('--out') >= 0) ? args[args.indexOf('--out') + 1] : path.join(__dirname, '..', 'store', 'derived', 'reports');
  const date = (args.indexOf('--date') >= 0) ? args[args.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10);
  const scoreIdx = args.indexOf('--score'); const scoreFile = scoreIdx >= 0 ? args[scoreIdx + 1] : null;
  const config = require('../core/config/analysis.json');
  let scoreObj = null; if (scoreFile) scoreObj = JSON.parse(fs.readFileSync(path.resolve(scoreFile), 'utf-8'));
  const r = buildReports({ dataDir, outDir, date, config, scoreObj });
  console.log('[report] done', JSON.stringify(r));
}

module.exports = { renderReportMarkdown, renderPoolReportMarkdown, buildReports };
