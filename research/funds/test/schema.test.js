const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../core/validate');

function sampleCard() {
  return { code:'006502', name:'x', asOfDate:'2026-06-21', bandWindowLabel:'年度近似',
    sizeRisk:{aumYi:13.05,flag:'ok'},
    scores:{ alphaQuality:{value:0.8,tier:'true_alpha'}, endorsement:{value:0.5},
      bandContribution:{value:0.7}, sectorFlow:{value:0.9}, theme:{}, riskAdjusted:{} },
    flags:['true_alpha'], narrative:{whatItBetsOn:'a',whoDrivesAlpha:'b',sectorFlowVerdict:'c',bandVerdict:'d'},
    provenance:{dossierFile:'f',dossierDate:'2026-06-20',scriptVersion:'1.0.0',computedAt:'2026-06-21'} };
}

test('analysis-score schema validates a well-formed card', () => {
  const r = validate('analysis-score', sampleCard());
  assert.ok(r.valid, JSON.stringify(r.errors));
});

test('analysis-score rejects value out of [0,1]', () => {
  const bad = sampleCard(); bad.scores.alphaQuality.value = 1.5;
  const r = validate('analysis-score', bad);
  assert.ok(!r.valid);
});

test('analysis-score rejects unknown sizeRisk flag', () => {
  const bad = sampleCard(); bad.sizeRisk.flag = 'whatever';
  const r = validate('analysis-score', bad);
  assert.ok(!r.valid);
});
