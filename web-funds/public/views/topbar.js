// views/topbar.js — renders editorial top bar + mode switch + theme toggle.
// No imports: counts/sectors are inlined; philosophy chips are static.
export function renderTopbar(state, onMode) {
  const b = state.bundle;
  const heat = b.heatmap.sectors.slice(0, 5)
    .map((s) => `<span style="background:var(--primary);opacity:${Math.max(0.08, s.rankNorm)}">${s.sector.slice(0, 1)}</span>`).join('');
  document.getElementById('topbar').innerHTML = `
    <div class="topbar">
      <div class="top-row1">
        <div class="brand">
          <h1>基金评估 · 假设推演</h1>
          <div class="sub">单源 <b>morningstar.cn</b> · ${b.fundCount} 只 · 快照 <b>${b.asOfDate}</b> · 波段判定（非长期赢家）</div>
        </div>
        <div class="top-right">
          <div class="count-pill">服务端 <b>${b.snapshot.count}</b> · 候选 <b>${state.candidateIds.size}</b> · shortlist <b>${b.shortlist.length}</b></div>
          <div class="heat-mini"><div class="lbl">板块资金流向</div><div class="heat-cells">${heat}</div></div>
          <div class="toggle" id="theme-toggle" title="明/暗"></div>
        </div>
      </div>
      <div class="phil">
        <div class="chip"><span class="n">#1-2</span>怀疑·不迷信长期赢家</div>
        <div class="chip"><span class="n">#3</span>确信·阶段性真超额存在</div>
        <div class="chip"><span class="n">#4</span>复利=波段叠加</div>
        <div class="chip"><span class="n">#5</span>识别在炒什么</div>
        <div class="chip gold"><span class="n">#6</span>钱最多=板块景气（非规模）</div>
      </div>
    </div>`;
  document.getElementById('theme-toggle').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('fe-theme', next);
  };
  const ms = document.getElementById('mode-switch');
  ms.innerHTML = ['score', 'audit'].map((m) =>
    `<button class="${state.mode === m ? 'on' : ''}" data-mode="${m}">${m === 'score' ? '推演' : '出局审计'}</button>`).join('');
  ms.querySelectorAll('button').forEach((btn) => { btn.onclick = () => onMode(btn.dataset.mode); });
}
