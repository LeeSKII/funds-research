# 基金评估 · 假设推演 HTML 页面 设计 (v1)

> **哲学溯源**：本设计是 [`research/funds/docs/investment-philosophy.md`](../../research/funds/docs/investment-philosophy.md) 的**可视化操作化**。
> v1 范围（用户 2026-06-27 brainstorming 拍板）：**Level C「假设推演器」**——A(只读查看) + B(筛选/排序/对比) + **C(权重/阈值实时调 → 全池即时重排)**。骨架 = **骨架1 左右分栏工作台** + **editorial 顶栏**（哲学锚点 + 板块 heatmap 缩略 + 明暗切换）+ **紧凑工具工作区**。
>
> 🔴 **核心价值**：规则的价值在于**可调、可质疑、可溯源**（哲学 #1-2 怀疑论）。页面把第三步的 7 维评分规则本身做成可拖控件，让用户亲手拧权重看 317 只排名怎么变——这是「直观查看评估结果」的最强形式。
>
> 🔴 **否定式边界**：所有排名/分数都是「截至 `asOfDate` 的波段判定」，**非长期赢家**（哲学 #1-2）。页面须始终显示该边界。

**目标**：把 `score-*.json`（317 判定卡 + 池级 heatmap）+ `data/fund/*/` dossier + `analysis.json`（可调参数）渲染成一个**本地、离线、0 依赖**的交互页面，评分规则可在浏览器内实时重算。

---

## 1. 范围

### 1.1 In scope（v1）

- **顶栏（editorial chrome）**：Serif 标题 + 单源/as-of 标注 + 池计数 + 板块 heatmap 缩略 + 明暗切换 + 哲学 6 条锚点 chips。
- **左 · 推演面板**：5 精排权重滑块（Σ=1 归一化）+ 高级折叠（α 3 子权重 / 真α 阈值 / 背书 4 子权重 / 下行捕获 floor-ceil）+ 恢复默认。
- **中 · 实时排名列表**：317 行，筛选（分层/评级/规模/风格/板块）+ 排序 + Δ 排名箭头（vs 默认权重）。
- **右 · 选中基金判定卡**：7 维分数条 + 4 句判定 + 风险/捕获 + 年度回报条 + 重仓 + 「完整报告」链接。
- **顶栏模式切换**：「推演」(默认) ↔ 「出局审计」(漏斗透明化，见专节)。
- **「出局审计」视图**：漏斗瀑布(394→302→317→20) + 出局清单(每只标出局 gate + 指标，按 α 降序找优质标的)——回答 317→302，不漏优质标的（012921/012922 即因此类排查坐实）。
- **浏览器内 scoreFund 移植**：纯函数 ESM，实时重算 fine 分并重排。
- **金标准对齐测试**：默认权重复现 `score-2026-06-27.json` 全部分数（容差 0.01）。
- **明/暗主题**（顶栏切换，`prefers-color-scheme` 默认）。

### 1.2 Out of scope（v1，推后）

- **多选对比视图**（选 2-3 只并排）：v2。v1 详情卡单只。
- **导出**（导出当前权重下的排名 / 报告 PDF）：v2。
- **sectorFlow 内部权重（prosperityAlignment/liquidity 比）可调**：会触发**池级 heatmap 重算**（全池聚合），v1 不做浏览器内重算，`sectorFlowValue` 取预计算卡值；高级面板标注「改此项需 Node 重跑」。见 §5.4。
- **watchlist 纵向追踪**（`core/watchlist.js`）集成：v2。
- **live 数据刷新**（接 daily loop）：v1 只读快照；刷新靠重跑 Node 管线。
- **Markdown 报告页内渲染**：v1「完整报告」链接指向已生成的 `.md`（server 直出文本）；交互式报告渲染推后。
- **服务端结构筛的逐只出局明细**（universe→394 被 `search_filter` 杀掉的）：v2。服务端只返回过关者，无逐只数据；逐只需要 screener explain-mode 或逐只查询（外发）。v1 出局审计只覆盖 394→302 客户端层 + 尾部 dossier，universe 总数显 `??` 占位。

---

## 2. 信息架构（骨架1 + editorial 顶栏）

```
┌────────────────────────── 顶栏 (editorial chrome) ──────────────────────────┐
│ 基金评估·假设推演   单源 morningstar · 317只 · as-of 2026-06-27 · 波段判定  │
│ [池317 · shortlist20]  [板块heatmap缩略]  [☀/🌙]                            │
│ #1-2怀疑  #3确信  #4复利  #5识别  #6钱最多=板块景气  ← 哲学锚点 chips       │
├──────────────┬───────────────────────────────┬──────────────────────────────┤
│ 推演面板      │ 实时排名列表                   │ 选中基金 · 判定卡            │
│ (248px)      │ (flex)                         │ (360px)                      │
│              │                               │                              │
│ 5 精排权重    │ [筛选 chips] [排序列头]        │ 名称 · 代码 · 风格 · 规模    │
│  · 真α .40   │ 1 ▲2 006502 财通集成电路 真α .83│ flags: true_alpha/low_fit/ok │
│  · 下行 .25  │ 2  —  720001 财通价值动量 真α .82│ ── 7 维分数条 ──            │
│  · 板块 .15  │ 3 ▲1 017102 大摩数字经济  真α .81│ ── 4 句判定 ──              │
│  · 区间 .10  │ ...                           │ ── 风险/捕获 grid ──         │
│  · 背书 .10  │                               │ ── 年度回报条 (vs 同类) ──   │
│ [高级 ▾]     │                               │ ── 前5重仓 ──               │
│  α子权重/阈值 │                               │ [📄 完整研究报告 →]          │
│  捕获floor/ceil│                              │                              │
│ [↺ 恢复默认] │                               │                              │
└──────────────┴───────────────────────────────┴──────────────────────────────┘
```

三栏等高填满视口（`grid-template-columns: 248px 1fr 360px`），各自独立滚动。推演面板始终可见——这是 C 的核心（调权重同时看排名+详情）。

---

## 3. 数据源 & 字段映射

server 启动一次性读下列文件，打成一个 `/api/bundle` JSON 给前端（全在内存，~5MB，localhost 可接受）：

| 来源文件 | 用途 | 关键字段 |
|---|---|---|
| `research/funds/store/derived/score-<latest>.json` | 池概览 + 每卡默认分 + 池级 heatmap + 默认排名 | `date`·`fundCount`·`sectorFlowHeatmap.sectors[]`·`cards[]`·`ranked.{bySectorFlow,byAlphaQuality,byBandContribution}` |
| `research/funds/store/derived/shortlist-<latest>.json` | shortlist top-20（详情区默认聚焦）+ 宽池顺序 | `stage1.widePool[]`·`shortlist[]`·`ranked.byFineScore` |
| `research/funds/core/config/analysis.json` | **默认权重/阈值**（滑块初值 + 恢复默认） | `shortlist.fine.weights`·`shortlist.fine.downside`·`alphaQuality.{weights,tierThresholds}` |
| `research/funds/core/config/thresholds.json` | **出局审计**：客户端筛选门槛（screening.mjs 用） | `rating3Y_min`·`longestTenure_min_years`·`fundSize_{min,max}_yi`·`alphaToIndRankP_3Y_max`·`sharpeRatioRankP_3Y_max`·`exclude_usd_shareclass` |
| `research/funds/store/snapshots/<latest>.json` | **出局审计**：394 服务端过关行（每行 25 字段） | `count`·`rows[]{id,rating3Y,rating5Y,alphaToIndRankP_3Y,sharpeRatioRankP_3Y,fundSize,longestTenure,fundName,categoryName,broadCategoryNameCN,...}` |
| `research/funds/store/changes/<latest>.json` | **出局审计**：daily diff（新增/移除/经理变更） | `events[]{code,fundName,type,field,before,after}` |
| `research/funds/analyze/screen.js` | **出局审计**：出局 gate 判定逻辑（移植成 `screening.mjs`） | gates: rating3Y/longestTenure/fundSize-floor/alpha3Y-rank/sharpe3Y-rank/rating5Y/size-cap/USD |
| `data/fund/<code>/fund-<code>-<latest>.json` ×317 | 详情卡 + 浏览器内 scoreFund 重算的输入 | 见下 |

### 3.1 score card 字段（每只，`score-*.json.cards[]`）

```
code, name, asOfDate, bandWindowLabel,
sizeRisk{aumYi, flag},                              // ok / capacity_erosion / liquidation_risk / unknown
scores{
  alphaQuality{value, stockAlphaShare, tier, annualizedAlpha5y, tenureNorm, identityCheckOk},
  endorsement{value, institutional, insiders, fofHeld, ratings, flags},
  bandContribution{value, annualExcess[], consistencyRatio, bear2022Excess, effectiveBandDensity},
  sectorFlow{value, prosperityAlignment, liquidity{styleBoxTier}},   // 🔴 sectorFlow.value 取预计算，v1 不浏览器重算
  theme{topSectorBets[], holdingsCluster[], styleBox, benchmarkVsActual},
  riskAdjusted{alpha, infoRatio, rSquared, beta, upsideCapture, downsideCapture, asymmetry, captureFlag, flags}
},
flags[], narrative{whatItBetsOn, whoDrivesAlpha, sectorFlowVerdict, bandVerdict},
provenance{dossierFile, dossierDate, scriptVersion, computedAt}
```

> 🔴 `cards[]` 不含 `downsideQuality`（那是 shortlist 的派生），但含 `riskAdjusted.downsideCapture`——浏览器内用 `downsideCapture + floor/ceil` 实时算 `downsideQuality`（见 §5.2）。

### 3.2 dossier 字段（详情卡 + α/下行重算输入）

详情卡渲染：`description`(code/name/category/styleBox/aumYi/nav/asOfDate) · `performance.{trailing,annual,annualPeer,ratings,attribution}` · `risk.{sharpe,alpha,beta,rSquared,upsideCapture,downsideCapture,maxDrawdown}` · `portfolio.{topHoldings,sectorAllocation,assetAllocation}` · `manager.{team,maxTenureYears,lead}` · `strategy.{objective,benchmark,latestCommentary,outlook}`。

α 重算输入：`performance.attribution.{stockSelection,excess,real,_identityCheck}` · `risk.alpha` · `manager.maxTenureYears`。
下行重算输入：`risk.downsideCapture`。
背书重算输入：`holders.{institutional,insiders,fofHeld}` · `performance.ratings`。
波段重算输入：`performance.{annual,annualPeer}`。

---

## 4. 视觉设计（继承 `web/` editorial DNA）

| 项 | 值 |
|---|---|
| 标题字体 | Noto Serif SC（700）|
| 正文/UI | IBM Plex Sans（400/500/600/700）|
| 数字 | IBM Plex Mono（tabular-nums）—— 所有分数/百分比/排名 |
| 浅色 | bg `#f8f9fa` · surface `#fff` · text `#1a1d21` · line `#e8eaed` |
| 主色 | `#2563eb`（链接/排名/选中/滑块）|
| 正超额/好 | `#059669`（绿）|
| 负超额/风险 | `#dc2626`（红）|
| 警告 | `#b45309`（橙，混合/低拟合）|
| 暗色 | 镜像一套（bg `#0f1419` · surface `#1a1d21` · text `#e8eaed` · 主色提亮到 `#60a5fa`）|
| 分层 badge 色 | 真α=绿 · 混合=橙 · 伪α=红 · no_brinion=灰 |

设计 token 用 CSS 变量（`:root` + `[data-theme="dark"]`），便于明暗切换。线框见 `.superpowers/brainstorm/.../content/design-mockup.html`（已过审）。

---

## 5. 推演模型（核心 · 浏览器内重算）

### 5.1 哪些子分浏览器可重算（per-fund 纯函数 → 可 live；池依赖 → 冻结）

| 子分 | 重算输入 | per-fund 纯？ | v1 接控件？ |
|---|---|---|---|
| `alphaQuality` | attribution/risk.alpha/tenure | ✅ | ✅ live（α 3 子权重 + 真α 阈值）|
| `endorsement` | holders/ratings | ✅ | ✅ live（背书 4 子权重）|
| `downsideQuality` | downsideCapture + floor/ceil | ✅ | ✅ live（捕获 floor/ceil）|
| `bandContribution` | annual/annualPeer | ✅ | ❌ v1 取卡值（无子权重可调：value=consistencyRatio）|
| `riskAdjusted` | risk 字段 | ✅ | 描述性（产出 captureFlag 渲染，不参与 fine 权重）|
| `theme` | holdings | ✅ | 描述性（不参与 fine 权重；live 渲染）|
| `sizeRisk` | aumYi | ✅ | 描述性（flag 渲染）|
| **`sectorFlow`** | **池级 heatmap** | ❌ **池依赖** | 🔴 **v1 取预计算卡值，不浏览器重算**（§5.4）|

> 设计原则：**v1 把所有「哲学上可质疑、经济上有意义」的钮接成 live**——5 精排权重（重组）+ α 子权重/真α阈值（何为真α）+ 背书子权重（何为聪明钱认可）+ 捕获 floor/ceil（何为下行保护）= 共 **13 个可调钮**。`bandValue`/`sectorFlowValue` 在 v1 取预计算卡值（前者无子权重，后者池依赖）。

### 5.2 fine 分重算公式（移植 `shortlist.js` 的 `fineRankCard`）

```
downsideQuality(downsCap, captureFloor=40, captureCeil=120):   // 键名: analysis.shortlist.fine.downside
  null → 0.5
  neg  → 1            // 逆市（clamp）
  else → clamp((captureCeil - downsCap) / (captureCeil - captureFloor), 0, 1)   // 越低越保护

fineScore = round3(                                   // 忠实移植 shortlist.js#fineRankCard (lines 53-78)
    w.trueAlpha         * clamp(alphaQualityValue, 0, 1)      // α 质量 composite（非 0/1 tier flag，见下注）
  + w.downsideProtection * downsideQuality(downsideCapture, captureFloor, captureCeil)
  + w.sectorFlow         * clamp(sectorFlowValue, 0, 1)       // 🔴 取预计算卡值（v1 冻结）
  + w.band               * clamp(bandValue, 0, 1)             // 取预计算卡值（v1 无子权重）
  + w.endorsement        * clamp(endorsementValue, 0, 1)      // 背书子权重变 → 重算
)
```

> 🔴 **2026-06-27 spec 勘误（T3 金标准对齐抓出）**：早版 §5.2 把 trueAlpha 项写成 `w.trueAlpha * (tier==='true_alpha'?1:0)`（0/1 flag）+ downside 键写成 `floor`/`ceil`——两者都错。真实 `shortlist.js#fineRankCard` 用 `aq.value`（α 质量 composite，连续值）+ 键名 `captureFloor`/`captureCeil`。已据此修正本节 + 实现（`scoring.mjs`）。教训：移植类工作的真理是**金标准对齐测试**，不是 spec 文字。

**组件来源**：`alphaQualityValue`（α 子权重/阈值变 → 重算）× trueAlpha 权重；`downsideQuality`（`captureFloor`/`captureCeil` 变 → 重算）；`endorsementValue`（背书子权重变 → 重算）；`sectorFlowValue`/`bandValue` = 取 card 预计算值。权重 `{trueAlpha,downsideProtection,sectorFlow,band,endorsement}` 来自推演面板滑块（归一化 Σ=1）。

> 重算触发：5 精排权重任一变 → 仅重组 fine（快，~317 次乘加）；α/背书子权重或阈值或捕获区间变 → 先重算对应子分（需 dossier 字段）再重组 fine。两者都毫秒级。

### 5.3 权重滑块归一化交互

5 滑块拖一个时，**其余 4 个按原比例自动让位**以维持 Σ=1（常见「抓一个其余缩放」模式）。高级面板里的 α 子权重 / 阈值 / 捕获区间**不归一化**（各自独立范围）。每次改动 → 对 317 卡重跑 §5.2 → 重排 → 算 Δ。

### 5.4 🔴 sectorFlow 冻结说明（诚实边界）

`sectorFlowValue` 依赖池级 heatmap（`buildSectorFlowHeatmap` 全池聚合 + `rankNorm`）。v1 不在浏览器重算 heatmap（开销 + 复杂度）。后果：拖 `w.sectorFlow` 滑块仍生效（它乘的是冻结的 sectorFlowValue），但**改 sectorFlow 内部比（0.6/0.4）或超类权重不会反映**。高级面板该项置灰 + tooltip「改此项需 Node 重跑 `run-analysis`」。

---

## 出局审计视图（v1 新增 · 漏斗透明化 · 回答 317→302）

> 🔴 用户驱动（2026-06-27）：「搞清楚为什么从 317 变成 302，不能错失优质标的」。排查 012922 时坐实：一只 **5★、α 百分位 top-1%、夏普 top-2%、+227%/年** 的精英 QDII（012921/012922 易方达全球成长精选），**仅因其最老份额是「A(美元现汇份额)」而被 `exclude_usd_shareclass` 整只剔出**（`screen.js:51` 命中 `美元`）——它明明有人民币 C 份额。这正是「错失优质标的」的典型，必须可见、可审计。

### 现有数据即可支撑（无需新抓取）

漏斗三层的数据都已落盘，出局原因可由 `screen.js` 的浏览器移植版逐只判定：

| 漏斗层 | 数量 | 数据源 | 出局原因可知？ |
|---|---|---|---|
| 服务端结构筛 (`search_filter`) | 394 | `store/snapshots/<date>.json`（每行 25 字段）| 每行字段齐全 → 可判 gate |
| 客户端质量筛 (`screen.js`) | 302 | `store/derived/candidates-<date>.json` | 394−302=**92**，逐只 gate 可判 ✅ |
| 已抓 dossier | 317 | `data/fund/*/`（302 候选 + **15 尾部**）| 尾部：在 394 内→可判；在 394 外(012922)→「服务端层出局/历史档案」|
| shortlist | 20 | `shortlist-<date>.json` | — |

> 服务端层之前的出局（universe→394，被 `search_filter` 结构筛掉的）**无逐只数据**（服务端只返回过关者）→ v1 只显总数占位（`??`），逐只留 v2（需 screener explain-mode / 逐只查询，外发）。

### 视图构成

顶栏模式切换：「**推演**」(骨架1 三栏，默认) ↔ 「**出局审计**」。出局审计模式布局：

1. **漏斗瀑布**（顶部横幅）：`??(universe) → 394 服务端 → 302 客户端 → 317 已抓 → 20 shortlist`，每层标注其 gate 集合（rating3Y/oldestShare/tenure/trackPb｜α-rank/sharpe-rank/size-cap/USD/rating5Y）。
2. **出局清单**（主区表格）：394−302 的 92 只 + 尾部 15 只，每行字段：
   `代码·名称`｜`出局 gate`(badge)｜`rating3Y`｜`α排名`｜`夏普排名`｜`规模`｜`任期`｜`类别`｜`有dossier?`
   - **gate 由 `screening.mjs`（`screen.js` 移植）逐只重判产生**（不再静默 `continue`）。badge 集：`USD份额`/`规模>100`/`规模<2`/`α排名`/`夏普排名`/`评级3Y`/`评级5Y`/`任期`/`历史档案`。
   - 可按 gate 分组/过滤；**按 α/收益降序**→ 一眼看到「高 α 却被出局」的优质标的（012921 会排在 top，gate=`USD份额`）。
3. **点击出局行 → 详情**：有 dossier → 完整判定卡（复用推演模式右栏组件）；无 dossier → 显示 snapshot 25 字段。

### 关键模块

- `public/lib/screening.mjs` — `screen.js` 的 ESM 忠实移植，函数返回 `{passed, gate, detail}` 而非静默丢弃；与 `scoring.mjs` 配对。配同款金标准对齐测试：默认门槛下过关集 == `candidates-<date>.json`。
- `public/views/audit.js` — 漏斗瀑布 + 出局清单渲染。

### 🔴 配套建议（独立决策，不阻塞本页面）：修 USD 兜底规则

`exclude_usd_shareclass` 本意是去重美元份额；但当一只基金的**最老份额恰好是美元份额**时（`oldestShareId:true` 已折叠到它），USD 排除会**误杀整只基金**的人民币份额（012921/012922 即此）。建议（**另起小任务，不在本 spec 内**）：筛选层加「USD 出局 → 回退到最老的人民币份额」而非整只丢弃。本页面先**暴露**这类案例，是否修规则由你定。

---

## 6. 金标准对齐测试（正确性保证）

**目的**：证明浏览器移植版 scoreFund 与 Node 版 `score.js` 行为一致，防漂移。

**方法**（`web-funds/test/parity.test.js`，`node:test`）：
1. 加载 `score-2026-06-27.json`（Node 版产出，当金标准）+ 同批 dossier。
2. 浏览器版用 **默认权重**（`analysis.json`）对每 dossier 重算。
3. 断言每卡：`alphaQuality.value` / `endorsement.value` / `bandContribution.value` / `riskAdjusted.*` / `sizeRisk.flag` / `tier` 与金标准差 ≤ **0.01**（或精确相等 for tier/flag）。
4. 断言 `fineScore`（默认 fine 权重）vs `shortlist-*.json` 的 `fineScore` 差 ≤ 0.01。
5. 断言默认权重下排名与 `ranked.byFineScore` 一致。

> `sectorFlow.value` 不参与对齐断言（v1 冻结，直接读卡值）。其余必须对齐——这是移植正确的硬门槛。失败 → 移植有 bug，不许上线。

> 🔴 **诚实声明（非单一真理源）**：Node 管线仍用 `research/funds/analyze/score.js`（CommonJS）；`web-funds/public/lib/scoring.mjs` 是它的**忠实 ESM 移植**（剔 IO/写盘的纯计算部分），被浏览器 + 本对齐测试消费。**两份实现靠本测试同步**——若改了 `score.js`，必须重跑对齐测试，漂移即失败。未来可选：把纯计算抽成双方共用的 ESM 核心（v2，需重构管线，v1 不动绿管道）。

---

## 7. 架构 & 文件结构

### 7.1 位置

新 app 置于仓库根 **`web-funds/`**（与现有 `web/` manager app 并列，互不干扰）。理由：manager 与 fund 是不同数据域；`web/` 的 `server.js` 硬绑 manager 数据 + 端口 8765，重构成本 > 新建。端口用 **8766**（manager 让 8765）。

### 7.2 技术栈

- Node ≥ 18，**仅内置** `http`/`fs`/`path`，**0 第三方依赖**（与 `web/` 一致）。
- 前端 vanilla JS（ESM）+ 原生 fetch/DOM，无框架。
- SSE 热重载（复用 `web/server.js` 的 watch + broadcast 模式）。
- 字体走 Google Fonts CDN（Noto Serif SC + IBM Plex Sans/Mono）；离线降级到系统 serif/sans/mono。

### 7.3 文件树

```
web-funds/
├── server.js                     # Node http：扫数据 → /api/bundle + 静态 + SSE 热重载（~300 行）
├── package.json                  # {start, dev, test}
├── README.md                     # 启动/数据源/端口
├── public/
│   ├── index.html                # 三栏骨架 + editorial 顶栏
│   ├── style.css                 # CSS 变量 + 明暗 + editorial/工具双风
│   ├── app.js                    # 前端编排：fetch bundle → 渲染三栏 → 绑滑块/筛选/选中
│   ├── lib/
│   │   ├── scoring.mjs           # ★ scoreFund/fineRank 的 ESM 忠实移植（§6 对齐测试兜底；非共用真理源）
│   │   └── screening.mjs         # ★ screen.js 的 ESM 忠实移植，返回 {passed,gate,detail}（出局审计用）
│   └── views/
│       ├── topbar.js             # 顶栏（哲学 chips / heatmap 缩略 / 明暗 / 推演↔出局审计 模式切换）
│       ├── scorer.js             # 推演面板（滑块归一化 / 高级 / 恢复默认）
│       ├── ranked-list.js        # 实时排名（筛选/排序/Δ）
│       ├── detail-card.js        # 选中基金判定卡（推演 + 出局审计 共用）
│       └── audit.js              # 出局审计（漏斗瀑布 + 出局清单 + gate 重判）
└── test/
    ├── parity.test.js            # ★ 金标准对齐（§6）
    ├── scoring.test.js           # 子分/fine 公式单测（默认 + 极端权重）
    └── fixtures/
        └── (复用 research/funds/test/fixtures 的 mock dossier，或切片真 dossier)
```

### 7.4 server 关键端点

- `GET /api/bundle` → `{ asOfDate, fundCount, heatmap, defaults{fineWeights, downside, alphaSub, thresholds}, cards[317], shortlist[20], dossiers{<code>: {...}}, snapshot{count, rows[394]}, screenThresholds, changes[events] }`（dossiers 按需裁剪到 §3.2 所需字段以减体积；snapshot.rows 全 25 字段供出局审计重判 gate）。
- `GET /api/report/:code` → 该 code 的 Markdown 报告纯文本（若已生成）。
- `GET /sse` → 热重载（`public/**` 或数据文件变化广播 reload）。
- 静态：`public/**`。

---

## 8. 交互规格

| 操作 | 行为 |
|---|---|
| 拖精排权重滑块 | 其余按比例归一化（Σ=1）→ 重算 fine → 重排中栏 → 更新 Δ → 右栏若选中则更新其 fine 分 |
| 改高级 α 子权重/阈值 | 重算全卡 α 子分 → 重算 tier → 重排 |
| 改背书子权重 | 重算全卡 endorsement 子分 → 重排 |
| 改下行 floor/ceil | 重算全卡 downsideQuality → 重排 |
| 点筛选 chip | 切该筛选项 → 中栏过滤（保留排名序）|
| 点列头 | 按该列排序（fine 分默认降序；可切 α/板块/规模/评级）|
| 点中栏一行 | 选中 → 右栏渲染该基金判定卡（高亮行）|
| 「恢复默认」 | 滑块回到 `analysis.json` 初值 → 重排 → Δ 清零 |
| Δ 箭头 | 当前排名 − 默认权重下排名；▲绿/▼红/—灰 |
| 明暗切换 | `data-theme` 切换，`localStorage` 记忆 |
| 哲学 chip | hover 显示该论点全文 tooltip（锚定 philosophy.md）|

**Δ 计算**：启动时用默认权重算一次「基线排名」存内存；每次重排后 `Δ = baselineRank − currentRank`（正=上升）。

---

## 9. 否定式边界 & 诚实显示（强制）

- 顶栏副标题常驻：**「波段判定 · 非长期赢家 · 截至 as-of」**。
- 详情卡 flags 区**忠实显示所有 flag**（含 `low_benchmark_fit` / `data_noise` / `industry_beta_pseudo` / `capacity_erosion`），不美化。
- 推演面板 sectorFlow 冻结项**置灰 + 说明**，不假装可调。
- Δ 箭头基于**默认权重基线**，明确标注「vs 默认」。
- 无逐日净值 → 年度近似：详情卡年度区标注「年度近似（无逐日净值）」。

---

## 10. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| 浏览器 scoreFund 移植与 Node 版漂移 | §6 金标准对齐测试（硬门槛，CI 跑）|
| `scoring.mjs` 同时被 Node(test) 和浏览器 import 的模块格式问题 | 用纯 ESM（`export`），Node `--test` 原生支持 ESM；浏览器 `<script type=module>` |
| bundle 体积（317 dossier ~5MB）| localhost 可接受；server 裁剪 dossier 到 §3.2 所需字段；可加 gzip |
| 权重归一化交互手感差 | 「抓一个其余按比例缩放」+ 数字框可手输；恢复默认一键 |
| sectorFlow 冻结让用户困惑 | 置灰 + tooltip 明示；§5.4 |
| 暗色对比度 | 用 token 化暗色板，badge 色在暗色下重映射 |

---

## 11. 验收标准（v1 完成 = 满足全部）

1. `node web-funds/server.js` 起 8766，浏览器打开见三栏 + editorial 顶栏，317 只加载。
2. 拖任一精排权重 → 中栏 < 100ms 内重排，Δ 箭头正确变化，选中基金 fine 分更新。
3. 改高级 α 阈值（如真α 0.7→0.5）→ 部分混合基金升为真α，重排反映。
4. 筛选「真α」+「<100亿」→ 列表正确过滤。
5. 点任一行 → 右栏详情卡字段完整（7 维 + 4 句 + 风险 + 年度 + 重仓），flags 忠实。
6. 明暗切换正常，刷新后记忆。
7. `npm test`（`web-funds/`）：金标准对齐 + scoring 单测全绿。
8. 否定式边界文案常驻可见。
9. 切到「出局审计」模式：漏斗瀑布显示 394→302→317→20 四层 + 各层 gate 标注。
10. 出局清单列出 394−302=92 只客户端出局 + 尾部 dossier，每只 gate badge 正确；**012921 易方达全球成长精选(QDII) A(美元现汇) 出现在按 α 降序的顶部，gate=`USD份额`**（回归断言，锁住这个真实案例）。
11. `screening.mjs` 默认门槛下过关集 == `candidates-2026-06-26.json`（金标准对齐，pari passu §6）。

---

## 12. 相关文档

- 哲学为什么：[`research/funds/docs/investment-philosophy.md`](../../research/funds/docs/investment-philosophy.md)
- 评分规则（移植源）：[`research/funds/analyze/score.js`](../../research/funds/analyze/score.js) · [`shortlist.js`](../../research/funds/analyze/shortlist.js)
- 可调参数：[`research/funds/core/config/analysis.json`](../../research/funds/core/config/analysis.json)
- 第三步分析设计：[`2026-06-21-fund-analysis-step3-design.md`](./2026-06-21-fund-analysis-step3-design.md)
- 设计 DNA 来源：[`web/README.md`](../../web/README.md)（manager web，editorial 设计）
