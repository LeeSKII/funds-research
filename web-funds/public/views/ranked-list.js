// views/ranked-list.js — live-ranked list with search + filter chips + Δ vs baseline.
// Pattern: render all rows ONCE, then filter (chips + query) only toggles `.hidden` on rows.
// This keeps the search input's focus/value across keystrokes (no re-render on typing).
import { computeDelta, tierBadgeClass, fmt, matchesQuery } from '../lib/ui-util.mjs';

const CHIPS = [['true_alpha', '真α'], ['mixed', '混合'], ['beta', '伪α'], ['star5', '5★'], ['large', '大盘成长'], ['size100', '<100亿']];

export function renderRankedList(state, onSelect) {
  const f = state.filterChips;
  const chipsHtml = CHIPS.map(([k, label]) =>
    `<div class="fchip ${f[k] ? 'on' : ''}" data-chip="${k}">${label}</div>`).join('');
  document.getElementById('pane-list').innerHTML = `
    <div class="pane-h">实时排名 <span>${state.ranked.length} 只 · 拖权重即时重排</span></div>
    <input id="list-search" type="search" value="${escapeAttr(state.query || '')}" placeholder="搜索 代码 / 名称" autocomplete="off">
    <div class="filters" id="filter-chips">${chipsHtml}</div>
    <div class="sortbar"><span style="width:50px"># / Δ</span><span style="width:54px">代码</span><span style="flex:1">名称</span><span style="width:46px">分层</span><span style="width:38px;text-align:right">分数</span></div>
    <div class="list" id="list-rows">${state.ranked.map((c) => rowHtml(c, state)).join('')}</div>`;

  // Wire search: typing → applyListFilters (show/hide, NO re-render) → focus preserved.
  const search = document.getElementById('list-search');
  search.oninput = (e) => { state.query = e.target.value; applyListFilters(state); };

  // Wire chips: toggle state + `.on` class + re-filter (no re-render).
  document.getElementById('filter-chips').querySelectorAll('.fchip').forEach((ch) => {
    ch.onclick = () => {
      const k = ch.dataset.chip;
      state.filterChips[k] = !state.filterChips[k];
      ch.classList.toggle('on', state.filterChips[k]);
      applyListFilters(state);
    };
  });

  // Wire row clicks.
  document.querySelectorAll('#list-rows .row').forEach((r) => {
    r.onclick = () => onSelect(r.dataset.code);
  });

  // Apply current filter state (query + chips) to freshly-built rows.
  applyListFilters(state);
}

// Pure chip-filter check (no DOM). Kept in sync with the previous inline `.filter()` logic.
function passesChips(c, f) {
  if (f.true_alpha && c.alphaTier !== 'true_alpha') return false;
  if (f.mixed && c.alphaTier !== 'mixed') return false;
  if (f.beta && c.alphaTier !== 'industry_beta_pseudo' && c.alphaTier !== 'no_brinion') return false;
  if (f.star5 && !((c.ratings?.rating3Y) >= 5)) return false;
  if (f.large && !(c.narrative?.sectorFlowVerdict?.includes('大盘'))) return false;
  if (f.size100 && !(c.aumYi != null && c.aumYi < 100)) return false;
  return true;
}

// Show/hide rows based on chips + query. No re-render → preserves search input focus.
export function applyListFilters(state) {
  const f = state.filterChips;
  const q = state.query;
  document.querySelectorAll('#list-rows .row').forEach((r) => {
    const passes = passesChips(lookupCard(state, r.dataset.code), f) && matchesQuery(r.dataset.code, r.dataset.name, q);
    r.classList.toggle('hidden', !passes);
  });
}

// Rows carry data-code but not the whole card; look up the card object by code from state.ranked.
function lookupCard(state, code) {
  return state.ranked.find((c) => c.code === code) || {};
}

function rowHtml(c, state) {
  const base = state.baselineRank.get(c.code) ?? c.rank;
  const { delta, dir } = computeDelta(base, c.rank);
  const deltaCls = dir === 'up' ? 'up' : dir === 'dn' ? 'dn' : 'flat';
  const deltaTxt = dir === 'flat' ? '—' : (dir === 'up' ? '▲' : '▼') + Math.abs(delta);
  const sel = c.code === state.selectedCode ? 'sel' : '';
  return `<div class="row ${sel}" data-code="${attr(c.code)}" data-name="${attr(c.name)}">
    <div class="rk">${c.rank}</div><div class="delta ${deltaCls}">${deltaTxt}</div>
    <div class="code">${c.code}</div><div class="nm">${esc(c.name)}</div>
    <div class="tier ${tierBadgeClass(c.alphaTier)}">${tierLabel(c.alphaTier)}</div>
    <div class="sf">${fmt(c.fineScore, 'score')}</div></div>`;
}
function tierLabel(t) { return t === 'true_alpha' ? '真α' : t === 'mixed' ? '混合' : t === 'industry_beta_pseudo' ? '伪α' : '—'; }

// Minimal HTML-text/attribute escapers (rows contain user-visible fund names; keep markup safe).
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function attr(s) { return esc(s); }
function escapeAttr(s) { return esc(s); }

export function bindList(state, onSelect) {
  // delegated in renderRankedList via per-row onclick; kept for app.js call-site symmetry + future keyboard nav
}
