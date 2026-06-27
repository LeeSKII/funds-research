// views/audit.js — 出局审计: funnel waterfall + exclusion table (spec 出局审计视图).
// Pattern: render all rows ONCE, then filter (query) only toggles `.hidden` on tbody rows.
import { screenAll } from '../lib/screening.mjs';
import { gateLabel, fmt, matchesQuery } from '../lib/ui-util.mjs';

export function renderAudit(state, onSelect) {
  const b = state.bundle;
  const { passed, rejected } = screenAll(b.snapshot.rows, b.screenThresholds);
  // USD sibling-resolution map (from the daily resolver log): victim USD share → rescued 人民币 share.
  const victimToRmb = new Map((b.resolutions?.resolved || []).map(r => [r.victimId, r.replacedWithId]));
  const rmbSet = new Set((b.resolutions?.resolved || []).map(r => r.replacedWithId));
  const snapIds = new Set(b.snapshot.rows.map((r) => r.id));
  // trailing = scored dossiers whose code is NOT in the server snapshot (e.g. 012922 C-share —
  // oldestShareId collapsed the fund to its A·USD share 012921, so the C-share isn't in the 394).
  const trailing = b.cards.filter((c) => !snapIds.has(c.code)).map((c) => ({
    id: c.code, name: c.name, gate: 'trailing',
    rating3Y: null, alphaRank: null, sharpeRank: null,
    size: c.sizeRisk?.aumYi, tenure: null, cat: null, hasDossier: !!b.dossiers[c.code],
  }));
  const excluded = [
    ...rejected.map((x) => ({ id: x.row.id, name: x.row.fundName, gate: x.gate,
      rating3Y: x.row.rating3Y, alphaRank: x.row.alphaToIndRankP_3Y, sharpeRank: x.row.sharpeRatioRankP_3Y,
      size: x.row.fundSize, tenure: x.row.longestTenure, cat: x.row.categoryName, hasDossier: !!b.dossiers[x.row.id] })),
    ...trailing,
  ].sort((a, c) => (a.alphaRank ?? 999) - (c.alphaRank ?? 999));   // α排名升序：值小(=top%)在前；尾部档案(null→999)沉底

  const waterfall = [
    ['??', 'universe（未知）'], [b.snapshot.count, '服务端结构筛'], [passed.length, '客户端质量筛'],
    [b.fundCount, '已抓 dossier'], [b.shortlist.length, 'shortlist'],
  ];
  document.getElementById('work-audit').innerHTML = `
    <div class="pane" style="background:var(--surface)">
      <div class="pane-h">出局审计 <span class="accent">漏斗透明化 · ${b.snapshot.count}→${passed.length}→${b.fundCount}→${b.shortlist.length}</span></div>
      <div class="waterfall">${waterfall.map((w, i) =>
        `<div class="step"><b>${w[0]}</b><span>${w[1]}</span></div>${i < waterfall.length - 1 ? '<div class="arrow">→</div>' : ''}`).join('')}</div>
      <input id="audit-search" type="search" value="${escapeAttr(state.auditQuery || '')}" placeholder="搜索 代码 / 名称" autocomplete="off">
      <div style="padding:4px 22px 10px;font-size:11px;color:var(--muted)">出局 ${excluded.length} 只（客户端 ${rejected.length} + 尾部档案 ${trailing.length}），按 α 排名升序——顶部即「α 极高却被出局」的优质标的。点击(有dossier的)查看详情。</div>
      <table class="excl-table" id="excl-table">
        <thead><tr><th>代码·名称</th><th>出局 gate</th><th>评级</th><th>α排名</th><th>夏普排名</th><th>规模</th><th>任期</th><th>类别</th><th>dossier</th></tr></thead>
        <tbody>${excluded.map(e => rowHtml(e, victimToRmb, rmbSet)).join('')}</tbody>
      </table>
    </div>`;

  // Wire search: typing → applyAuditFilter (show/hide, NO re-render) → focus preserved.
  document.getElementById('audit-search').oninput = (e) => {
    state.auditQuery = e.target.value;
    applyAuditFilter(state);
  };

  // audit 行点击 → app.js 的 onSelect 已实现：mode==='audit' 时切到 'score' 并 render 详情卡。
  document.querySelectorAll('#excl-table tbody tr').forEach((tr) => {
    tr.onclick = () => { if (b.dossiers[tr.dataset.id]) { state.selectedCode = tr.dataset.id; onSelect(tr.dataset.id); } };
  });

  // Apply current filter state to freshly-built rows.
  applyAuditFilter(state);
}

// Show/hide tbody rows based on audit query. No re-render → preserves search input focus.
export function applyAuditFilter(state) {
  const q = state.auditQuery;
  document.querySelectorAll('#excl-table tbody tr').forEach((tr) => {
    const passes = matchesQuery(tr.dataset.id, tr.dataset.name, q);
    tr.classList.toggle('hidden', !passes);
  });
}

function rowHtml(e, victimToRmb, rmbSet) {
  const badge = victimToRmb.has(e.id)
    ? `<span class="gate-badge good">✓ 救回→${esc(victimToRmb.get(e.id))}</span>`
    : rmbSet.has(e.id)
      ? `<span class="gate-badge good">✓ 已入池(USD回退)</span>`
      : `<span class="gate-badge">${gateLabel(e.gate)}</span>`;
  return `<tr data-id="${attr(e.id)}" data-name="${attr(e.name)}"><td>${esc(e.id)} ${esc(e.name)}</td><td>${badge}</td>
    <td>${e.rating3Y ?? '—'}</td><td>${e.alphaRank ?? '—'}</td><td>${e.sharpeRank ?? '—'}</td>
    <td>${e.size != null ? fmt(e.size, 'yi') : '—'}</td><td>${e.tenure != null ? e.tenure.toFixed(1) + 'y' : '—'}</td>
    <td>${e.cat ? esc(e.cat) : '—'}</td><td>${e.hasDossier ? '✓' : '—'}</td></tr>`;
}

// Minimal HTML-text/attribute escapers.
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function attr(s) { return esc(s); }
function escapeAttr(s) { return esc(s); }
