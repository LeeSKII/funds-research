// app.js — state + wiring. Pure scoring lives in lib/; views only render.
import { fineScore } from './lib/scoring.mjs';
import { renderTopbar } from './views/topbar.js';
import { renderScorer, bindScorer } from './views/scorer.js';
import { renderRankedList, bindList } from './views/ranked-list.js';
import { renderDetailCard } from './views/detail-card.js';
import { renderAudit } from './views/audit.js';

const state = {
  bundle: null, mode: 'score',
  candidateIds: new Set(),
  weights: null, downside: null, advanced: null,
  baselineRank: new Map(),
  ranked: [],
  selectedCode: null,
  query: '',
  auditQuery: '',
  filterChips: { true_alpha: true, mixed: false, beta: false, star5: false, large: false, size100: false },
};

async function init() {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('fe-theme') || 'light');
  state.bundle = await (await fetch('/api/bundle')).json();
  const d = state.bundle.defaults;
  state.weights = { ...d.fineWeights };
  state.downside = { ...d.downside };
  state.advanced = { alphaSub: { ...d.alphaSub }, alphaThresholds: { ...d.alphaThresholds }, endorsementW: { ...d.endorsementWeights } };
  state.candidateIds = new Set(state.bundle.cards.map((c) => c.code));   // 317 scored funds
  computeBaseline();
  state.selectedCode = state.bundle.shortlist[0]?.code || state.bundle.cards[0]?.code;
  render();
  const es = new EventSource('/sse');
  es.addEventListener('reload', () => location.reload());
}

// Recompute every card's fineScore under CURRENT weights, rank, populate state.ranked.
function recompute() {
  const cards = state.bundle.cards.map((c) => {
    const s = c.scores;
    const card = {
      alphaTier: s.alphaQuality.tier,
      alphaQualityValue: s.alphaQuality.value,
      alphaRisk: s.riskAdjusted.alpha,                  // 🔴 no_brinion α proxy (spec §5.2 no_brinion branch)
      downsideCapture: s.riskAdjusted.downsideCapture,
      sectorFlowValue: s.sectorFlow.value, bandValue: s.bandContribution.value, endorsementValue: s.endorsement.value,
      code: c.code, name: c.name, flags: c.flags, sizeRiskFlag: c.sizeRisk.flag, aumYi: c.sizeRisk.aumYi,
      alpha: s.alphaQuality, sf: s.sectorFlow, narrative: c.narrative, ratings: s.endorsement.ratings,
    };
    card.fineScore = fineScore(card, state.weights, state.downside, state.bundle.defaults.alphaDivisor);
    return card;
  });
  cards.sort((a, b) => b.fineScore - a.fineScore);
  cards.forEach((c, i) => (c.rank = i + 1));
  state.ranked = cards;
}

function computeBaseline() {
  const d = state.bundle.defaults;
  const base = { weights: d.fineWeights, downside: d.downside };
  const cards = state.bundle.cards.map((c) => {
    const s = c.scores;
    const fs = fineScore({ alphaTier: s.alphaQuality.tier, alphaQualityValue: s.alphaQuality.value,
      alphaRisk: s.riskAdjusted.alpha,
      downsideCapture: s.riskAdjusted.downsideCapture, sectorFlowValue: s.sectorFlow.value,
      bandValue: s.bandContribution.value, endorsementValue: s.endorsement.value }, base.weights, base.downside, d.alphaDivisor);
    return { code: c.code, fs };
  }).sort((a, b) => b.fs - a.fs);
  state.baselineRank = new Map(cards.map((c, i) => [c.code, i + 1]));
}

function render() {
  recompute();
  renderTopbar(state, setMode);
  if (state.mode === 'score') {
    document.getElementById('work-score').classList.remove('hidden');
    document.getElementById('work-audit').classList.add('hidden');
    renderScorer(state, onWeightsChange);
    renderRankedList(state, onSelect);
    bindList(state, onSelect);
    renderDetailCard(state);
    bindScorer(state, onWeightsChange);
  } else {
    document.getElementById('work-score').classList.add('hidden');
    document.getElementById('work-audit').classList.remove('hidden');
    renderAudit(state, onSelect);
  }
}

function onWeightsChange() { render(); }
function setMode(m) { state.mode = m; render(); }
function onSelect(code) {
  state.selectedCode = code;
  if (state.mode === 'audit') { state.mode = 'score'; render(); }   // audit row click → flip to score + show detail
  else renderDetailCard(state);
}

init();
