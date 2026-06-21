// test/sections/manager.test.js — 基金经理 tab extractor regression guard.
//
// Locks the multi-manager team resolution (the v1 limitation), the tenure 至今/null distinction,
// the count/tenure strip stats, and the lead KPI layout traps:
//   • 管理数量 reads the fund count (4) BEFORE its label, NOT the 前71% percentile before 收益能力.
//   • 任职回报 (56.16) is a real %, not a bare bio join-year (year-guard rejects 1900-2099 ints).
// Ground truth: 易方达蓝筹精选混合 005827 (张坤 lead, 2 co-managers).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractManager } = require('../../analyze/sections/manager');

const SNAP = path.join(__dirname, '..', '..', '..', 'research', 'funds', 'raw-snapshots', 'morningstar-fund-005827-20260621-innertext.json');

function loadLines() {
  const raw = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const text = typeof raw === 'string' ? raw : (raw.innerText || '');
  return text.split('\n');
}

test('manager team: 3 members with correct tenure (至今 → null end)', () => {
  const lines = loadLines();
  const { team } = extractManager(lines, { code: '005827' });
  assert.equal(team.length, 3);
  assert.deepEqual(team[0], { name: '张坤', tenureStart: '2018-09-05', tenureEnd: null });
  assert.deepEqual(team[1], { name: '何一铖', tenureStart: '2026-05-23', tenureEnd: null });
  assert.deepEqual(team[2], { name: '杨思亮', tenureStart: '2026-05-23', tenureEnd: null });
});

test('managerCount / maxTenureYears / avgTenureYears strip stats', () => {
  const lines = loadLines();
  const { managerCount, maxTenureYears, avgTenureYears } = extractManager(lines, { code: '005827' });
  assert.equal(managerCount, 3);
  assert.equal(maxTenureYears, 7.8);   // 7.8年 — 年 stripped
  assert.equal(avgTenureYears, 2.6);   // 2.6年
});

test('lead = longest-tenure manager (张坤) with KPI stats', () => {
  const lines = loadLines();
  const { lead } = extractManager(lines, { code: '005827' });
  assert.equal(lead.name, '张坤');
  // 任职回报56.16% — real %, year-guard must NOT reject 56.16
  assert.equal(lead.returnSinceInception, 56.16);
  // 在管规模: layout (a) value BEFORE label = 416.72亿
  assert.equal(lead.aumYi, 416.72);
  // 管理数量: line BEFORE label = 4 (the fund count), NOT 前71% percentile before 收益能力
  assert.equal(lead.fundsManaged, 4);
});

test('lead.fundsManaged is the fund count, not the 收益能力 percentile', () => {
  // Explicit guard against the layout (a) swap trap: 前71% sits BEFORE 收益能力 and is also a
  // bare number — a naive numBefore('收益能力') would yield 71. Confirm we did not pick it up.
  const lines = loadLines();
  const { lead } = extractManager(lines, { code: '005827' });
  assert.notEqual(lead.fundsManaged, 71);
  assert.equal(lead.fundsManaged, 4);
});

test('year-guard: 任职回报 is a %, not a bare 1900-2099 join-year', () => {
  const lines = loadLines();
  const { lead } = extractManager(lines, { code: '005827' });
  const v = lead.returnSinceInception;
  assert.ok(v != null, 'returnSinceInception present');
  assert.ok(!(Number.isInteger(v) && v >= 1900 && v <= 2099), 'not a bare calendar year');
});

test('null-safe on empty input (never throws)', () => {
  const out = extractManager([], { code: '000000' });
  assert.deepEqual(out.team, []);
  assert.equal(out.managerCount, null);
  assert.equal(out.maxTenureYears, null);
  assert.equal(out.avgTenureYears, null);
  assert.equal(out.lead.name, null);
  assert.equal(out.lead.returnSinceInception, null);
  assert.equal(out.lead.aumYi, null);
  assert.equal(out.lead.fundsManaged, null);
});
