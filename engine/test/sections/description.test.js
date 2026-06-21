// engine/test/sections/description.test.js — self-test for the description (top summary strip
// + identity) section extractor. Loads the 005827 ground-truth innerText snapshot, runs the
// extractor, and asserts every field against the known-good values for 易方达蓝筹精选混合 005827.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractDescription } = require('../../analyze/sections/description');

const SNAPSHOT = path.join(
  __dirname, '..', '..', '..',
  'research', 'funds', 'raw-snapshots', 'morningstar-fund-005827-20260621-innertext.json'
);

function loadLines() {
  const raw = fs.readFileSync(SNAPSHOT, 'utf8');
  const j = JSON.parse(raw);
  return j.innerText.split('\n');
}

test('extractDescription: 005827 top summary strip + identity', () => {
  const lines = loadLines();
  const block = extractDescription(lines, { code: '005827' });

  // ── identity ─────────────────────────────────────────────────────────
  assert.equal(block.code, '005827', 'code');
  assert.equal(block.name, '易方达蓝筹精选混合', 'name');

  // ── strip numeric / status fields (exact match) ──────────────────────
  assert.equal(block.category, '沪港深积极配置', 'category');
  assert.equal(block.fundType, '混合型', 'fundType');
  assert.equal(block.inceptionDate, '2018-09-05', 'inceptionDate');
  assert.equal(block.currency, '人民币', 'currency');
  assert.equal(block.nav, 1.5258, 'nav');
  assert.equal(block.navDate, '2026-06-18', 'navDate');
  assert.equal(block.dailyChangePct, -0.60, 'dailyChangePct (-0.60% → -0.6)');
  assert.equal(block.riskLevel, '中风险(R3)', 'riskLevel');
  assert.equal(block.styleBox, '大盘平衡', 'styleBox');
  assert.equal(block.aumYi, 267.93, 'aumYi (267.93亿 → 267.93)');
  assert.equal(block.dailyPurchaseLimit, 50000, 'dailyPurchaseLimit (50,000元 → 50000)');
  assert.equal(block.purchaseStatus, '限大额', 'purchaseStatus');
  assert.equal(block.redemptionStatus, '可赎回', 'redemptionStatus');
  assert.equal(block.lockupPeriod, '无锁定期', 'lockupPeriod');
  assert.equal(block.custodian, '中国银行', 'custodian');
  assert.equal(block.asOfDate, '2026-05-31', 'asOfDate');

  // ── home-tab rule: strip-only — these are NOT ours and must be absent ──
  assert.ok(!('ter' in block), 'ter belongs to fees, not description');
  assert.ok(!('turnover' in block), 'turnover belongs to portfolio, not description');
  assert.ok(!('manager' in block), 'manager names belong to manager.team, not description');
  assert.ok(!('rating3Y' in block) && !('ratings' in block), 'ratings belong to performance');
});

test('extractDescription: null-safe on empty input', () => {
  const block = extractDescription([], { code: '000000' });
  assert.equal(block.code, '000000', 'code passes through from ctx');
  assert.equal(block.name, null, 'name null on empty');
  assert.equal(block.nav, null);
  assert.equal(block.navDate, null);
  assert.equal(block.asOfDate, null);
});

test('extractDescription: never throws on garbage input', () => {
  let block;
  assert.doesNotThrow(() => {
    block = extractDescription(['随意', '不相关', '文本'], { code: '123456' });
  });
  assert.equal(block.code, '123456');
  assert.equal(block.nav, null);
});
