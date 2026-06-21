# 基金研究 · 工作流指引

> 隔离目录：`research/funds/`　|　产物：`data/fund/<code>/fund-<code>-<date>.json`
> 全局规则（SPA hash 陷阱 / diff 新鲜度 / 单源 / 安全）见根 [`CLAUDE.md`](../../CLAUDE.md)。

基金研究分 **2 步**：先用筛选条件拿到候选基金列表，再逐只取详情做研究。

## ① 筛选条件 → 基金列表

全市场快照 → 两层漏斗筛选 → 候选列表。`orchestrate/run.js` 是**唯一**允许跨层调用的模块，把以下串成"每日 fire"（ingest → analyze → store）：

| 阶段 | 脚本 | 作用 |
|---|---|---|
| 全市场快照 | `ingest/market-sweep.js` | 调 Layer1 `search/es` API + `universe.search_filter`（`core/config/universe.json`）→ `store/snapshots/<date>.json`。`--offline` 读 fixture |
| 变化检测 | `analyze/diff.js` | 当日 vs 昨日快照 diff（评级/经理/异动），按**基金数据** hash（非文件 hash——日期字段天天变，文件 hash 永远检不到 stale）|
| 客户端筛选 | `analyze/screen.js` | 纯函数：快照 × `thresholds.json` → 候选行。两层漏斗：server 已做结构存活 + 真 α 判别（trackPb 50~100 杀 closet-indexer），client 做 ranking + 组合适配 + 防御层标注 |

- **鉴权**：`core/auth.js` `loadToken()`（JWT from `secrets/`，~14 天有效；临近过期用 harvest-token 重取）
- **客户端 screen 只能看到 search/es 返回的 25 个字段**：`*RankP` / 回撤类是有效的 server filter 但**不在行里**，不能作 client gate → 详见 `research/funds/docs/screener-filters.md`
- **配置**：`core/config/`（`universe.json` 服务端 filter + `thresholds.json` 客户端阈值）

## ② 列表 → 基金详情 dossier → 研究

对候选列表里每只基金，取详情页 dossier（同样是 4 步结构）：

1. **抓取 innerText** → chrome-devtools MCP（`about:blank` 中转 → navigate → `evaluate_script` dump `document.body.innerText`）。快照**临时**写到 `research/funds/tmp/`（gitignored），不长期留存。
2. **解析** → `node research/funds/analyze/parse-fund.js <snapshot> <code>` → `data/fund/<code>/fund-<code>-<date>.json`（按基金分文件夹留时间序列；v2 页面结构对齐：8 段 extractor + orchestrator）
3. **校验** → `research/funds/core/schemas/fund-dossier.schema.json`（ajv）
4. **审计** → Workflow：8 段 sub-agent 各自 vs 原始 innerText 核对提取是否遗漏/错位

测试用**模拟 fixture**（`research/funds/test/fixtures/mock-fund-innertext.json`，匿名化的真实结构），84 测试全绿，不依赖实时数据或快照语料。深度 API/布局参考在 `research/funds/docs/`（`fund-detail-api.md` · `fund-detail-layouts.md` · `screener-filters.md`）。

## ③ dossier → 基金分析（评分卡 + 板块资金流向）

基于第二步 dossier 做多维分析，产物 `store/derived/score-<date>.json`（每基金一张判定卡 + 池级板块景气 heatmap）。哲学锚 [`docs/investment-philosophy.md`](./docs/investment-philosophy.md)；设计 [`docs/superpowers/specs/2026-06-21-fund-analysis-step3-design.md`](../../docs/superpowers/specs/2026-06-21-fund-analysis-step3-design.md)。

🔴 **#6「钱最多」= 板块高景气度/高流动性，不是基金规模**：heatmap 用候选池自身的 `portfolio.sectorAllocation` 聚合「资金堆在哪」，逐基金算组合对齐度 + 流动性(styleBox 大盘)。基金规模 >100 亿反而是 `capacity_erosion` 风险 flag。所有结论只对当前波段负责（否定式边界）。

| 模块 | 作用 |
|---|---|
| `analyze/loader.js` | 扫 `data/fund/<code>/` 取最新 dossier → Map（自动滤 legacy 旧 schema） |
| `analyze/sectorflow-index.js` | 🔴 #6 板块资金流向 heatmap + 逐基对齐度（候选池自当传感器） |
| `analyze/theme-detector.js` | #5 行业赌注 + 重仓聚类 + 漂移 |
| `analyze/score.js` | 编排：真α/背书/波段/板块流向/主题/风险调整 → 判定卡 + flags + 叙述 |
| `analyze/run-analysis.js` | 池级编排 → `store/derived/score-<date>.json` |

运行：`npm run analysis:offline`（读 `data/fund/`，写 `store/derived/`）。

## 模块布局

```
research/funds/
├── GUIDE.md                # 本文件
├── analyze/                # parse-fund.js + sections/（8 段 extractor）+ shared.js + screen.js + diff.js
├── core/
│   ├── config/             # universe.json（server filter）+ thresholds.json（client 阈值）
│   ├── schemas/            # fund-dossier.schema.json（ajv）
│   └── auth.js · client.js · validate.js
├── ingest/                 # market-sweep.js（search/es）· pull-nav.js
├── orchestrate/run.js      # 每日 fire（唯一跨层：ingest → analyze → store）
├── store/                  # snapshots/changes/derived（gitignored，可再生产）
├── test/                   # node:test（84）+ fixtures/mock-fund-innertext.json
├── docs/                   # fund-detail-api · fund-detail-layouts · screener-filters
├── tmp/                    # 临时快照 + funds-prototype/（组合优化方法论参考，gitignored）
└── secrets/                # live JWT（gitignored）
```
