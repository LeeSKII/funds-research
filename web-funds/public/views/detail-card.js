// views/detail-card.js — selected fund judgment card (推演 + 出局审计 share it).
import { fmt } from '../lib/ui-util.mjs';
import { openReport } from './report.js';

export function renderDetailCard(state) {
  const code = state.selectedCode;
  const raw = state.bundle.cards.find((c) => c.code === code);
  const d = state.bundle.dossiers[code];
  const pane = document.getElementById('pane-detail');
  if (!raw) { pane.innerHTML = '<div class="pane-h">详情</div><div class="detail">选一只基金查看判定卡</div>'; return; }
  const s = raw.scores;
  const flagHtml = raw.flags.map((f) => flagChip(f, 'warn')).join('') + flagChip(`规模 ${raw.sizeRisk.flag === 'ok' ? '✓' : raw.sizeRisk.flag}`, raw.sizeRisk.flag === 'ok' ? 'good' : 'risk');
  const bars = [
    ['α 质量', s.alphaQuality.value, s.alphaQuality.value >= 0.7 ? 'pos' : ''],
    ['区间贡献', s.bandContribution.value, ''],
    ['板块流向', s.sectorFlow.value, ''],
    ['背书', s.endorsement.value, ''],
    ['下行保护', downQ(s.riskAdjusted.downsideCapture, state), 'pos'],
  ].map(barHtml).join('');
  const n = raw.narrative;
  const ann = d?.performance?.annual ? annualBars(d.performance.annual, d.performance.annualPeer) : '';
  const hold = (d?.portfolio?.topHoldings || []).slice(0, 5)
    .map((h) => `<div class="h"><span>${h.name} · ${h.industry}</span><span class="p">${fmt(h.weightPct, 'fixed2')}%</span></div>`).join('');
  const r = d?.risk || {};
  const dd = (r.maxDrawdown?.fund != null ? r.maxDrawdown.fund : r.maxDrawdown);   // polymorphic: {fund,peer} OR scalar
  pane.innerHTML = `
    <div class="pane-h">选中基金 · 判定卡 <span class="accent">${code}</span></div>
    <div class="detail">
      <div class="d-name">${raw.name}</div>
      <div class="d-meta">${code} · ${d?.description?.category || ''} · ${d?.description?.styleBox || ''} · 规模 ${fmt(d?.description?.aumYi, 'yi')} · as-of ${d?.description?.asOfDate || raw.asOfDate}</div>
      <div class="d-flags">${flagHtml}</div>
      <div class="sect"><h4>7 维评分（当前权重下）</h4><div class="bars">${bars}</div></div>
      <div class="sect"><h4>4 句判定</h4><div class="narr">
        <p><span class="nl">押注什么</span><br>${n.whatItBetsOn}</p>
        <p><span class="nl">谁驱动 α</span><br>${n.whoDrivesAlpha}</p>
        <p><span class="nl">板块裁定</span><br>${n.sectorFlowVerdict}</p>
        <p><span class="nl">区间表现</span><br>${n.bandVerdict}</p></div></div>
      <div class="sect"><h4>风险 / 捕获</h4><div class="mini-grid">
        <div class="k">5y α (年化)</div><div class="v pos">${fmt(s.alphaQuality.annualizedAlpha5y, 'fixed2')}</div>
        <div class="k">Sharpe</div><div class="v pos">${fmt(r.sharpe?.fund, 'fixed2')}</div>
        <div class="k">上行捕获</div><div class="v pos">${fmt(r.upsideCapture, 'fixed2')}</div>
        <div class="k">下行捕获</div><div class="v pos">${fmt(r.downsideCapture, 'fixed2')}</div>
        <div class="k">最大回撤</div><div class="v neg">${fmt(dd, 'fixed2')}%</div>
        <div class="k">r² / β</div><div class="v">${fmt(r.rSquared, 'fixed2')} / ${fmt(r.beta, 'fixed2')}</div>
      </div></div>
      ${ann ? `<div class="sect"><h4>年度回报 % (vs 同类)</h4><div class="ann">${ann}</div></div>` : ''}
      ${hold ? `<div class="sect"><h4>前 5 重仓</h4><div class="hold">${hold}</div></div>` : ''}
      <a class="report-link" href="#" data-report-code="${code}">📄 查看完整研究报告 →</a>
    </div>`;
  // Report link opens the rendered-report overlay (not raw-markdown navigation).
  const link = pane.querySelector('.report-link');
  if (link) link.onclick = (e) => { e.preventDefault(); openReport(code); };
}
function downQ(dc, state) {
  if (dc == null) return 0.5; if (dc < 0) return 1;
  const { captureFloor, captureCeil } = state.downside;
  return Math.max(0, Math.min(1, (captureCeil - dc) / (captureCeil - captureFloor)));
}
function barHtml([label, v, cls]) {
  return `<div class="b"><div class="bl"><span>${label}</span><b>${v == null ? '—' : v.toFixed(2)}</b></div><div class="bt"><div class="bf ${cls}" style="width:${(v || 0) * 100}%"></div></div></div>`;
}
function flagChip(txt, cls = 'warn') { return `<div class="flag ${cls}">${txt}</div>`; }
function annualBars(annual, peer) {
  const years = Object.keys(annual);
  const max = Math.max(...years.map((y) => Math.abs(annual[y] || 0)), 1);
  return years.map((y) => {
    const v = annual[y] || 0; const h = Math.abs(v) / max * 100; const neg = v < 0;
    return `<div class="bar ${neg ? 'neg' : ''}" style="height:${h}%"><span class="y">${y.slice(2)}</span></div>`;
  }).join('');
}
