// test/parse-fund.test.js — v2 regression guard for the fund-detail dossier parser.
//
// v2 is page-structure-aligned: top-level blocks = page TABs, each extractor in
// engine/analyze/sections/<name>.js (with colocated tests). THIS file guards (1) the load-bearing
// shared primitives and (2) the ORCHESTRATOR assembly on a real fund (006502) — i.e. that all 8
// section extractors compose into a schema-valid dossier. Per-section field assertions live in
// engine/test/sections/*.test.js.
//
// Hard-won behaviors locked here:
//   - the THREE value-layouts (numAfter / numOnLine / numBefore) — the v1.0 bug source
//   - pairAfter accepts the FULL caveat set (负值暂不排名) — the v1.1 calmar/sortino fix
//   - the 近两年 column sniff (v1.0 regex 近二-vs-近两 → column shift)
//   - v2 assembly: 006502 → 9 page-tab blocks, schema-valid, real Brinson identity, fixed fees

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseNum, numAfter, numOnLine, numBefore, pairAfter } = require('../analyze/shared');
const { parseFund, VERSION } = require('../analyze/parse-fund');

const SNAP = path.join(__dirname, '..', '..', 'research', 'funds', 'raw-snapshots', 'morningstar-fund-006502-20260620-innertext.json');

// ── unit: shared primitives ───────────────────────────────────────────────
test('parseNum strips 优于X%同类 / — / % / commas and keeps sign', () => {
  assert.equal(parseNum('优于98%同类\t2.80\t1.58'), 2.80);
  assert.equal(parseNum('—'), null);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('1,234.56%'), 1234.56);
  assert.equal(parseNum('-11.90%'), -11.90);
  assert.equal(parseNum('318.77%'), 318.77);   // capture ratio >100 preserved
});

test('the three value-layouts (numAfter / numOnLine / numBefore)', () => {
  assert.equal(numAfter(['最大回撤', '-11.90%'], '最大回撤'), -11.9);                 // (c) after
  assert.equal(numOnLine(['管理费(每年)\t1.20%'], '管理费(每年)'), 1.2);             // (b) on-line
  assert.equal(numOnLine(['任职回报327.11%'], '任职回报'), 327.11);                  // (b) on-line
  assert.equal(numBefore(['118.48亿', '在管规模', '3', '管理数量'], '在管规模'), 118.48); // (a) before
  assert.equal(numBefore(['118.48亿', '在管规模', '3', '管理数量'], '管理数量'), 3);     // (a) before
});

test('pairAfter accepts 负值暂不排名 (was the v1.1 calmar/sortino gap)', () => {
  const lines = ['性价比', '夏普比率', '\t优于2%同类\t-15.80\t1.86', '卡玛比率', '\t负值暂不排名\t-0.46\t4.09', '索提诺比率', '\t负值暂不排名\t-0.89\t3.92'];
  assert.deepEqual(pairAfter(lines, '夏普比率'), { fund: -15.8, peer: 1.86 });
  assert.deepEqual(pairAfter(lines, '卡玛比率'), { fund: -0.46, peer: 4.09 });
  assert.deepEqual(pairAfter(lines, '索提诺比率'), { fund: -0.89, peer: 3.92 });
});

// ── integration: orchestrator assembly on 006502 (skip if the untracked fixture is absent) ──
test('parseFund v2 assembles 006502 — 9 page-tab blocks, schema-shape, Brinson identity, fixed fees',
  { skip: !fs.existsSync(SNAP) }, () => {
    const raw = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    const text = typeof raw === 'string' ? raw : (raw.innerText || '');
    const d = parseFund(text, { code: '006502' });

    // top-level = the 9 page-tab blocks (no v1 leftovers like meta/basic/brinson/layout)
    assert.deepEqual(Object.keys(d),
      ['description', 'performance', 'risk', 'fees', 'portfolio', 'holders', 'manager', 'strategy', '_diagnostics']);
    assert.equal(VERSION, '2.0.0');

    // column sniff: 006502 is ~7.6y → 8 cols; 近两年 MUST be present (v1.0 近二-vs-近两 guard)
    assert.equal(d._diagnostics.layout.trailingCols, 8);
    assert.ok('近两年' in d.performance.trailing, '近两年 present');
    assert.equal(d.performance.trailing['近一年'], 389.69);
    assert.equal(d.performance.trailing['近三年'], 60.97);
    assert.equal(d.performance.trailing['近五年'], 29.27);

    // annual: 2022 bear year negative
    assert.ok(d.performance.annual['2022'] < 0, '2022 annual negative');

    // Brinson: real, identity holds (006502 is a pure stock-picker)
    assert.equal(d.performance.attribution.real, true);
    assert.equal(d.performance.attribution.excess, 144.34);
    assert.equal(d.performance.attribution._identityCheck.ok, true);

    // portfolio
    assert.equal(d.portfolio.topHoldings.length, 10);
    assert.ok(d.portfolio.top10Concentration > 0 && d.portfolio.top10Concentration < 100);
    assert.equal(d.portfolio.regionAllocation.length, 14);

    // FIXED v1.0 bugs under the v2 shape: fees correct, return-since is a %, AUM is a magnitude
    assert.equal(d.fees.managementFee, 1.2);
    assert.equal(d.fees.custodianFee, 0.2);
    assert.ok(d.manager.lead.returnSinceInception > 100, 'returnSinceInception is a real %');
    assert.ok(d.manager.lead.aumYi >= 10, 'aumYi is a magnitude');

    // strategy block is populated in v2
    assert.ok(d.strategy.benchmark && d.strategy.benchmark.length > 0, 'benchmark captured');
  });
