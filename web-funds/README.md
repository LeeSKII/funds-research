# Fund Eval Web · 基金评估（假设推演 + 出局审计）

本地、0 依赖的交互式 HTML 应用，把第三步「基金分析」的评分规则做成可调、可质疑、可溯源的可视化工具。

> **哲学锚点**：规则的价值在于**可调、可质疑**（哲学 #1-2 怀疑论）。本页让你亲手拧权重看 317 只排名怎么变（推演），并审计为什么 317→302、有没有错失优质标的（出局审计）。所有结论都是「截至 as-of 的波段判定，**非长期赢家**」。

## 启动

由 Claude 在 background 跑（用户不需要手动起）：

```bash
cd web-funds && node server.js     # → http://localhost:8766
```

预期输出：`📊 fund-eval-web on http://localhost:8766 / bundle: 317 funds, 394 server rows`。

## 两个模式（顶栏切换）

### 推演（默认 · 三栏工作台）
- **左 · 推演面板**：5 个精排权重滑块（真α/下行保护/板块流向/区间贡献/背书，归一化 Σ=1，拖一个其余按比例让位）+ 高级折叠（α 子权重/真α 阈值/背书子权重/下行捕获 floor-ceil）+ 恢复默认。
- **中 · 实时排名**：317 只，拖滑块即时重排，每只显示 Δ（vs 默认权重基线）+ 分层 badge（真α/混合/伪α）。筛选 chips（分层/5★/大盘/<100亿）。
- **右 · 判定卡**：选中基金的 7 维分数条 + 4 句判定 + 风险/捕获 + 年度回报 + 重仓 + 完整报告链接。

### 出局审计
- **漏斗瀑布**：`??(universe) → 394 服务端 → 302 客户端 → 317 已抓 → 20 shortlist`，每层标 gate 集。
- **出局清单**：92 只客户端出局 + 14 尾部档案，每只标出局 gate，**按 α 排名升序**——顶部即「α 极高却被出局」的优质标的。例：012921 易方达全球成长精选(QDII) A(美元现汇) — top-1% α、top-2% 夏普，仅因最老份额是美元份额被 `exclude_usd_shareclass` 整只剔出。

## 数据源（只读，全部来自 funds-research 管线）

| 文件 | 用途 |
|---|---|
| `../research/funds/store/derived/score-<date>.json` | 317 判定卡 + 池级 heatmap + ranked |
| `../research/funds/store/derived/shortlist-<date>.json` | shortlist top-20 + 宽池 |
| `../research/funds/store/snapshots/<date>.json` | 出局审计：394 服务端过关行 |
| `../research/funds/store/changes/<date>.json` | daily diff |
| `../research/funds/core/config/{analysis,thresholds}.json` | 默认权重/阈值 |
| `../data/fund/<code>/*.json` | dossier（详情卡 + 重算输入） |

## 浏览器内重算 + 金标准对齐（核心正确性保证）

- `public/lib/scoring.mjs` 是 `research/funds/analyze/score.js` 的忠实 ESM 移植；`screening.mjs` 是 `analyze/screen.js` 的移植（返回 `{passed,gate}` 而非静默丢弃）。
- `test/parity.test.js` × 2 是**金标准对齐测试**：默认权重下浏览器版必须复现 `score-2026-06-27.json` 的全部子分（容差 0.01）+ `shortlist` fineScore；`screening` 默认门槛过关集必须 == `candidates-2026-06-26.json`（302）。这两道闸保证浏览器算的和你管线算的**完全一致**。
- `npm test` → 21 测试全绿。

> 🔴 **诚实声明**：Node 管线仍用 `score.js`（CommonJS）；`scoring.mjs` 是它的忠实移植，靠对齐测试同步（非共用真理源）。若改了 `score.js`，必须重跑对齐测试。

## 已知 v1 边界

- **高级 α/背书子权重滑块可拖但暂不触发 `scoreFundCard` 重算**——5 个精排权重滑块（headline）完全 live；高级子权重 recompute 是 v1.1 小补丁（`scoreFundCard` 已就绪且对齐测试覆盖）。
- **sectorFlow 内部权重不可调**（池依赖，改它需 Node 重跑 `run-analysis`，spec §5.4）。
- **universe→394 的逐只出局明细未知**（服务端只返回过关者）——v1 出局审计只覆盖 394→302 客户端层 + 尾部 dossier，universe 总数显 `??`。
- **出局审计行点击**：有 dossier 的会切回推演模式显示详情。
- 详见 spec §1.2（v2 待办）。

## 设计 DNA

继承 `web/`（manager app，16 轮迭代）的 editorial 设计语言：Noto Serif SC（标题）+ IBM Plex Sans/Mono（UI/数字），明/暗双主题，CSS 变量化。视觉参考：`docs/superpowers/specs/fund-eval-design-mockup.html`。

## 相关文档

- **Spec**：`docs/superpowers/specs/2026-06-27-fund-eval-page-design.md`
- **Plan**：`docs/superpowers/plans/2026-06-27-fund-eval-page.md`
- **哲学**：`research/funds/docs/investment-philosophy.md`
- **配套待办**：`research/funds/governance/PLAN.md` 的「USD 回退修复」（把 012921 这类救回候选池，独立小任务）
