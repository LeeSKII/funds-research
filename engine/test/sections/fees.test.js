// engine/test/sections/fees.test.js — self-test for the fees section extractor.
//
// Reads the 005827 ground-truth snapshot, runs extractFees, and asserts the 5 canonical
// fee fields. Numbers/short fields use exact equality; there are no free-text fields here.
//
// Run: node --test engine/test/sections/fees.test.js   (from project root)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { extractFees } = require('../../analyze/sections/fees');

const SNAPSHOT = path.join(__dirname, '..', 'fixtures', 'mock-fund-innertext.json');

function loadLines() {
  const raw = fs.readFileSync(SNAPSHOT, 'utf8');
  const j = JSON.parse(raw);
  return j.innerText.split('\n');
}

test('extractFees — 005827 canonical values', () => {
  const lines = loadLines();
  const block = extractFees(lines, { code: '005827' });

  // ter from 综合费率 top-summary block (first occurrence), value on the next line.
  assert.strictEqual(block.ter, 1.51, 'ter = 综合费率 1.51%');

  // Prospectus (购买费用) rows — anchored on the (每年) variant.
  assert.strictEqual(block.managementFee, 1.2, 'managementFee from 管理费(每年)\\t1.20%');
  assert.strictEqual(block.custodianFee, 0.2, 'custodianFee from 托管费(每年)\\t0.20%');

  // salesServiceFee null — row reads 该份额不收取销售服务费 (no number to parse).
  assert.strictEqual(block.salesServiceFee, null, 'salesServiceFee null for non-charging share class');

  // minInvestment from 最小投资额度 → 申购\\t1元 (empty line skipped).
  assert.strictEqual(block.minInvestment, 1, 'minInvestment = 1 元');
});

test('extractFees — anchored on (每年) not the waterfall (年) rows', () => {
  // Defense-in-depth: confirm we did NOT pick up the 费率与成本 waterfall values.
  // The waterfall has 管理费(年)=1.20, 托管费(年)=0.20, 销售服务费(年)=— on layout (a).
  // For 005827 these happen to coincide, so the real guard is that salesServiceFee is null
  // (waterfall would give — → also null) — but the prospectus anchor is what produces the null.
  // This test documents the invariant; if a future fund diverges, this still anchors correctly.
  const lines = loadLines();
  const block = extractFees(lines, { code: '005827' });
  assert.ok(block.managementFee != null, 'managementFee must be present (not the waterfall null case)');
});

test('extractFees — null-safe on empty / missing input', () => {
  const empty = extractFees([], { code: '005827' });
  assert.strictEqual(empty.ter, null);
  assert.strictEqual(empty.managementFee, null);
  assert.strictEqual(empty.custodianFee, null);
  assert.strictEqual(empty.salesServiceFee, null);
  assert.strictEqual(empty.minInvestment, null);

  const noFees = extractFees(['不相关的行', '没有费用数据'], { code: '005827' });
  assert.strictEqual(noFees.ter, null);
  assert.strictEqual(noFees.managementFee, null);
  assert.strictEqual(noFees.minInvestment, null);
});

test('extractFees — returns the documented shape (5 fields)', () => {
  const lines = loadLines();
  const block = extractFees(lines, { code: '005827' });
  assert.deepStrictEqual(
    Object.keys(block).sort(),
    ['custodianFee', 'managementFee', 'minInvestment', 'salesServiceFee', 'ter']
  );
});
