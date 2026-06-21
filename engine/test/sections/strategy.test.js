// engine/test/sections/strategy.test.js — self-test for the 策略 tab extractor.
//
// Reads the mock fixture (anonymized 005827 structure), splits on newline, and asserts the strategy
// block: objective (exact), scope/strategy (startsWith), benchmark (formula substrings), and the
// two long-form report texts (季报 commentary + 年报 outlook). Long free-text asserts use
// startsWith (brittle to exact full match); every short/numeric/structural field is exact.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { extractStrategy } = require('../../analyze/sections/strategy');

const SNAP = path.join(__dirname, '..', 'fixtures', 'mock-fund-innertext.json');

function loadLines() {
  const raw = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const text = typeof raw === 'string' ? raw : (raw.innerText || '');
  return text.split('\n');
}

test('strategy.objective — exact match of the one-line 投资目标', () => {
  const lines = loadLines();
  const s = extractStrategy(lines, { code: '005827' });
  assert.equal(
    s.objective,
    '该基金在控制风险的前提下，追求超越业绩比较基准的投资回报。'
  );
});

test('strategy.scope — startsWith 国内依法发行 (multi-paragraph joined, ends before 投资策略)', () => {
  const lines = loadLines();
  const s = extractStrategy(lines, { code: '005827' });
  assert.ok(s.scope, 'scope is non-null');
  assert.ok(s.scope.startsWith('该基金的投资范围包括国内依法发行'));
  // the block must NOT bleed into 投资策略 (the terminator)
  assert.ok(!s.scope.includes('资产配置方面'), 'scope does not contain strategy text');
  // sanity: scope mentions 蓝筹股 (the fund-specific scope tail)
  assert.ok(s.scope.includes('蓝筹股'), 'scope mentions 蓝筹股 tail');
});

test('strategy.strategy — startsWith 资产配置方面, ends before 业绩比较基准', () => {
  const lines = loadLines();
  const s = extractStrategy(lines, { code: '005827' });
  assert.ok(s.strategy, 'strategy is non-null');
  assert.ok(s.strategy.startsWith('资产配置方面'));
  assert.ok(!s.strategy.includes('沪深300'), 'strategy does not contain benchmark formula');
  assert.ok(s.strategy.includes('债券投资'), 'strategy mentions 债券投资 paragraph');
});

test('strategy.benchmark — single-line formula containing all three index substrings', () => {
  const lines = loadLines();
  const s = extractStrategy(lines, { code: '005827' });
  assert.ok(s.benchmark, 'benchmark is non-null');
  assert.ok(s.benchmark.includes('沪深300'), 'contains 沪深300');
  assert.ok(s.benchmark.includes('中证港股通'), 'contains 中证港股通');
  assert.ok(s.benchmark.includes('中债总指数'), 'contains 中债总指数');
  // weights should appear
  assert.ok(s.benchmark.includes('45'), '45% weight');
  assert.ok(s.benchmark.includes('35'), '35% weight');
  assert.ok(s.benchmark.includes('20'), '20% weight');
});

test('strategy.latestCommentary — 季报 投资策略及运作分析 block', () => {
  const lines = loadLines();
  const s = extractStrategy(lines, { code: '005827' });
  const c = s.latestCommentary;
  assert.ok(c.report && c.report.includes('2026年第一季报'), 'report label is 2026 Q1');
  assert.ok(c.text, 'commentary text is non-null');
  assert.ok(
    c.text.startsWith('2026年一季度，A股市场方面'),
    'commentary starts with the Q1 A-share opening'
  );
  // the commentary must NOT bleed into the outlook (terminator 基金经理展望 worked)
  assert.ok(!c.text.includes('在2025年，市场一个显著特征'), 'commentary does not contain outlook text');
  // long-form text is genuinely long (>500 chars), proving full capture
  assert.ok(c.text.length > 500, `commentary is long-form (len=${c.text.length})`);
});

test('strategy.outlook — 年报 基金经理展望 block', () => {
  const lines = loadLines();
  const s = extractStrategy(lines, { code: '005827' });
  const o = s.outlook;
  assert.ok(o.report && o.report.includes('2025年年报'), 'report label is 2025 annual');
  assert.ok(o.text, 'outlook text is non-null');
  assert.ok(
    o.text.startsWith('在2025年，市场一个显著特征'),
    'outlook starts with the 2025 linear-extrapolation opening'
  );
  // the outlook must NOT bleed into 相关基金 (next-tab table)
  assert.ok(!o.text.includes('模拟测试混合\t005827'), 'outlook does not contain 相关基金 table');
  // long-form text is genuinely long (>500 chars)
  assert.ok(o.text.length > 500, `outlook is long-form (len=${o.text.length})`);
});

test('strategy block shape — all six fields present, never throws on empty input', () => {
  const lines = loadLines();
  const s = extractStrategy(lines, { code: '005827' });
  // top-level fields
  assert.ok(typeof s.objective === 'string');
  assert.ok(typeof s.scope === 'string');
  assert.ok(typeof s.strategy === 'string');
  assert.ok(typeof s.benchmark === 'string');
  // sub-objects with the report/date/text shape
  assert.ok(s.latestCommentary && typeof s.latestCommentary === 'object');
  assert.ok(s.outlook && typeof s.outlook === 'object');
  assert.ok('report' in s.latestCommentary && 'date' in s.latestCommentary && 'text' in s.latestCommentary);
  assert.ok('report' in s.outlook && 'date' in s.outlook && 'text' in s.outlook);

  // null-safety: empty input must not throw, and yields null fields
  const empty = extractStrategy([], { code: '000000' });
  assert.equal(empty.objective, null);
  assert.equal(empty.scope, null);
  assert.equal(empty.strategy, null);
  assert.equal(empty.benchmark, null);
  assert.equal(empty.latestCommentary.report, null);
  assert.equal(empty.outlook.report, null);

  // noise input (no labels) must not throw
  const noise = extractStrategy(['foo', 'bar', 'baz'], { code: '000000' });
  assert.equal(noise.objective, null);
});
