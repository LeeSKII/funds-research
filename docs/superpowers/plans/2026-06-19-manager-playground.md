# Manager Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local HTML playground that visualizes and compares fund manager JSON data from `data/raw/morningstar/`.

**Architecture:** Node.js http server (`server.js`) scans manager JSONs at startup, exposes `/api/managers` endpoint + static files. Vanilla JS frontend (`public/app.js`) fetches data once, renders a comparison table, and supports single-page detail scrolling on row click. Zero third-party dependencies.

**Tech Stack:** Node.js (built-in `http`, `fs`, `path`), Vanilla HTML/CSS/JavaScript, Chrome DevTools MCP for end-to-end verification.

**Project root:** `C:\Lee\Projects\funds-research\playground\`

**Reference spec:** `C:\Lee\Projects\funds-research\docs\superpowers\specs\2026-06-19-manager-playground-design.md`

---

## Task 1: 项目脚手架

**Files:**
- Create: `playground/package.json`
- Create: `playground/README.md`（占位，下个 task 完善）

- [ ] **Step 1.1: 创建 package.json**

文件内容：

```json
{
  "name": "manager-playground",
  "version": "1.0.0",
  "description": "Local HTML playground for visualizing fund manager JSON data",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {}
}
```

- [ ] **Step 1.2: 创建 README.md 占位**

文件内容：

```markdown
# Manager Playground

> 本地 HTML 可视化工具，用于查看和对比基金经理数据。
>
> **状态**：开发中 · iter-007

## 启动

```bash
cd playground
npm start
```

然后访问 http://localhost:8765

详见：[设计文档](../docs/superpowers/specs/2026-06-19-manager-playground-design.md)
```

- [ ] **Step 1.3: 验证文件创建成功**

Run:
```bash
ls -la "C:/Lee/Projects/funds-research/playground/"
```

Expected output 包含 `package.json` 和 `README.md` 两个文件。

---

## Task 2: server.js 基础（静态资源路由）

**Files:**
- Create: `playground/server.js`

- [ ] **Step 2.1: 写最小 Node http 服务**

文件 `playground/server.js` 内容：

```javascript
// server.js — Manager Playground HTTP 服务
// 启动时扫描 ../data/raw/morningstar/*.json，提供 REST API + 静态文件
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, '..', 'data', 'raw', 'morningstar');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// 内存缓存：启动时一次性扫描
let managersCache = [];
let loadErrors = [];

function scanManagers() {
  managersCache = [];
  loadErrors = [];

  if (!fs.existsSync(DATA_DIR)) {
    console.warn(`[warn] Data dir not found: ${DATA_DIR}`);
    return;
  }

  const files = fs.readdirSync(DATA_DIR).filter(f => /^manager-.*\.json$/.test(f));
  for (const file of files) {
    try {
      const filePath = path.join(DATA_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      managersCache.push(data);
    } catch (err) {
      loadErrors.push({ file, error: err.message });
      console.error(`[error] Failed to load ${file}: ${err.message}`);
    }
  }

  // 按年化收益降序排序
  managersCache.sort((a, b) => {
    const aRet = a.basic?.annualReturnEquity ?? -Infinity;
    const bRet = b.basic?.annualReturnEquity ?? -Infinity;
    return bRet - aRet;
  });

  console.log(`[info] Loaded ${managersCache.length} managers from ${DATA_DIR}`);
  if (loadErrors.length > 0) {
    console.warn(`[warn] ${loadErrors.length} file(s) failed to load`);
  }
}

// HTTP 路由处理
const server = http.createServer((req, res) => {
  // CORS（防止跨域问题，未来扩展用）
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: 获取所有经理
  if (url.pathname === '/api/managers') {
    res.setHeader('Content-Type', MIME_TYPES['.json']);
    res.end(JSON.stringify({
      count: managersCache.length,
      errors: loadErrors,
      managers: managersCache
    }));
    return;
  }

  // API: 健康检查
  if (url.pathname === '/api/health') {
    res.setHeader('Content-Type', MIME_TYPES['.json']);
    res.end(JSON.stringify({ status: 'ok', managers: managersCache.length }));
    return;
  }

  // 静态文件
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  // 安全检查：防止路径穿越
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`404 Not Found: ${url.pathname}`);
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.end(data);
  });
});

// 启动
scanManagers();
server.listen(PORT, () => {
  console.log(`\n📊 Manager Playground running on http://localhost:${PORT}`);
  console.log(`   ${managersCache.length} managers loaded`);
  console.log(`   Press Ctrl+C to stop\n`);
});

// 端口占用处理
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[error] Port ${PORT} is already in use.`);
    console.error(`        Kill the process or change PORT in server.js.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
```

- [ ] **Step 2.2: 启动 server 并验证 API**

Run:
```bash
cd "C:/Lee/Projects/funds-research/playground" && node server.js &
sleep 2
curl -s http://localhost:8765/api/health
```

Expected output: `{"status":"ok","managers":3}`（3 位经理）

- [ ] **Step 2.3: 验证 API 返回经理数据**

Run:
```bash
curl -s http://localhost:8765/api/managers | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log('count:', d.count, 'first:', d.managers[0]?._meta.name)"
```

Expected output: `count: 3 first: 郑希`（郑希年化 23.13% 最高，排序第一）

- [ ] **Step 2.4: 验证 404 路径**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/nonexistent.css
```

Expected output: `404`

- [ ] **Step 2.5: 停止 server**

Run:
```bash
# 找到 pid 并 kill
pkill -f "node server.js" || true
sleep 1
```

验证 server 已停：再 curl `/api/health` 应该连不上。

---

## Task 3: index.html 骨架

**Files:**
- Create: `playground/public/index.html`

- [ ] **Step 3.1: 写 HTML 骨架**

文件 `playground/public/index.html` 内容：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manager Playground</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="container">
    <header class="page-header">
      <h1>📊 Manager Playground</h1>
      <p class="subtitle">
        候选池 · <span id="manager-count">0</span> 位在管 ≥10 年公募基金经理
        · 数据截至 <span id="data-date"></span>
      </p>
    </header>

    <!-- 主视图：对比表 -->
    <section class="section">
      <h2 class="section-title">对比表</h2>
      <div id="compare-table-container">
        <div class="loading">加载中...</div>
      </div>
    </section>

    <!-- 二级视图：详情区 -->
    <section class="section" id="detail-section">
      <h2 class="section-title">详情（点击对比表任一行查看）</h2>
      <div id="detail-container">
        <div class="empty-state">请先点击对比表中的任一经理行</div>
      </div>
    </section>
  </div>

  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 3.2: 验证 HTML 可访问**

启动 server（如果还停着）：
```bash
cd "C:/Lee/Projects/funds-research/playground" && node server.js &
sleep 2
```

打开浏览器：
- URL: `http://localhost:8765/`
- 预期：看到 "Manager Playground" 标题 + "加载中..." 字样
- 截图保存：`playground/mockups/check-3.2-empty.png`

- [ ] **Step 3.3: 停止 server**

```bash
pkill -f "node server.js" || true
sleep 1
```

---

## Task 4: style.css 浅色主题

**Files:**
- Create: `playground/public/style.css`

- [ ] **Step 4.1: 写完整 CSS**

文件 `playground/public/style.css` 内容：

```css
/* ============ 主题色板（浅色）============ */
:root {
  --bg: #f8f9fa;
  --surface: #ffffff;
  --text: #1a1d21;
  --text-muted: #6b7280;
  --border: #e5e7eb;
  --accent: #2563eb;
  --accent-bg: #eef2ff;
  --positive: #059669;
  --positive-bg: #d1fae5;
  --negative: #dc2626;
  --negative-bg: #fee2e2;
  --neutral: #6b7280;
  --neutral-bg: #f3f4f6;
}

/* ============ 重置 ============ */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  padding: 24px;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
}

/* ============ 头部 ============ */
.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 4px;
}

.subtitle {
  color: var(--text-muted);
  font-size: 13px;
}

/* ============ 区块标题 ============ */
.section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

/* ============ 表格 ============ */
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

thead { background: #f3f4f6; }

th {
  text-align: left;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

td {
  padding: 14px 16px;
  border-top: 1px solid var(--border);
  font-size: 14px;
  white-space: nowrap;
}

.compare-table tbody tr {
  cursor: pointer;
  transition: background 0.15s;
}

.compare-table tbody tr:hover {
  background: #f9fafb;
}

.compare-table tbody tr.active {
  background: var(--accent-bg);
}

/* ============ Chip ============ */
.chip {
  display: inline-block;
  padding: 2px 8px;
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 12px;
  font-size: 12px;
  margin-right: 4px;
}

.chip.gray { background: var(--neutral-bg); color: var(--text-muted); }

/* ============ 数字颜色 ============ */
.positive { color: var(--positive); font-weight: 600; }
.negative { color: var(--negative); font-weight: 600; }
.muted { color: var(--text-muted); }

.rank { font-weight: 700; color: var(--accent); }

/* ============ 状态条 ============ */
.loading, .empty-state {
  background: var(--surface);
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.warning-bar {
  background: #fef3c7;
  border: 1px solid #fde68a;
  color: #92400e;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 14px;
}

/* ============ 详情区 ============ */
.detail-header {
  background: var(--surface);
  padding: 20px 24px;
  border-radius: 8px 8px 0 0;
  border-bottom: 2px solid var(--accent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.detail-header h2 {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 8px;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  color: var(--text-muted);
  font-size: 13px;
}

.detail-meta .item strong { color: var(--text); font-weight: 600; }

.detail-body {
  background: var(--surface);
  padding: 24px;
  border-radius: 0 0 8px 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  margin-top: -1px;
}

.detail-block {
  padding: 20px 0;
  border-bottom: 1px solid var(--border);
}

.detail-block:last-child { border-bottom: none; }

.detail-block h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text);
}

.detail-block .bio {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
  padding: 12px;
  background: var(--neutral-bg);
  border-radius: 6px;
}

/* 标签分组 */
.tag-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-group .chip.pos { background: var(--positive-bg); color: var(--positive); }
.tag-group .chip.neg { background: var(--negative-bg); color: var(--negative); }
.tag-group .chip.neu { background: var(--neutral-bg); color: var(--neutral); }

/* 业绩卡片 */
.metric-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.metric-card {
  background: var(--neutral-bg);
  padding: 12px 16px;
  border-radius: 6px;
}

.metric-card .label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 4px;
}

.metric-card .value {
  font-size: 18px;
  font-weight: 600;
}

/* 行业条形图 */
.industry-bar {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.industry-bar .label { font-size: 13px; }

.industry-bar .bar-track {
  height: 18px;
  background: var(--neutral-bg);
  border-radius: 4px;
  overflow: hidden;
}

.industry-bar .bar-fill {
  height: 100%;
  background: var(--accent);
}

.industry-bar .pct {
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  min-width: 60px;
}

/* 风格箱 */
.style-box-grid {
  display: grid;
  grid-template-columns: 60px repeat(3, 1fr);
  gap: 4px;
  max-width: 360px;
}

.style-box-grid .corner, .style-box-grid .row-label, .style-box-grid .col-label {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 4px;
}

.style-box-grid .cell {
  padding: 16px 8px;
  text-align: center;
  background: var(--neutral-bg);
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
}

.style-box-grid .cell.dominant {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 700;
}

.style-box-summary {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-muted);
}
```

- [ ] **Step 4.2: 验证样式应用**

启动 server（如停着）：
```bash
cd "C:/Lee/Projects/funds-research/playground" && node server.js &
sleep 2
```

打开浏览器到 `http://localhost:8765/`：
- 预期：看到 "Manager Playground" 标题有图标 + 浅色背景 + 圆角容器 + 灰色边框
- 截图：`playground/mockups/check-4.2-styled.png`

- [ ] **Step 4.3: 停止 server**

```bash
pkill -f "node server.js" || true
sleep 1
```

---

## Task 5: app.js — fetch + 渲染对比表

**Files:**
- Create: `playground/public/app.js`

- [ ] **Step 5.1: 写 app.js 第一版（fetch + 表格）**

文件 `playground/public/app.js` 内容：

```javascript
// app.js — 前端逻辑：fetch /api/managers + 渲染对比表 + 渲染详情
// 0 依赖，纯原生 JS

const state = {
  managers: [],
  selectedId: null
};

// ============ Helpers ============

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined) return '—';
  return v.toFixed(digits);
}

function fmtAum(v) {
  if (!v) return '—';
  // 从 aum 字符串提取数字
  const m = v.match(/([\d.]+)/);
  return m ? m[1] + '亿' : v;
}

function cls(s) {
  if (s === null || s === undefined) return 'muted';
  return s > 0 ? 'positive' : s < 0 ? 'negative' : 'muted';
}

// ============ API ============

async function fetchManagers() {
  const res = await fetch('/api/managers');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============ Render: Header ============

function renderHeader(data) {
  document.getElementById('manager-count').textContent = data.count;
  // 用最近一次抓取的 scrapedAt 作为"数据日期"
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

  const rows = managers.map((m, i) => {
    const b = m.basic || {};
    const r = m.riskReturn?.current || {};
    const sharpe = (r.managerReturn && r.managerVol) ? (r.managerReturn - 3) / r.managerVol : null;
    const top1 = m.industryAllocation?.topSector || '—';
    const styleChip = m.styleBox?.styleBias ? `<span class="chip">${m.styleBox.styleBias}</span>` : '';
    const sizeChip = m.styleBox?.sizeBias ? `<span class="chip gray">${m.styleBox.sizeBias}</span>` : '';
    const isActive = m._meta?.managerId === state.selectedId;

    return `
      <tr data-manager-id="${m._meta?.managerId}" class="${isActive ? 'active' : ''}">
        <td class="rank">${i + 1}</td>
        <td><strong>${b.name || '—'}</strong></td>
        <td>${(b.company || '—').replace(/基金管理(有限公司|股份有限公司)$/, '')}</td>
        <td>${fmtAum(b.aum)}</td>
        <td>${fmtNum(b.investmentYears)}</td>
        <td class="${cls(m.annualReturns?.sinceInception?.excess)}">${fmtPct(m.annualReturns?.sinceInception?.manager)}</td>
        <td class="${cls(r.managerReturn)}">${fmtPct(r.managerReturn)}</td>
        <td>${fmtNum(r.managerVol)}%</td>
        <td class="${sharpe > 3 ? 'positive' : ''}">${fmtNum(sharpe)}</td>
        <td><span class="chip">${top1}</span></td>
        <td>${styleChip}${sizeChip}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>#</th>
          <th>经理</th>
          <th>公司</th>
          <th>规模</th>
          <th>年限</th>
          <th>任职以来</th>
          <th>1Y 收益</th>
          <th>1Y 波动</th>
          <th>Sharpe</th>
          <th>行业 Top1</th>
          <th>风格</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // 绑定点击事件
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

  // 更新表格高亮
  document.querySelectorAll('.compare-table tbody tr').forEach(tr => {
    if (tr.getAttribute('data-manager-id') === id) {
      tr.classList.add('active');
    } else {
      tr.classList.remove('active');
    }
  });

  // 渲染详情
  renderDetail(m);

  // 滚动到详情区
  const detailSection = document.getElementById('detail-section');
  detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============ Render: Detail (placeholder — Task 6 实现) ============

function renderDetail(m) {
  const container = document.getElementById('detail-container');
  container.innerHTML = `
    <div class="detail-header">
      <h2>${m.basic?.name || '—'} · ${(m.basic?.company || '—').replace(/基金管理(有限公司|股份有限公司)$/, '')}</h2>
      <div class="detail-meta">
        <div class="item">学历 <strong>${m.basic?.education || '—'}</strong></div>
        <div class="item">年限 <strong>${fmtNum(m.basic?.investmentYears)} 年</strong></div>
        <div class="item">规模 <strong>${fmtAum(m.basic?.aum)}</strong></div>
        <div class="item">年化 <strong>${fmtNum(m.basic?.annualReturnEquity)}%</strong></div>
      </div>
    </div>
    <div class="detail-body">
      <p class="muted">详情区 9 个 section 将在 Task 6 完整实现</p>
    </div>
  `;
}

// ============ Init ============

async function init() {
  try {
    const data = await fetchManagers();

    // 错误条
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
        <p>❌ fetch 失败：${err.message}</p>
        <p style="margin-top:8px;font-size:12px">请检查 server 是否运行在 http://localhost:8765</p>
      </div>
    `;
  }
}

init();
```

- [ ] **Step 5.2: 验证对比表渲染**

启动 server：
```bash
cd "C:/Lee/Projects/funds-research/playground" && node server.js &
sleep 2
```

打开浏览器 `http://localhost:8765/`：
- 预期：
  - 标题 "📊 Manager Playground"
  - 副标题显示 "3 位"
  - 对比表有 3 行（郑希/武阳/刘元海，按年化降序：23.13% > 20.94% > 17.76% → 郑希第一）
  - 每行有 11 列
  - 正超额绿、负超额红
  - 鼠标悬停行 → 浅灰背景
- 截图：`playground/mockups/check-5.2-table.png`

- [ ] **Step 5.3: 验证点击行（详情 placeholder + 滚动）**

点击对比表中的任一行：
- 预期：
  - 该行高亮（蓝色背景）
  - 页面滚动到详情区
  - 详情区显示经理名 + 公司 + 学历 + 年限 + 规模 + 年化
  - 显示 "详情区 9 个 section 将在 Task 6 完整实现"
- 截图：`playground/mockups/check-5.3-click.png`

- [ ] **Step 5.4: 停止 server**

```bash
pkill -f "node server.js" || true
sleep 1
```

---

## Task 6: app.js — 详情区 9 个 section

**Files:**
- Modify: `playground/public/app.js`（替换 `renderDetail` 函数）

- [ ] **Step 6.1: 替换 renderDetail 为完整版**

打开 `playground/public/app.js`，找到 `renderDetail` 函数，**完全替换**为：

```javascript
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
        <div class="item">学历 <strong>${b.education || '—'}</strong></div>
        <div class="item">投资年限 <strong>${fmtNum(b.investmentYears)} 年</strong></div>
        <div class="item">管理基金 <strong>${b.fundCountCurrent || '—'} 只</strong> (现管) / ${b.fundCountTotal || '—'} (累计)</div>
        <div class="item">资产类型 <strong>${(b.assetType || []).join(' · ') || '—'}</strong></div>
        <div class="item">管理类型 <strong>${(b.managementType || []).join(' · ') || '—'}</strong></div>
      </div>
      ${b.bio ? `<p class="bio" style="margin-top:12px">${b.bio}</p>` : ''}
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
      <div style="margin-bottom:8px"><strong style="font-size:13px">正面：</strong><div class="tag-group">${perfPos.map(t => `<span class="chip pos" title="${t.timeframe || ''}">${t.label}</span>`).join('') || '<span class="muted">无</span>'}</div></div>
      <div style="margin-bottom:8px"><strong style="font-size:13px">负面：</strong><div class="tag-group">${perfNeg.map(t => `<span class="chip neg">${t.label}</span>`).join('') || '<span class="muted">无</span>'}</div></div>
      <div style="margin-bottom:8px"><strong style="font-size:13px">中性：</strong><div class="tag-group">${perfNeu.map(t => `<span class="chip neu">${t.label}</span>`).join('') || '<span class="muted">无</span>'}</div></div>
      ${(labels.experience || []).length > 0 ? `<div style="margin-top:12px"><strong style="font-size:13px">投资经验：</strong><div class="tag-group">${labels.experience.map(t => `<span class="chip">${t}</span>`).join('')}</div></div>` : ''}
      ${(labels.holdingStyle || []).length > 0 ? `<div style="margin-top:8px"><strong style="font-size:13px">持仓风格：</strong><div class="tag-group">${labels.holdingStyle.map(t => `<span class="chip gray">${t}</span>`).join('')}</div></div>` : ''}
      ${(labels.sectorPreference || []).length > 0 ? `<div style="margin-top:8px"><strong style="font-size:13px">行业偏好：</strong><div class="tag-group">${labels.sectorPreference.map(t => `<span class="chip">${t}</span>`).join('')}</div></div>` : ''}
    </div>
  `;

  // Section 3: 风险回报
  const sharpe = (rr.managerReturn && rr.managerVol) ? (rr.managerReturn - 3) / rr.managerVol : null;
  const metricsHtml = `
    <div class="detail-block">
      <h3>📈 风险回报（${rr.period || '当前'}）</h3>
      <div class="metric-cards">
        <div class="metric-card"><div class="label">经理年化</div><div class="value ${cls(rr.managerReturn)}">${fmtPct(rr.managerReturn)}</div></div>
        <div class="metric-card"><div class="label">基准年化</div><div class="value">${fmtPct(rr.benchmarkReturn)}</div></div>
        <div class="metric-card"><div class="label">超额</div><div class="value ${cls(rr.excessReturn)}">${fmtPct(rr.excessReturn)}</div></div>
        <div class="metric-card"><div class="label">经理波动</div><div class="value">${fmtNum(rr.managerVol)}%</div></div>
        <div class="metric-card"><div class="label">基准波动</div><div class="value">${fmtNum(rr.benchmarkVol)}%</div></div>
        <div class="metric-card"><div class="label">Sharpe</div><div class="value">${fmtNum(sharpe)}</div></div>
        <div class="metric-card"><div class="label">收益排名</div><div class="value">${rr.returnRank || '—'}</div></div>
        <div class="metric-card"><div class="label">抗风险排名</div><div class="value">${rr.riskRank || '—'}</div></div>
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
      <h3>📊 历年回报 vs ${ann.benchmark || '基准'}</h3>
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
      <div class="label">${i.level3 || i.level2 || i.level1} <span class="muted" style="font-size:11px">(${i.level1})</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(i.pct, 100)}%"></div></div>
      <div class="pct">${fmtNum(i.pct)}%</div>
    </div>
  `).join('');
  const industryHtml = `
    <div class="detail-block">
      <h3>🏭 行业配置 <span class="muted" style="font-weight:400;font-size:13px">（截至 ${ind.asOf || '—'}，Top1：${ind.topSector || '—'} ${fmtNum(ind.topSectorPct)}%）</span></h3>
      ${indBars || '<p class="muted">无数据</p>'}
    </div>
  `;

  // Section 6: 风格箱
  const sizeLabels = ['大盘', '中盘', '小盘'];
  const styleLabels3 = ['价值', '平衡', '成长'];
  let styleBoxHtml = '';
  if (sb.cells) {
    const rows = sizeLabels.map(size => `
      <div class="row-label">${size}</div>
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
      <div class="style-box-summary">主导风格：<strong>${sb.sizeBias || '—'} ${sb.styleBias || '—'}</strong></div>
    `;
  }
  const styleBoxBlockHtml = `
    <div class="detail-block">
      <h3>🎯 股票风格箱 <span class="muted" style="font-weight:400;font-size:13px">（截至 ${sb.asOf || '—'}）</span></h3>
      ${styleBoxHtml || '<p class="muted">无数据</p>'}
    </div>
  `;

  // Section 7: 持仓
  const holdingsRows = topHoldings.map(h => `
    <tr>
      <td>${h.rank}</td>
      <td><strong>${h.name}</strong></td>
      <td><code style="font-size:12px">${h.code}</code></td>
      <td>${fmtNum(h.weight)}%</td>
      <td>${h.firstBuy || '—'}</td>
      <td>${fmtNum(h.mktValue)}</td>
      <td class="${h.shareChange > 0 ? 'positive' : h.shareChange < 0 ? 'negative' : ''}">${h.shareChange !== null ? fmtPct(h.shareChange) : '—'}</td>
      <td><span class="chip">${h.sector}</span></td>
    </tr>
  `).join('');
  const holdingsHtml = `
    <div class="detail-block">
      <h3>📦 前十大持仓 <span class="muted" style="font-weight:400;font-size:13px">（季度，截至 ${m.topHoldings?.quarterly?.asOf || '—'}）</span></h3>
      <table>
        <thead><tr><th>#</th><th>名称</th><th>代码</th><th>权重</th><th>首次买入</th><th>市值(亿)</th><th>份额变动</th><th>行业</th></tr></thead>
        <tbody>${holdingsRows || '<tr><td colspan="8" class="muted">无数据</td></tr>'}</tbody>
      </table>
    </div>
  `;

  // Section 8: 持有期
  const periodsRows = holdingPeriods.map(p => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td>${p.quarters} 季度</td>
      <td>${p.mktValue !== null ? fmtNum(p.mktValue) : '—'}</td>
      <td>${p.currentRank || '—'}</td>
      <td><span class="chip gray">${p.sector}</span></td>
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
      <td><strong>${f.name}</strong></td>
      <td><code style="font-size:12px">${f.code}</code></td>
      <td>${f.scale ? fmtNum(f.scaleNumeric) + '亿' : '—'}</td>
      <td>${f.morningstarCategory || '—'}</td>
      <td>${f.appointmentDate || '—'}</td>
      <td>${f.tenureDays || '—'}</td>
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
      <h2>${b.name || '—'} · ${(b.company || '—').replace(/基金管理(有限公司|股份有限公司)$/, '')}</h2>
      <div class="detail-meta">
        <div class="item">学历 <strong>${b.education || '—'}</strong></div>
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
```

- [ ] **Step 6.2: 验证详情区渲染**

启动 server：
```bash
cd "C:/Lee/Projects/funds-research/playground" && node server.js &
sleep 2
```

浏览器 `http://localhost:8765/` → 点击郑希：
- 预期：详情区滚动 + 9 个 section 全部渲染：
  1. 基本信息（含 bio 全文）
  2. 业绩标签（正/负/中分组 + 经验/风格/行业标签）
  3. 风险回报（8 个 metric card）
  4. 历年回报（10 年 + 今年 + 任职以来）
  5. 行业配置（条形图）
  6. 风格箱（3x3 网格，主导风格高亮）
  7. 持仓（10 行表格）
  8. 持有期（10 行表格）
  9. 基金列表（9 行，代表产品高亮）

- 截图：`playground/mockups/check-6.2-detail-zhengxi.png`

- [ ] **Step 6.3: 验证另外两位经理**

分别点击武阳、刘元海：
- 预期：详情区切换内容（不滚动，因为已在详情区）
- 武阳 bio 只有 66 字符（短），应有兜底显示
- 刘元海 bio 183 字符，含"管理学博士"

- 截图：
  - `playground/mockups/check-6.3-detail-wuyang.png`
  - `playground/mockups/check-6.3-detail-liuyuanhai.png`

- [ ] **Step 6.4: 停止 server**

```bash
pkill -f "node server.js" || true
sleep 1
```

---

## Task 7: README + 端到端验证

**Files:**
- Modify: `playground/README.md`（替换占位为完整版）

- [ ] **Step 7.1: 写完整 README**

打开 `playground/README.md`，**完全替换**为：

```markdown
# Manager Playground

> 本地 HTML 可视化工具，用于查看和对比基金经理数据。
> 数据源：`../data/raw/morningstar/manager-*.json`（funds-research v1.5 schema）。

## 🚀 启动

```bash
cd playground
npm start
```

预期输出：
```
📊 Manager Playground running on http://localhost:8765
   3 managers loaded
   Press Ctrl+C to stop
```

然后浏览器打开 [http://localhost:8765](http://localhost:8765)

## 📂 文件结构

```
playground/
├── server.js         # Node http 服务（~140 行）
├── public/
│   ├── index.html    # 主页面
│   ├── style.css     # 浅色主题
│   └── app.js        # 前端逻辑
├── package.json
└── README.md
```

## ➕ 添加新经理

1. 用 chrome-devtools 抓经理页面（参见 `data/EXTRACT-MANAGER-GUIDE.md`）
2. 用 `parse-manager.js` 生成 JSON：
   ```bash
   node data/parse-manager.js data/raw/<name>-innertext.json <id> <name>
   ```
3. **重启 server**（v1 不支持热加载）
4. 刷新浏览器，新经理自动出现在对比表

## 🎨 主题色板

- 背景：`#f8f9fa`
- 表面：`#ffffff`
- 文字：`#1a1d21`
- 主色：`#2563eb`（链接/排名）
- 正超额：`#059669`
- 负超额：`#dc2626`

## 🔧 技术栈

- Node.js ≥ 18（仅用内置 `http`/`fs`/`path`）
- 0 第三方依赖（vanilla JS + 原生 fetch + 原生 DOM）
- Chrome DevTools MCP 验证

## 📚 相关文档

- 设计文档：`docs/superpowers/specs/2026-06-19-manager-playground-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-19-manager-playground.md`
- 数据 schema：`data/manager-schema.json`
- 数据采集 SOP：`data/EXTRACT-MANAGER-GUIDE.md`

## 🐛 故障排查

| 问题 | 原因 | 解决 |
|---|---|---|
| 端口 8765 占用 | 其他进程占用了 | 杀掉进程或修改 `PORT` 常量 |
| fetch 失败 | server 没启动 | `npm start` 重启 |
| 表格空 | 没有 manager JSON | 跑 `parse-manager.js` |
| 单经理字段缺失 | 该 JSON 字段未填 | 查原始 innertext，必要时手动补充 |
```

- [ ] **Step 7.2: 端到端验证**

完整启动 + 操作流程：

```bash
# 1. 启动 server
cd "C:/Lee/Projects/funds-research/playground" && node server.js &
sleep 2

# 2. 验证 health
curl -s http://localhost:8765/api/health
# Expected: {"status":"ok","managers":3}

# 3. 验证主页面 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/
# Expected: 200

# 4. 验证 CSS 加载
curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/style.css
# Expected: 200

# 5. 验证 JS 加载
curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/app.js
# Expected: 200

# 6. 验证 API 返回 3 位经理
curl -s http://localhost:8765/api/managers | node -e "
const d = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log('count:', d.count, 'errors:', d.errors.length);
console.log('sorted by annualReturnEquity:', d.managers.map(m => m.basic.name + '(' + m.basic.annualReturnEquity + '%)').join(' > '));
"
# Expected: count: 3 errors: 0 / sorted by annualReturnEquity: 郑希(23.13%) > 刘元海(20.94%) > 武阳(17.76%)
```

- [ ] **Step 7.3: 浏览器端到端测试（手动）**

打开浏览器 `http://localhost:8765/`：
- [ ] 看到标题"Manager Playground"
- [ ] 看到对比表，3 行
- [ ] 第 1 行是郑希（年化 23.13% 最高）
- [ ] 第 3 行是武阳（年化 17.76% 最低）
- [ ] 鼠标悬停行 → 浅灰背景
- [ ] 点击郑希 → 详情区滚动 + 9 个 section
- [ ] 业绩标签分组显示（正/负/中）
- [ ] 历年回报表格有 10 年
- [ ] 行业配置有条形图
- [ ] 风格箱有 3x3 网格
- [ ] 持仓表 10 行
- [ ] 基金列表 9 行，代表产品高亮（蓝色背景）
- [ ] 点击武阳 → 详情切换（应显示在原位置，不重复滚动）
- [ ] 点击刘元海 → 详情切换
- [ ] 切回郑希 → 仍能正常显示

- 截图保存：
  - `playground/mockups/final-overview.png`
  - `playground/mockups/final-detail.png`

- [ ] **Step 7.4: 停止 server**

```bash
pkill -f "node server.js" || true
sleep 1
echo "[done] playground 完整功能验证通过"
```

---

## 验收清单（整体）

完成所有 Task 后，确认：

- [ ] `playground/` 目录有 6 个文件：`server.js`, `public/index.html`, `public/style.css`, `public/app.js`, `package.json`, `README.md`
- [ ] `node server.js` 一键启动
- [ ] `http://localhost:8765/` 显示 3 位经理对比表
- [ ] 表格按年化收益降序（郑希 > 刘元海 > 武阳）
- [ ] 点击任一行 → 详情区滚动 + 渲染 9 个 section
- [ ] 详情区包含：基本/业绩标签/风险回报/历年回报/行业/风格/持仓/持有期/基金
- [ ] 颜色编码：正超额绿、负超额红
- [ ] 字段缺失显示 "—" 而非崩溃
- [ ] 0 第三方依赖
- [ ] README 完整（启动/添加新经理/故障排查）

---

## 后续迭代（v1.1+）

按 spec §8：

- **v1.1**：顶部筛选（公司/行业偏好/Sharpe 阈值）+ 持仓排序 + 子区间超额矩阵
- **v1.5**：URL hash 路由 + 深色主题切换
- **v2.0**：JSON diff + 持仓交集/差集分析