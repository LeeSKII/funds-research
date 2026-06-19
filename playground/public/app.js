// app.js · 前端逻辑：fetch /api/managers + 渲染对比表 + 渲染详情
// 0 依赖，纯原生 JS

const state = {
  managers: [],
  selectedId: null,
  // iter-008 v1.1: 表头点击排序状态
  sortKey: '1y',      // 默认按 1Y 收益排
  sortDir: 'desc'     // 默认降序（大的在前）
};

// ============ Sort Key 映射 ============
// 集中维护 sort key → 取值函数，未来 schema 变化只改这里
// 返回 null 表示该经理无此数据（排到最后）
const SORT_KEYS = {
  name:          m => m.basic?.name || '',
  company:       m => m.basic?.company || '',
  aum:           m => m.basic?.aumNumeric ?? null,        // 数字（亿）
  years:         m => m.basic?.investmentYears ?? null,   // 数字（年）
  sinceInception: m => m.annualReturns?.sinceInception?.manager ?? null,
  '1y':          m => m.riskReturn?.current?.managerReturn ?? null,
  vol:           m => m.riskReturn?.current?.managerVol ?? null,
  sharpe: (() => {
    // Sharpe 现场算：依赖 riskReturn，需要在每条 manager 上重算
    return m => {
      const r = m.riskReturn?.current;
      if (!r?.managerReturn || !r?.managerVol) return null;
      return (r.managerReturn - 3) / r.managerVol;
    };
  })(),
  topSector:     m => m.industryAllocation?.topSector || '',
  styleBias:     m => m.styleBox?.styleBias || ''         // 风格（成长/平衡/价值）
};

// ============ Helpers ============

function fmtPct(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return v.toFixed(digits);
}

function fmtAum(v) {
  if (!v) return '—';
  const m = v.match(/([\d.]+)/);
  return m ? m[1] + '亿' : v;
}

function cls(s) {
  if (s === null || s === undefined || isNaN(s)) return 'muted';
  return s > 0 ? 'positive' : s < 0 ? 'negative' : 'muted';
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ Link Helpers (v1.2 新增) ============
// 经理姓名 → 原始 morningstar 经理页（_meta.source）
function mgrLink(name, source) {
  if (!source) return escapeHtml(name);
  return `<a class="ext-link" href="${escapeHtml(source)}" target="_blank" rel="noopener" title="查看晨星原始页面">${escapeHtml(name)}<span class="link-icon">↗</span></a>`;
}
// 基金名称 → morningstar 基金详情页（/fund/<code>.html）
function fundLink(name, code) {
  if (!code || !/^\d{6}$/.test(code)) return escapeHtml(name);
  const url = `https://www.morningstar.cn/fund/${code}.html`;
  return `<a class="ext-link" href="${url}" target="_blank" rel="noopener" title="查看 ${code} 基金详情">${escapeHtml(name)}<span class="link-icon">↗</span></a>`;
}

// ============ API ============

async function fetchManagers() {
  const container = document.getElementById('compare-table-container');
  // v1.3: skeleton loading state（替代 "加载中…" 文字）
  if (container && !container.querySelector('.skeleton-table')) {
    container.innerHTML = skeletonTableHtml();
  }
  const res = await fetch('/api/managers');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// v1.3: skeleton 占位 HTML（7 行 × 11 列，匹配实际数据形状）
function skeletonTableHtml() {
  const cols = 11;
  const cell = '<td><div class="skeleton-bar"></div></td>';
  const rows = Array.from({ length: 7 }, () => `<tr>${cell.repeat(cols)}</tr>`).join('');
  return `
    <table class="compare-table skeleton-table" aria-busy="true" aria-live="polite">
      <thead>
        <tr>
          <th>#</th>
          <th>经理</th><th>公司</th><th>规模</th><th>年限</th>
          <th>任职以来</th><th>1Y 收益</th><th>1Y 波动</th><th>Sharpe</th>
          <th>行业 Top1</th><th>风格</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ============ Render: Header ============

function renderHeader(data) {
  document.getElementById('manager-count').textContent = data.count;
  const latest = data.managers
    .map(m => m._meta?.scrapedAt)
    .filter(Boolean)
    .sort()
    .reverse()[0];
  if (latest) {
    document.getElementById('data-date').textContent = latest.slice(0, 10);
  }
}

// ============ Render: Compare Table ============

function sortManagers(managers) {
  const key = state.sortKey;
  const dir = state.sortDir === 'asc' ? 1 : -1;  // desc: -1 让大的在前
  const getter = SORT_KEYS[key];
  if (!getter) return managers;
  // 复制后再排序（避免污染 state.managers 顺序）
  return [...managers].sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    // null / undefined 排到最后
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'string' && typeof vb === 'string') {
      return va.localeCompare(vb, 'zh') * dir;
    }
    return (va - vb) * dir;
  });
}

function sortArrow(key) {
  if (state.sortKey !== key) return '<span class="sort-arrow">↕</span>';
  return `<span class="sort-arrow active">${state.sortDir === 'asc' ? '▲' : '▼'}</span>`;
}

function renderCompareTable(managers) {
  const container = document.getElementById('compare-table-container');

  if (!managers || managers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>还没抓任何经理数据</p>
        <p style="margin-top:8px;font-size:12px">
          请先运行：<code>node data/parse-manager.js data/raw/&lt;name&gt;-innertext.json &lt;id&gt; &lt;name&gt;</code>
        </p>
      </div>
    `;
    return;
  }

  const sorted = sortManagers(managers);

  const rows = sorted.map((m, i) => {
    const b = m.basic || {};
    const r = m.riskReturn?.current || {};
    const sharpe = (r.managerReturn && r.managerVol) ? (r.managerReturn - 3) / r.managerVol : null;
    const top1 = m.industryAllocation?.topSector || '—';
    const styleChip = m.styleBox?.styleBias ? `<span class="chip">${escapeHtml(m.styleBox.styleBias)}</span>` : '';
    const sizeChip = m.styleBox?.sizeBias ? `<span class="chip gray">${escapeHtml(m.styleBox.sizeBias)}</span>` : '';
    const isActive = String(m._meta?.managerId) === String(state.selectedId);

    return `
      <tr data-manager-id="${escapeHtml(m._meta?.managerId)}" class="${isActive ? 'active' : ''}">
        <td class="rank">${i + 1}</td>
        <td><strong>${escapeHtml(b.name || '—')}</strong></td>
        <td>${escapeHtml((b.company || '—').replace(/基金管理(有限公司|股份有限公司)$/, ''))}</td>
        <td>${fmtAum(b.aum)}</td>
        <td>${fmtNum(b.investmentYears)}</td>
        <td class="${cls(m.annualReturns?.sinceInception?.excess)}">${fmtPct(m.annualReturns?.sinceInception?.manager)}</td>
        <td class="${cls(r.managerReturn)}">${fmtPct(r.managerReturn)}</td>
        <td>${fmtNum(r.managerVol)}%</td>
        <td class="${sharpe > 3 ? 'positive' : ''}">${fmtNum(sharpe)}</td>
        <td><span class="chip">${escapeHtml(top1)}</span></td>
        <td>${styleChip}${sizeChip}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th class="rank-col">#</th>
          <th data-sort-key="name" class="sortable">经理 ${sortArrow('name')}</th>
          <th data-sort-key="company" class="sortable">公司 ${sortArrow('company')}</th>
          <th data-sort-key="aum" class="sortable">规模 ${sortArrow('aum')}</th>
          <th data-sort-key="years" class="sortable">年限 ${sortArrow('years')}</th>
          <th data-sort-key="sinceInception" class="sortable">任职以来 ${sortArrow('sinceInception')}</th>
          <th data-sort-key="1y" class="sortable">1Y 收益 ${sortArrow('1y')}</th>
          <th data-sort-key="vol" class="sortable">1Y 波动 ${sortArrow('vol')}</th>
          <th data-sort-key="sharpe" class="sortable">Sharpe ${sortArrow('sharpe')}</th>
          <th data-sort-key="topSector" class="sortable">行业 Top1 ${sortArrow('topSector')}</th>
          <th data-sort-key="styleBias" class="sortable">风格 ${sortArrow('styleBias')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // 表头点击 → 排序
  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'desc';  // 新列默认降序
      }
      renderCompareTable(state.managers);
    });
  });

  // 行点击 → 选经理（保留原行为）
  container.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const id = tr.getAttribute('data-manager-id');
      selectManager(id);
    });
  });
}

// ============ Select Manager ============

function selectManager(id) {
  state.selectedId = id;
  const m = state.managers.find(x => String(x._meta?.managerId) === String(id));
  if (!m) return;

  document.querySelectorAll('.compare-table tbody tr').forEach(tr => {
    if (tr.getAttribute('data-manager-id') === id) {
      tr.classList.add('active');
    } else {
      tr.classList.remove('active');
    }
  });

  renderDetail(m);

  const detailSection = document.getElementById('detail-section');
  detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============ Render: Detail (完整 9 个 section) ============

function renderDetail(m) {
  const container = document.getElementById('detail-container');
  const b = m.basic || {};
  const labels = m.labels || {};
  const rr = m.riskReturn?.current || {};
  const ann = m.annualReturns || {};
  const ind = m.industryAllocation || {};
  const sb = m.styleBox || {};
  const topHoldings = m.topHoldings?.quarterly?.holdings || [];
  const holdingPeriods = m.holdingPeriods?.quarterly?.items || [];
  const funds = m.funds || [];

  // Section 1: 基本信息
  const basicHtml = `
    <div class="detail-block">
      <h3>📋 基本信息</h3>
      <div class="detail-meta">
        <div class="item">学历 <strong>${escapeHtml(b.education || '—')}</strong></div>
        <div class="item">投资年限 <strong>${fmtNum(b.investmentYears)} 年</strong></div>
        <div class="item">管理基金 <strong>${b.fundCountCurrent || '—'} 只</strong> (现管) / ${b.fundCountTotal || '—'} (累计)</div>
        <div class="item">资产类型 <strong>${(b.assetType || []).join(' · ') || '—'}</strong></div>
        <div class="item">管理类型 <strong>${(b.managementType || []).join(' · ') || '—'}</strong></div>
      </div>
      ${b.bio ? `<p class="bio" style="margin-top:12px">${escapeHtml(b.bio)}</p>` : ''}
    </div>
  `;

  // Section 2: 业绩标签
  const perfTags = labels.performance || [];
  const perfPos = perfTags.filter(t => t.polarity === true);
  const perfNeg = perfTags.filter(t => t.polarity === false);
  const perfNeu = perfTags.filter(t => t.polarity === null);
  const labelHtml = `
    <div class="detail-block">
      <h3>🏷️ 业绩标签 <span class="muted" style="font-weight:400;font-size:13px">（正 ${perfPos.length} / 负 ${perfNeg.length} / 中 ${perfNeu.length}）</span></h3>
      <div style="margin-bottom:8px"><strong style="font-size:13px">正面：</strong><div class="tag-group">${perfPos.map(t => `<span class="chip pos" title="${escapeHtml(t.timeframe || '')}">${escapeHtml(t.label)}</span>`).join('') || '<span class="muted">无</span>'}</div></div>
      <div style="margin-bottom:8px"><strong style="font-size:13px">负面：</strong><div class="tag-group">${perfNeg.map(t => `<span class="chip neg">${escapeHtml(t.label)}</span>`).join('') || '<span class="muted">无</span>'}</div></div>
      <div style="margin-bottom:8px"><strong style="font-size:13px">中性：</strong><div class="tag-group">${perfNeu.map(t => `<span class="chip neu">${escapeHtml(t.label)}</span>`).join('') || '<span class="muted">无</span>'}</div></div>
      ${(labels.experience || []).length > 0 ? `<div style="margin-top:12px"><strong style="font-size:13px">投资经验：</strong><div class="tag-group">${labels.experience.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div></div>` : ''}
      ${(labels.holdingStyle || []).length > 0 ? `<div style="margin-top:8px"><strong style="font-size:13px">持仓风格：</strong><div class="tag-group">${labels.holdingStyle.map(t => `<span class="chip gray">${escapeHtml(t)}</span>`).join('')}</div></div>` : ''}
      ${(labels.sectorPreference || []).length > 0 ? `<div style="margin-top:8px"><strong style="font-size:13px">行业偏好：</strong><div class="tag-group">${labels.sectorPreference.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div></div>` : ''}
    </div>
  `;

  // Section 3: 风险回报
  const sharpe = (rr.managerReturn && rr.managerVol) ? (rr.managerReturn - 3) / rr.managerVol : null;
  const metricsHtml = `
    <div class="detail-block">
      <h3>📈 风险回报（${escapeHtml(rr.period || '当前')}）</h3>
      <div class="metric-cards">
        <div class="metric-card"><div class="label">经理年化</div><div class="value ${cls(rr.managerReturn)}">${fmtPct(rr.managerReturn)}</div></div>
        <div class="metric-card"><div class="label">基准年化</div><div class="value">${fmtPct(rr.benchmarkReturn)}</div></div>
        <div class="metric-card"><div class="label">超额</div><div class="value ${cls(rr.excessReturn)}">${fmtPct(rr.excessReturn)}</div></div>
        <div class="metric-card"><div class="label">经理波动</div><div class="value">${fmtNum(rr.managerVol)}%</div></div>
        <div class="metric-card"><div class="label">基准波动</div><div class="value">${fmtNum(rr.benchmarkVol)}%</div></div>
        <div class="metric-card"><div class="label">Sharpe</div><div class="value">${fmtNum(sharpe)}</div></div>
        <div class="metric-card"><div class="label">收益排名</div><div class="value">${escapeHtml(rr.returnRank || '—')}</div></div>
        <div class="metric-card"><div class="label">抗风险排名</div><div class="value">${escapeHtml(rr.riskRank || '—')}</div></div>
      </div>
    </div>
  `;

  // Section 4: 历年回报
  const annRows = (ann.returns || []).map(y => `
    <tr>
      <td><strong>${y.year}</strong></td>
      <td class="${cls(y.excess)}">${fmtPct(y.manager)}</td>
      <td>${fmtPct(y.benchmark)}</td>
      <td class="${cls(y.excess)}">${fmtPct(y.excess)}</td>
    </tr>
  `).join('');
  const annualHtml = `
    <div class="detail-block">
      <h3>📊 历年回报 vs ${escapeHtml(ann.benchmark || '基准')}</h3>
      <table>
        <thead><tr><th>年份</th><th>经理</th><th>基准</th><th>超额</th></tr></thead>
        <tbody>${annRows}</tbody>
        ${ann.ytd ? `<tfoot><tr><td><strong>今年</strong></td><td class="${cls(ann.ytd.excess)}">${fmtPct(ann.ytd.manager)}</td><td>${fmtPct(ann.ytd.benchmark)}</td><td class="${cls(ann.ytd.excess)}">${fmtPct(ann.ytd.excess)}</td></tr></tfoot>` : ''}
        ${ann.sinceInception ? `<tfoot><tr style="background:var(--accent-bg)"><td><strong>任职以来</strong></td><td class="${cls(ann.sinceInception.excess)}"><strong>${fmtPct(ann.sinceInception.manager)}</strong></td><td>${fmtPct(ann.sinceInception.benchmark)}</td><td class="${cls(ann.sinceInception.excess)}"><strong>${fmtPct(ann.sinceInception.excess)}</strong></td></tr></tfoot>` : ''}
      </table>
    </div>
  `;

  // Section 5: 行业配置
  const indBars = (ind.current || []).slice(0, 10).map(i => `
    <div class="industry-bar">
      <div class="label">${escapeHtml(i.level3 || i.level2 || i.level1)} <span class="muted" style="font-size:11px">(${escapeHtml(i.level1)})</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(i.pct, 100)}%"></div></div>
      <div class="pct">${fmtNum(i.pct)}%</div>
    </div>
  `).join('');
  const industryHtml = `
    <div class="detail-block">
      <h3>🏭 行业配置 <span class="muted" style="font-weight:400;font-size:13px">（截至 ${escapeHtml(ind.asOf || '—')}，Top1：${escapeHtml(ind.topSector || '—')} ${fmtNum(ind.topSectorPct)}%）</span></h3>
      ${indBars || '<p class="muted">无数据</p>'}
    </div>
  `;

  // Section 6: 风格箱
  const sizeLabels = ['大盘', '中盘', '小盘'];
  const styleLabels3 = ['价值', '平衡', '成长'];
  let styleBoxHtml = '';
  if (sb.cells) {
    const rows = sizeLabels.map(size => `
      <div class="row-label">${escapeHtml(size)}</div>
      ${styleLabels3.map(style => {
        const key = size + style;
        const val = sb.cells[key] || 0;
        const isDominant = (size === sb.sizeBias && style === sb.styleBias);
        return `<div class="cell ${isDominant ? 'dominant' : ''}">${val}%</div>`;
      }).join('')}
    `).join('');
    styleBoxHtml = `
      <div class="style-box-grid">
        <div class="corner"></div>
        <div class="col-label">价值</div>
        <div class="col-label">平衡</div>
        <div class="col-label">成长</div>
        ${rows}
      </div>
      <div class="style-box-summary">主导风格：<strong>${escapeHtml(sb.sizeBias || '—')} ${escapeHtml(sb.styleBias || '—')}</strong></div>
    `;
  }
  const styleBoxBlockHtml = `
    <div class="detail-block">
      <h3>🎯 股票风格箱 <span class="muted" style="font-weight:400;font-size:13px">（截至 ${escapeHtml(sb.asOf || '—')}）</span></h3>
      ${styleBoxHtml || '<p class="muted">无数据</p>'}
    </div>
  `;

  // Section 7: 持仓
  const holdingsRows = topHoldings.map(h => `
    <tr>
      <td>${h.rank}</td>
      <td><strong>${escapeHtml(h.name)}</strong></td>
      <td><code style="font-size:12px">${escapeHtml(h.code)}</code></td>
      <td>${fmtNum(h.weight)}%</td>
      <td>${escapeHtml(h.firstBuy || '—')}</td>
      <td>${fmtNum(h.mktValue)}</td>
      <td class="${h.shareChange > 0 ? 'positive' : h.shareChange < 0 ? 'negative' : ''}">${h.shareChange !== null ? fmtPct(h.shareChange) : '—'}</td>
      <td><span class="chip">${escapeHtml(h.sector)}</span></td>
    </tr>
  `).join('');
  const holdingsHtml = `
    <div class="detail-block">
      <h3>📦 前十大持仓 <span class="muted" style="font-weight:400;font-size:13px">（季度，截至 ${escapeHtml(m.topHoldings?.quarterly?.asOf || '—')}）</span></h3>
      <table>
        <thead><tr><th>#</th><th>名称</th><th>代码</th><th>权重</th><th>首次买入</th><th>市值(亿)</th><th>份额变动</th><th>行业</th></tr></thead>
        <tbody>${holdingsRows || '<tr><td colspan="8" class="muted">无数据</td></tr>'}</tbody>
      </table>
    </div>
  `;

  // Section 8: 持有期
  const periodsRows = holdingPeriods.map(p => `
    <tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${p.quarters} 季度</td>
      <td>${p.mktValue !== null ? fmtNum(p.mktValue) : '—'}</td>
      <td>${escapeHtml(p.currentRank || '—')}</td>
      <td><span class="chip gray">${escapeHtml(p.sector)}</span></td>
    </tr>
  `).join('');
  const periodsHtml = `
    <div class="detail-block">
      <h3>⏳ 重仓股持有期 <span class="muted" style="font-weight:400;font-size:13px">（季度）</span></h3>
      <table>
        <thead><tr><th>名称</th><th>持有季度</th><th>市值(亿)</th><th>当前排名</th><th>行业</th></tr></thead>
        <tbody>${periodsRows || '<tr><td colspan="5" class="muted">无数据</td></tr>'}</tbody>
      </table>
    </div>
  `;

  // Section 9: 基金列表
  const fundsRows = funds.map(f => `
    <tr style="${f.isRepresentative ? 'background:var(--accent-bg)' : ''}">
      <td>${f.isRepresentative ? '<strong>⭐</strong>' : ''}</td>
      <td><strong>${fundLink(f.name, f.code)}</strong></td>
      <td><code style="font-size:12px">${escapeHtml(f.code)}</code></td>
      <td>${f.scale ? fmtNum(f.scaleNumeric) + '亿' : '—'}</td>
      <td>${escapeHtml(f.morningstarCategory || '—')}</td>
      <td>${escapeHtml(f.appointmentDate || '—')}</td>
      <td>${escapeHtml(f.tenureDays || '—')}</td>
      <td class="${cls(f.excessReturn)}">${fmtPct(f.tenureReturn)}</td>
      <td class="${cls(f.excessReturn)}">${fmtPct(f.excessReturn)}</td>
    </tr>
  `).join('');
  const fundsHtml = `
    <div class="detail-block">
      <h3>💼 管理基金列表 <span class="muted" style="font-weight:400;font-size:13px">（⭐ 代表产品）</span></h3>
      <table>
        <thead><tr><th></th><th>名称</th><th>代码</th><th>规模</th><th>晨星分类</th><th>任职日</th><th>在任时长</th><th>任职回报</th><th>超额</th></tr></thead>
        <tbody>${fundsRows || '<tr><td colspan="9" class="muted">无数据</td></tr>'}</tbody>
      </table>
    </div>
  `;

  container.innerHTML = `
    <div class="detail-header">
      <h2>${mgrLink(b.name || '—', m._meta?.source)} · ${escapeHtml((b.company || '—').replace(/基金管理(有限公司|股份有限公司)$/, ''))}</h2>
      <div class="detail-meta">
        <div class="item">学历 <strong>${escapeHtml(b.education || '—')}</strong></div>
        <div class="item">年限 <strong>${fmtNum(b.investmentYears)} 年</strong></div>
        <div class="item">规模 <strong>${fmtAum(b.aum)}</strong></div>
        <div class="item">年化 <strong>${fmtNum(b.annualReturnEquity)}%</strong></div>
      </div>
    </div>
    <div class="detail-body">
      ${basicHtml}
      ${labelHtml}
      ${metricsHtml}
      ${annualHtml}
      ${industryHtml}
      ${styleBoxBlockHtml}
      ${holdingsHtml}
      ${periodsHtml}
      ${fundsHtml}
    </div>
  `;
}

// ============ Theme Toggle（v1.4 新增 · 深浅色切换）============
function setTheme(mode) {
  // mode: 'light' | 'dark'
  if (mode === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try { localStorage.setItem('theme', mode); } catch (e) { /* 隐私模式可能抛错，忽略 */ }
  // 更新按钮 aria-label 与 title（反映"切换到 X 模式"）
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const label = mode === 'dark' ? '切换到浅色模式' : '切换到深色模式';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
}

function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  // 初始化 aria-label（基于当前 data-theme，FOUC 脚本已设置）
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const label = isDark ? '切换到浅色模式' : '切换到深色模式';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  // 点击 → 翻转
  btn.addEventListener('click', () => {
    const currentlyDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(currentlyDark ? 'light' : 'dark');
  });
}
initTheme();

// ============ Init ============

async function init() {
  try {
    const data = await fetchManagers();

    if (data.errors && data.errors.length > 0) {
      const bar = document.createElement('div');
      bar.className = 'warning-bar';
      bar.textContent = `⚠ ${data.errors.length} 个 JSON 加载失败：${data.errors.map(e => e.file).join(', ')}`;
      document.querySelector('.container').insertBefore(bar, document.querySelector('.section'));
    }

    state.managers = data.managers || [];
    renderHeader(data);
    renderCompareTable(state.managers);
  } catch (err) {
    document.getElementById('compare-table-container').innerHTML = `
      <div class="empty-state">
        <p>❌ fetch 失败：${escapeHtml(err.message)}</p>
        <p style="margin-top:8px;font-size:12px">请检查 server 是否运行在 http://localhost:8765</p>
      </div>
    `;
  }
}

init();