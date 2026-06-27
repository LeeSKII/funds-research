// views/scorer.js — slider panel. Reads/writes state.weights (5) + state.advanced.
import { normalizeWeights } from '../lib/ui-util.mjs';

const FINE_KEYS = [
  ['trueAlpha', '真 α 选股'], ['downsideProtection', '下行保护'], ['sectorFlow', '板块流向'],
  ['band', '区间贡献'], ['endorsement', '背书'],
];

export function renderScorer(state) {
  const w = state.weights;
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const sliders = FINE_KEYS.map(([k, label]) => `
    <div class="slider"><div class="lab"><span>${label}</span><b>${w[k].toFixed(2)}</b></div>
      <div class="track"><div class="fill" style="width:${w[k] * 100}%"></div>
        <input type="range" min="0" max="1" step="0.01" value="${w[k]}" data-key="${k}" class="knob-input"
          style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:14px;top:-5px"></div></div>`).join('');
  const a = state.advanced;
  const adv = `
    <details class="adv">
      <summary>高级 · α 子权重 / 阈值 / 背书子权重</summary>
      ${[['alphaSub', 'stockAlphaRatio', 'α·选股占比'], ['alphaSub', 'annualizedAlpha5yNorm', 'α·5y年化'], ['alphaSub', 'tenureNorm', 'α·任期']]
        .map(([grp, k, label]) => sliderHtml(`${grp}.${k}`, label, a[grp][k])).join('')}
      ${sliderHtml('alphaThresholds.trueAlpha', '真α 阈值', a.alphaThresholds.trueAlpha)}
      ${[['endorsementW', 'institutional', '背书·机构'], ['endorsementW', 'insiders', '背书·内部人'], ['endorsementW', 'fof', '背书·FOF'], ['endorsementW', 'ratings', '背书·评级']]
        .map(([grp, k, label]) => sliderHtml(`${grp}.${k}`, label, a[grp][k])).join('')}
      <div class="slider"><div class="lab"><span>下行捕获 floor / ceil</span><b>${state.downside.captureFloor} / ${state.downside.captureCeil}</b></div></div>
      <p style="font-size:10px;color:var(--faint);margin-top:6px">🔴 sectorFlow 内部权重改不了（池依赖，需 Node 重跑）—— spec §5.4</p>
    </details>`;
  document.getElementById('pane-scorer').innerHTML = `
    <div class="pane-h">推演面板 <span class="accent">权重实时</span></div>
    <div class="scorer">
      <div class="wgroup"><div class="gtitle">精排权重 <span class="sum">Σ = ${sum.toFixed(2)}</span></div>${sliders}</div>
      ${adv}
      <button class="reset" id="reset-weights">↺ 恢复默认权重</button>
    </div>`;
}
function sliderHtml(dataKey, label, val) {
  return `<div class="slider"><div class="lab"><span>${label}</span><b>${val.toFixed(2)}</b></div>
    <div class="track"><div class="fill" style="width:${val * 100}%"></div>
      <input type="range" min="0" max="1" step="0.01" value="${val}" data-adv="${dataKey}" class="knob-input"
        style="position:absolute;inset:0;opacity:0;width:100%;height:14px;top:-5px"></div></div>`;
}

export function bindScorer(state, onChange) {
  const root = document.getElementById('pane-scorer');
  // TODO(v1.1): advanced sliders mutate state.advanced but don't yet trigger scoreFundCard recompute
  //   (recompute uses card sub-scores). The 5 fine-weight sliders ARE fully live. See spec §5.1.
  root.querySelectorAll('input[data-key]').forEach((inp) => {
    inp.oninput = () => {
      state.weights = normalizeWeights(state.weights, inp.dataset.key, parseFloat(inp.value));
      onChange();
    };
  });
  root.querySelectorAll('input[data-adv]').forEach((inp) => {
    inp.oninput = () => {
      const [grp, k] = inp.dataset.adv.split('.');
      state.advanced[grp][k] = parseFloat(inp.value);
      onChange();   // v1: re-renders but fineScore uses card sub-scores (no sub-weight effect yet)
    };
  });
  document.getElementById('reset-weights').onclick = () => {
    const d = state.bundle.defaults;
    state.weights = { ...d.fineWeights };
    state.advanced = { alphaSub: { ...d.alphaSub }, alphaThresholds: { ...d.alphaThresholds }, endorsementW: { ...d.endorsementWeights } };
    onChange();
  };
}
