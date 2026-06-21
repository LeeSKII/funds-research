# Morningstar 基金研究自动化引擎 · 设计文档

> **日期**: 2026-06-20
> **状态**: 设计定稿,待 review → 进 writing-plans
> **范围**: `engine/` 全新生产系统

---

## 1. 背景与目标

构建一个自动化系统,对晨星(morningstar.cn)基金数据做**每日动态分析 + 定期投研分析**。

- **每日动态**:全市场快照、变化检测(评级/经理/异动)、候选筛选。
- **投研分析**:候选基金深度尽调(持仓/Brinson 归因/经理画像)、组合优化、定期报告。
- **运行模型**:Claude Code `/loop` 模式定时编排,产出 = **原始数据落库 + 定期投研报告**。

早期原型已验证方法论(Brinson 真假 α、Markowitz、backtest、防御层),但结构是迭代堆叠的,不适合作生产基座。本设计是**全新、分层、高内聚低耦合**的重写。

## 2. 关键约束(来自实地侦察,2026-06-20)

对 morningstar.cn 三类页面的 API 侦察得出三条硬约束,直接决定架构:

1. **三层鉴权**:
   - Layer 1 `/cn-api/v2/*` + `/cn-api/manager` —— 只要 `token`(JWT,RS256,~14 天有效)。
   - Layer 2 `/manager/managerDRI/*` + `/manager/sectorBreakDown/*` —— `token` + `signature`(会话下发,无法离线生成)。
   - SSR HTML(`__NUXT_DATA__`)—— 存在但**加密**,不可直接抓。
2. **规模 = 全市场数千只**:浏览器逐只抓不可行,每日热路径必须走 API。
3. **深度数据无干净 JSON**:重仓/Brinson/多期风险只在 SSR innerText;经理深度在 Layer 2。

> 侦察产出 26 个端点 + 鉴权模型(含活 token,已 gitignore)。

## 3. 架构决策

### 3.1 总体方案:漏斗式混合(Approach A)

**API 扛宽而浅的每日热路径,浏览器扛窄而深的周期性研究路径**:

| 数据 | 量级 | 获取方式 |
|---|---|---|
| 每日全市场快照 | 数千只 × 53 字段,1 调用 | API(`search/es`) |
| 候选净值时序 | ~16-190 只 | API(`growth-data`,Node 并行) |
| 重仓/Brinson/行业(深度) | 短名单 | 浏览器(innerText) |
| 经理深度(在管/履历/规模) | 短名单 | 浏览器(`managerDRI`,Layer2) |
| 分析/报告 | — | 纯 Node |

**漏斗分层(钉死三层边界,避免"候选/短名单"混用)**:
- **全市场**(数千只)→ 每日 snapshot 【**API** · Layer1 `search/es`,1 调用】(daily)。
- **候选**(~50-190 只,screen 产出)→ nav-pull 日频时序 【**API** · Layer1 `growth-data`,Node 并行】(weekly)。
- **短名单**(~16-30 只,组合 + 重点尽调)→ deep-scrape 深度档案 【**浏览器** · MCP 逐只抓 SSR innerText + Layer2 `managerDRI`】(weekly/monthly)。

### 3.2 浏览器层驱动方式:MCP(非 Playwright)

浏览器层由 **Claude Code 调 chrome-devtools MCP** 执行(playbook 形态),非 Playwright。理由:复用已登录的真实 Chrome、无新依赖、贴合 `/loop` 运行模型。MCP 全程只用于两件 Node 做不到的事:**token 引导** 与 **深度抓取(SSR innerText + Layer2 signature)**。Playwright 列为"未来脱离 Claude Code 跑纯 cron"的演进项,不在 v1 引入。

**核心设计原则**:**"能 Node 就不 MCP"**。Node 确定性高、可单测、可离线;浏览器脆性(SPA 时序/改版)被隔离在周期性、可人工补救的深度层。

## 4. 设计原则

1. **分层单向流水线**:`ingest → store → analyze → report`,禁止逆向依赖。
2. **store 是唯一事实源 + 解耦边界**:模块间不互调,只读写 store 里**带 schema 契约**的产物。
3. **外部知识单点封装**:所有 Morningstar 专属知识(鉴权/URL/字段黑话)锁在 `core/`。
4. **配置驱动**:基金池/观察名单/阈值/频率在 config,不硬编码。
5. **analyze 层纯函数**:零网络、确定性、可重放。

## 5. 模块结构(8 模块 + 单向依赖)

```
engine/
├── core/         morningstar client(Layer1 fetch + Layer2 浏览器接口)+ auth + schemas + config
├── ingest/       数据采集:market-sweep / nav-pull / deep-scrape / harvest-token 【只写 store】
├── store/        单一事实源:snapshots / funds/<code> / changes / manifest
├── analyze/      纯计算:diff / screen / attribution / portfolio 【只读 store,零网络】
├── report/       产出:research-report / templates 【只读 store+analyze】
├── governance/   loop 治理:INVARIANTS + LOOP-GUIDE + MEMORY + PLAN 【声明式】
├── orchestrate/  执行:run.js + daily/weekly/monthly.md 【命令式,引用 governance】
└── ops/          运维:logs / state / retry-queue
```

**依赖规则(硬约束)**:
- `core` ◄── 被所有模块依赖。
- `ingest ──► store ◄── analyze ──► store/derived ◄── report`
- ✗ `analyze` 不调 `ingest`;✗ `report` 不调 `analyze` 函数;✗ 任何模块不直接调另一模块内部,只通过 `store`(数据)或 `core`(共享)。
- ✓ 唯一允许跨层的是 `orchestrate`(指挥)与 `ops`(横切日志)。

## 6. 治理层 governance/(loop 的记忆/计划/不变量)

自治 loop 最大失败模式是"失忆 + 漂移"。governance 持四个职责互斥的制品:

| 制品 | 角色 | 频率 |
|---|---|---|
| `INVARIANTS.md` | 静态约束:不能变什么(目标 + 机器护栏) | 极少 |
| `LOOP-GUIDE.md` | 静态规程:怎么执行每次 fire | 少 |
| `MEMORY.md` | 滚动状态:已经做了什么 | 每次 fire 末尾 append |
| `PLAN.md` | 滚动待办:接下来做什么 | 每次 fire 更新 |

**Fire 仪式(写进 orchestrate/*.md 头尾)**:
- 开始:读 INVARIANTS → LOOP-GUIDE → MEMORY → PLAN。
- 执行:推进 PLAN 顶部项,每步对照 INVARIANTS 校验。
- 结束:append MEMORY + 更新 PLAN + 写 ops/logs。

**INVARIANTS 两层**:(a) 机器强制护栏(过 schema、抓后 diff、不臆测、token 不进 git、只投研不交易);(b) 研究北极星(Sharpe 0.40-0.47、Brinson 鉴别真假 α、防御层 smart-beta、3 年再平衡、tenure>3y)。

**与 Claude Code 自身 memory 的区分**:Claude Code `~/.claude/.../memory/` 存稳定事实(鉴权模型/字段黑话);governance/MEMORY 存滚动会话状态(上次跑到哪/当前候选/未决发现)。稳定 vs 易变,各司其职。

**governance vs orchestrate 边界**:governance 是声明式规则/状态(Markdown);orchestrate 是命令式执行(Node run.js + 各频率 runbook,引用 governance)。

## 7. 组件清单

| 模块 | 组件 | 类型 | 职责 |
|---|---|---|---|
| core | `morningstar/client.js` | Node lib | Layer1 封装:`searchFunds` / `getGrowthData` / `getManagerReturn` |
| | `morningstar/auth.js` | Node lib | token 载入/查过期/决定重抓 |
| | `schemas/*.schema.json` | 契约 | snapshot / change-event / fund-deep / nav-series |
| | `config/*.yaml` | 配置 | universe / watchlist / thresholds |
| ingest | `harvest-token.md` | **MCP playbook** | 浏览器抓 token → secrets |
| | `market-sweep.js` | Node | search/es 全市场 → snapshots/ |
| | `nav-pull.js` | Node | 候选 growth-data 并行(限流)→ funds/<code>/nav.json |
| | `deep-scrape/playbook.md` | **MCP playbook** | 抓 innerText + managerDRI 原始 |
| | `deep-scrape/parse.js` | Node | 解析原始 → 校验 → fund-deep.json |
| analyze | `diff.js` | Node 纯函数 | 昨今快照比对 → changes/ |
| | `screen.js` | Node 纯函数 | 漏斗筛选 → derived/candidates.json |
| | `attribution.js` | Node 纯函数 | Brinson 真假 α 分类 |
| | `portfolio/` | Node | markowitz / backtest / rebalance / MC / bear |
| report | `research-report.js` | Node | 渲染 store → reports/*.md|.pdf |
| orchestrate | `run.js` | Node | 串纯 Node 阶段(daily) |
| | `daily/weekly/monthly.md` | playbook | 各频率 runbook(引用 LOOP-GUIDE) |
| ops | `logs/ state/ retry-queue.json` | 运行态 | 日志/游标/失败重试 |

## 8. Schema 契约(解耦的物理载体)

四个 schema 一旦定下,三层可并行开发/独立测试:

- **snapshot.schema** —— 每日全市场快照(`search/es` 53 字段):`{date, count, rows[{id, fundName, categoryName, styleBox, rating3Y/5Y, return*_M, alphaToInd_3Y, sharpeRatio_3Y, maximumDrawdown_3Y, fundSize, managerName, longestTenure, ter, top10Holding, ...}]}`。
- **change-event.schema** —— diff 产物:`{date, events[{code, type: rating_change|manager_change|new_fund|removed, field, before, after}]}`。
- **fund-deep.schema** —— 深度档案:`{code, asOf, holdings[{ticker,name,weight,sector,change}], attribution{fundReturn, benchReturn, excess, industryAlloc, stockSelect}, sector[{group,weight,bench}], risk{1Y,3Y,5Y}, fee{}, holder{}}`。
- **nav-series.schema** —— 时序(backtest 输入):`{code, freq, startDate, endDate, dates[], fund[], bmk1[], catAvg[], dividend[], managerChanges[]}`。

## 9. MCP vs Node 执行边界

```
每日 fire (daily.md):
  [MCP]  harvest-token.md                 → secrets/token.json(过期才跑)
  [Bash] node orchestrate/run.js daily    (market-sweep → diff → screen → 落库)
  [governance] append MEMORY + update PLAN

每周 fire (weekly.md):
  [Bash] node ingest/nav-pull.js --from derived/candidates.json
  [MCP]  deep-scrape/playbook.md × 短名单 → funds/<code>/raw/*
  [Bash] node ingest/deep-scrape/parse.js × 每只
  [Bash] node analyze/attribution.js --codes <短名单>
  [governance] append MEMORY + update PLAN

每月 fire (monthly.md):
  [Bash] node report/research-report.js → reports/YYYY-MM.md|.pdf
  [governance] MEMORY 月度小结 + PLAN 下月计划
```

**token.json 是 MCP→Node 的交接桥**:MCP 从浏览器会话抓 token 落盘,Node 读取后直接调 Layer1 API(快、确定),避免每次取数都开浏览器。

## 10. 数据流(每日端到端)

```
config + [MCP]harvest-token → token.json
   │
[node] market-sweep ─search/es─► store/snapshots/YYYY-MM-DD.json (数千只×53字段)
   │
[node] diff ◄─昨日快照──► store/changes/YYYY-MM-DD.json
   │
[node] screen ◄─thresholds──► store/derived/candidates.json (漏斗→~50只)
   │
[governance] MEMORY+=摘要 / PLAN+=新候选待深抓
```

## 11. 错误处理

**三原则**:原子写(临时文件+rename)、幂等 fire(snapshot 按日键、diff 确定性、同日重跑一致)、检查点续跑(长批次进度写 ops/state)。

| 失败 | 处理 |
|---|---|
| token 过期/401 | 重跑 harvest-token;无法重登 → fire 顺延 + 告警 |
| Layer2 signature 失效 | 该经理数据入 retry-queue,不阻断其他 |
| 429 限流 | 指数退避 + 降并发 |
| search/es 空响应 | 重试;持续空 → 异常告警(疑似限流/改版) |
| 单只 growth-data 失败 | 独立失败 → retry-queue,不阻断整批 |
| schema 校验失败 | 拒绝写入 + 日志,不污染 store |
| SPA 旧数据(diff 全同) | about:blank 中转重抓(强制) |
| 字段错位/缺失 | 留 null + warning,不臆测 |
| MCP/浏览器不可用 | 等待重试;失败 → fire 顺延 |

## 12. 测试策略

金字塔:**单元(多,analyze/* 用 fixture)→ 契约(扫 store 符合 schema)→ 集成(offline 模式跑 daily)→ live 冒烟(1 只端到端)**。

- 单元:`diff`/`attribution`(006502 stock_alpha=154% → 真 α)/`screen`/`parse`,用落库数据与上轮捕获的原始响应当 fixture。
- 离线模式:`market-sweep`/`nav-pull` 支持 `--offline` 读 fixture,无网无浏览器可跑通。
- MCP 组件(harvest-token/deep-scrape)无法单测 → schema 校验 + 单只冒烟兜底。
- fixture 直接复用已抓的 golden 数据(现 `engine/test/fixtures/mock-fund-innertext.json`)。

## 13. 试点迁移清单

| 试点资产 | 迁到 | 改造 |
|---|---|---|
| `portfolio-tools.js`(markowitz/backtest/rebalance/MC/bear) | `analyze/portfolio/` | backtest 数据源换成 nav-series.schema |
| `validate-screener/manager.js` 纪律 | `core/schemas/` + `core/validate.js` | — |
| `generate-pdf-report.js` | `report/research-report.js` | 输入改只读 store |
| v22 组合 + CONCLUSION 方法论 | `governance/INVARIANTS.md` + portfolio 种子 | — |
| 4 步法 | ingest+store+schemas 内化 | — |
| 已抓 raw-snapshots | `engine/test/fixtures/` | — |

不迁:`iter-N-*.md`/`.iteration-state.md`(被 governance 取代)。试点降为只读参考,运行时零依赖。

## 14. 建造顺序

```
Phase 1  core 骨架(schemas+config+client+auth)+ store 约定
Phase 2  ingest/market-sweep + analyze/diff + screen
Phase 3  governance 四制品 + orchestrate/daily.md + run.js   ← 🎯 最小可用 daily loop
Phase 4  ingest/nav-pull + deep-scrape + analyze/attribution
Phase 5  report/research-report.js
Phase 6  ops(retry/state)+ 错误加固 + 测试补全
```

Phase 3 结束即有可跑的每日 loop(快照→diff→落库→更新 MEMORY/PLAN),尽早验证治理模型。

## 15. 待定 / 演进项

- **token 存储位置**:localStorage(则 evaluate_script 可直读)vs 仅请求头(须抓 network request)——实现时实测选稳。
- **store 格式**:v1 JSON-on-disk;`snapshots/changes` 量大后演进 SQLite。
- **浏览器层**:v1 chrome-devtools MCP;若需脱离 Claude Code 跑纯 cron → 迁 Playwright。
- **未探端点**:`/cn-api/v2/funds/{code}/holdings|attribution|risk|sector|fee|holders` 子命名空间(侦察推断存在),Phase 4 实测;若命中则 deep-scrape 部分可降级为 API。
- **BOUND-1(只投研不交易)**:建议作为硬护栏默认值,待用户最终确认(研究系统不应产生交易指令)。

## 16. 不在本设计范围(YAGNI)

- 实时告警推送、实时仪表盘(本次产出只要落库 + 定期报告)。
- 自动交易/下单。
- 个股下钻、FOF/ETF/债券专项(未来子项目)。
- ML 预测(CONCLUSION roadmap 项,非 v1)。
