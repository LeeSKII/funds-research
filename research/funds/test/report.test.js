const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path'); const fs = require('fs'); const os = require('os');
const { renderReportMarkdown, renderPoolReportMarkdown, buildReports } = require('../analyze/report');
const { scoreFund } = require('../analyze/score');
const { buildSectorFlowHeatmap } = require('../analyze/sectorflow-index');
const config = require('../core/config/analysis.json');

const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');
const d159994 = require('../../../data/fund/159994/fund-159994-20260620.json');
const heatmap = buildSectorFlowHeatmap([d006502, d159994], config);
const cardTrue = scoreFund(d006502, { heatmap, config, computedAt: '2026-06-22' });
const cardEtf = scoreFund(d159994, { heatmap, config, computedAt: '2026-06-22' });

test('单基金报告(真α 006502)：含名称/代码/tier/Brinson拆解/跌势捕获，无 [object Object]', () => {
  const md = renderReportMarkdown(cardTrue, d006502);
  assert.match(md, /财通集成电路/);
  assert.match(md, /006502/);
  assert.match(md, /真α/);
  // Brinson 拆解数字出现（基金回报 185.49→显示 185.5% / 超额 144.34→144.3%）
  assert.match(md, /185\.5%/);
  assert.match(md, /144\.3%/);
  assert.match(md, /下行捕获/);
  assert.match(md, /-21\.49/);
  // 4 个主要章节都在
  for (const h of ['## 概要', '## α 来源', '## 板块资金流向', '## 区间表现', '## 风险特征', '## 持仓主题', '## 结论']) {
    assert.ok(md.includes(h), `missing section ${h}`);
  }
  // 否定式边界声明
  assert.match(md, /否定式边界/);
});

test('单基金报告(no_brinion ETF 159994)：优雅跳过 Brinson 拆解，标注无归因', () => {
  const md = renderReportMarkdown(cardEtf, d159994);
  assert.match(md, /无 Brinson 归因/);
  assert.doesNotMatch(md, /Brinson 拆解：基金回报/); // 真型才有这行
  assert.match(md, /工具属性/); // verdict 文案
});

test('报告对缺 dossier 也稳健（仅 card）', () => {
  const md = renderReportMarkdown(cardTrue, null);
  assert.match(md, /006502/);
  assert.match(md, /真α/);
});

test('池级摘要报告：含日期/数量/景气表/真α Top', () => {
  const scoreObj = { date: '2026-06-22', fundCount: 2, sectorFlowHeatmap: heatmap, cards: [cardTrue, cardEtf] };
  const md = renderPoolReportMarkdown(scoreObj);
  assert.match(md, /候选池研究摘要 · 2026-06-22/);
  assert.match(md, /景气排名/);
  assert.match(md, /真α Top 10/);
});

test('buildReports：写盘 report-<code>-<date>.md + pool-summary，返回 codes', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
  const r = buildReports({ dataDir: path.join(__dirname, '..', '..', '..', 'data', 'fund'), outDir, date: '2026-06-22', config, codes: ['006502', '159994'], scoreObj: { date: '2026-06-22', fundCount: 2, sectorFlowHeatmap: heatmap, cards: [cardTrue, cardEtf] } });
  assert.ok(r.reports === 2);
  assert.ok(fs.existsSync(path.join(outDir, 'report-006502-2026-06-22.md')));
  assert.ok(fs.existsSync(path.join(outDir, 'pool-summary-2026-06-22.md')));
});
