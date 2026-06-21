const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path'); const fs = require('fs'); const os = require('os');
const { runAnalysis } = require('../analyze/run-analysis');
const { validate } = require('../core/validate');

test('runAnalysis: loads real data/fund/, produces schema-valid score-<date>.json with heatmap + ranked', () => {
  const dataDir = path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-'));
  const res = runAnalysis({ dataDir, outDir, date: '2026-06-21', computedAt: '2026-06-21' });
  assert.ok(res.fundCount > 0);
  assert.ok(res.ranked.bySectorFlow.length === res.fundCount);
  assert.ok(res.ranked.byAlphaQuality.length === res.fundCount);
  assert.ok(res.ranked.byBandContribution.length === res.fundCount);
  const file = path.join(outDir, 'score-2026-06-21.json');
  assert.ok(fs.existsSync(file));
  const obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
  assert.ok(obj.sectorFlowHeatmap && obj.sectorFlowHeatmap.sectors);
  assert.strictEqual(obj.date, '2026-06-21');
  // every card schema-valid
  let bad = 0;
  for (const card of obj.cards) { const v = validate('analysis-score', card); if (!v.valid) { bad++; console.log(card.code, JSON.stringify(v.errors)); } }
  assert.strictEqual(bad, 0);
});

test('runAnalysis: legacy-shape dossier (no description) skipped, no crash', () => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'funddata-'));
  // one new-schema dossier (copy 006502) + one legacy flat (no description)
  const src = require('../../../data/fund/006502/fund-006502-20260620.json');
  fs.mkdirSync(path.join(tmpData, '006502'), { recursive: true });
  fs.writeFileSync(path.join(tmpData, '006502', 'fund-006502-20260620.json'), JSON.stringify(src));
  fs.mkdirSync(path.join(tmpData, '999999'), { recursive: true });
  fs.writeFileSync(path.join(tmpData, '999999', 'fund-999999-20260620.json'), JSON.stringify({ code:'999999', aum:5, sharpe_3y:1 })); // legacy flat
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-'));
  const res = runAnalysis({ dataDir: tmpData, outDir, date: '2026-06-21', computedAt: '2026-06-21' });
  assert.strictEqual(res.fundCount, 1); // legacy filtered
});
