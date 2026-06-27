import test from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml } from '../public/lib/md.mjs';

test('mdToHtml: H1, blockquote, H2, hr', () => {
  const md = '# 财通集成电路产业股票A（006502）\n\n> 研究报告 · 数据截止 2026-05-31\n\n## 概要\n\n---';
  const html = mdToHtml(md);
  assert.match(html, /<h1>财通集成电路产业股票A（006502）<\/h1>/);
  assert.match(html, /<blockquote>研究报告 · 数据截止 2026-05-31<\/blockquote>/);
  assert.match(html, /<h2>概要<\/h2>/);
  assert.match(html, /<hr>/);
});

test('mdToHtml: bold + code inline, escaped', () => {
  const html = mdToHtml('- **规模风险**：13.05亿 · 正常\n- **信号旗**：`true_alpha` `low_benchmark_fit`');
  assert.match(html, /<strong>规模风险<\/strong>/);
  assert.match(html, /<code>true_alpha<\/code>/);
  assert.match(html, /<code>low_benchmark_fit<\/code>/);
  assert.match(html, /<ul>/);
});

test('mdToHtml: table with header + separator + rows', () => {
  const md = '| 板块 | 本基金权重 | 超配 |\n|---|---|---|\n| 科技 | 98.4% | 2.6% |\n| 工业 | 0.0% | -1.9% |';
  const html = mdToHtml(md);
  assert.match(html, /<table>/);
  assert.match(html, /<thead><tr><th>板块<\/th><th>本基金权重<\/th><th>超配<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>科技<\/td><td>98.4%<\/td><td>2.6%<\/td>/);
  assert.match(html, /<td>-1.9%<\/td>/);   // negative number preserved
});

test('mdToHtml: nested bullets (2-space indent)', () => {
  const md = '- Brinson 拆解：基金 185.5% vs 基准 41.1%\n  - 选股贡献 154.2%\n  - 恒等校验：Δ0.00 ✓';
  const html = mdToHtml(md);
  assert.match(html, /<li>Brinson 拆解：基金 185.5% vs 基准 41.1%<ul>/, 'nested ul is INSIDE the parent li (valid HTML)');
  assert.match(html, /<li>选股贡献 154.2%<\/li>/);
  assert.equal((html.match(/<ul>/g) || []).length, 2, 'one outer + one nested <ul>');
  assert.equal((html.match(/<\/ul>/g) || []).length, 2, 'both <ul> closed');
});

test('mdToHtml: end-to-end renders a realistic report excerpt without dropping content', () => {
  const md = [
    '# 财通集成电路产业股票A（006502）',
    '',
    '> 研究报告 · 数据截止 2026-05-31 · 年度近似（无逐日净值） · 生成 2026-06-27',
    '',
    '## α 来源',
    '',
    '- 选股贡献占超额 100%（真 α 选股型）',
    '- Brinson 拆解：基金回报 185.5% vs 基准 41.1% → 超额 144.3%',
    '  - 选股贡献 154.2% · 行业配置贡献 -9.8%',
    '',
    '## 区间表现',
    '',
    '| 年度 | 基金 | 同类 | 超额 |',
    '|---|---|---|---|',
    '| 2019 | 34.7% | 52.1% | -17.41% |',
    '| 2022 | -25.6% | -29.3% | 3.68% |',
    '',
    '---',
  ].join('\n');
  const html = mdToHtml(md);
  // every key data point from the input appears in the output
  for (const needle of ['财通集成电路', '研究报告 · 数据截止', 'α 来源', '选股贡献占超额 100%',
    'Brinson 拆解', '选股贡献 154.2%', '区间表现', '34.7%', '-17.41%', '-25.6%', '3.68%']) {
    assert.ok(html.includes(needle), `missing in output: ${needle}`);
  }
});
