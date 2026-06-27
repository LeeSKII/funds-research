// Parity: browser scoreFundCard (default weights) must reproduce research/funds' score-2026-06-27.json.
// spec §6 — the hard gate that keeps the port honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreFundCard, fineScore } from '../public/lib/scoring.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..'); // repo root
const SCORE = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/derived/score-2026-06-27.json'), 'utf8'));
const ANALYSIS = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/core/config/analysis.json'), 'utf8'));
const SHORTLIST = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/derived/shortlist-2026-06-27.json'), 'utf8'));

const cfg = {
  alphaQuality: ANALYSIS.alphaQuality, endorsement: ANALYSIS.endorsement,
  riskAdjusted: ANALYSIS.riskAdjusted, sizeRisk: ANALYSIS.sizeRisk, band: ANALYSIS.band,
};
const fineW = ANALYSIS.shortlist.fine.weights;
const fineDs = ANALYSIS.shortlist.fine.downside;
const TOL = 0.01;

function loadDossier(code) {
  const dir = path.join(ROOT, 'data/fund', code);
  if (!fs.existsSync(dir)) return null;
  const latest = fs.readdirSync(dir).filter((f) => /^fund-.*\.json$/.test(f)).sort().pop();
  return latest ? JSON.parse(fs.readFileSync(path.join(dir, latest), 'utf8')) : null;
}

test('parity: every card with a dossier reproduces alphaQuality/endorsement/band/riskAdjusted/sizeRisk', () => {
  let checked = 0, skipped = 0;
  for (const card of SCORE.cards) {
    const dossier = loadDossier(card.code);
    if (!dossier) { skipped++; continue; }
    const sf = card.scores.sectorFlow?.value ?? 0;
    const recomputed = scoreFundCard(dossier, { sectorFlowValue: sf }, cfg, fineW, fineDs);
    const aq = card.scores.alphaQuality, en = card.scores.endorsement, bc = card.scores.bandContribution, ra = card.scores.riskAdjusted;
    assert.ok(Math.abs(recomputed.alphaQualityValue - aq.value) <= TOL, `${card.code} αq ${recomputed.alphaQualityValue} vs ${aq.value}`);
    assert.equal(recomputed.alphaTier, aq.tier, `${card.code} tier`);
    assert.ok(Math.abs(recomputed.endorsementValue - en.value) <= TOL, `${card.code} endorsement ${recomputed.endorsementValue} vs ${en.value}`);
    assert.ok(Math.abs(recomputed.bandValue - bc.value) <= TOL, `${card.code} band ${recomputed.bandValue} vs ${bc.value}`);
    assert.equal(recomputed.sizeRiskFlag, card.sizeRisk.flag, `${card.code} sizeRisk`);
    assert.equal(recomputed.captureFlag, ra.captureFlag, `${card.code} captureFlag`);
    checked++;
  }
  assert.ok(checked > 200, `only ${checked} cards checked (expected most of 317)`);
});

test('parity: fineScore (default weights) reproduces shortlist fineScore', () => {
  const byCode = Object.fromEntries(SCORE.cards.map((c) => [c.code, c]));
  for (const sl of SHORTLIST.shortlist) {
    const card = byCode[sl.code];
    const recomputed = fineScore({
      alphaTier: card.scores.alphaQuality.tier,
      alphaQualityValue: card.scores.alphaQuality.value,
      alphaRisk: card.scores.riskAdjusted.alpha,
      downsideCapture: card.scores.riskAdjusted.downsideCapture,
      sectorFlowValue: card.scores.sectorFlow.value,
      bandValue: card.scores.bandContribution.value,
      endorsementValue: card.scores.endorsement.value,
    }, fineW, fineDs, ANALYSIS.alphaQuality.alpha5yNormalizeDivisor);
    assert.ok(Math.abs(recomputed - sl.fineScore) <= TOL, `${sl.code} fine ${recomputed} vs ${sl.fineScore}`);
  }
});
