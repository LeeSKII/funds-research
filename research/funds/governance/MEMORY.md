# MEMORY — rolling "what we've done" (append at end of each fire)

> Newest at the bottom. One block per fire.

## 2026-06-21 — Phase 1 bootstrap
- Engine scaffolded (8 modules, ajv, node:test). Daily loop not yet run live.
- Pending: Task 12 live gate (verify Node→Layer1 works with harvested JWT).

## 2026-06-21 — LIVE GATE: PARTIAL GO ✅ Node→Layer1 / ⚠️ full-market scope
- ✅ **PRIMARY GATE PASSED.** Harvested RS256 JWT from browser localStorage (exp ~2026-07-01, ~14d valid). Node-side `POST /cn-api/v2/search/es` returns `response_status:200011` + real fund data. **Architecture Approach A core feasibility (API hot path via Node) CONFIRMED.**
- ⚠️ **SCOPE BLOCKER.** `search/es?source=local` caps at **1000 rows/call** (total universe `data.count = 10000`). Standard pagination params (`page`/`pageNo`/`pageIndex`/`current`/`start`/`offset` — query-string AND body) do **NOT** paginate (all return identical firstId `004320`). The 1000 returned rows are all `rating3Y=5` (opaque default filter via `sign`/`source=local`).
- ⇒ The "full market in 1 call" sub-assumption is **FALSE**. Did **NOT** run the full live daily loop (would store a partial/filtered 1000-fund snapshot as if it were the full market).
- Resolution paths (see PLAN): (a) reverse-engineer `sign`+pagination via browser capture; (b) redefine snapshot scope to candidate-universe; (c) survey other endpoints for a clean full-list. Needs user decision.
- Phase 1 CODE complete & reviewed: 28 tests pass, offline loop verified, final review clean (security + plan-compliance). Branch `feat/morningstar-engine-phase1` not yet merged to main.

## 2026-06-21 — LIVE GATE: FULL GO ✅ (scope resolved via server-side filter)
- **RESOLVED** the full-market blocker by pushing our screen standards into the search/es body (server-side filter). Filter = our thresholds encoded: `rating3Y`/`rating5Y` ∈ ["4","5"], `longestTenure` ">3", `alphaToIndRankP_3Y` "0~50", `sharpeRatioRankP_3Y` "0~50", `fundSize` ["2~5","5~10","10~50","50~100",">100"].
- Empirically tuned (~25 live filter-combo tests): this yields **847 funds** — complete (rows=count, no 1000-cap truncation), ~150 headroom for daily growth. Other combos: 三好-v1=190, equity-only=295–627 (excluded gold/dividend ETFs — rejected), tenure>5=793, no-size=1032 (over cap).
- `sign` param is **irrelevant** (with/without identical); body filters ARE respected when using valid value formats (arrays for rating/fundSize, `"lo~hi"` for percentiles, `">N"` for tenure). Earlier blind-test failures were wrong value formats, not a sign/checksum lock.
- ✅ **LIVE daily loop ran end-to-end**: 847 swept → 30 candidates. Real data (sample 004320 前海开源沪港深; candidates include v22 fund 001437 易方达瑞享 — the "真α" fund). `suspiciousIdentical:false` (first live day).
- Filter locked in `core/config/universe.json`. Daily snapshot = candidate universe (server-filtered ≤1000); data refreshes live each run. **Architecture fully validated — Approach A works.**
- Phase 1 DONE. Branch `feat/morningstar-engine-phase1` ready to merge to main.

## 2026-06-21 — daily filter 精炼: 排除债券 + 指数/指数增强 → 506 funds
- 在 screener UI 实测反向抓到排除字段的正确写法(非猜测): 排除债券 = `broadCategoryId:["$BCG$EQUTY","$BCG$ALLOC"]`(只留股票型 EQUTY + 混合型 ALLOC); 排除指数 = `indexFund:"false"`; 排除指数增强 = `enhancedIndexFund:"false"`(后两个在「重要属性」分组)。
- 应用到 daily filter(我们的标准 rating4-5 / tenure>3 / α&sharpe top50% / size≥2亿 + 这三个排除): **506 只**(混合 442 + 股票 64), screen 后 **25 候选**。比之前 847(含债券 237 + 可转债 8 + 另类 1)更聚焦主动权益。
- **screener UI 反向抓取是发现 morningstar filter 字段/值的最可靠路径**: `condition/filter` 端点只返回公司名; response 行只有 `broadCategoryNameCN` 没有 ID; Vue 折叠面板不响应程序化点击 → 只能人工在 UI 勾选后抓 search/es request body。
- 重新落库: `store/{snapshots,changes,derived}/2026-06-21.json` 已用新 filter 重生成。main 已领先 origin(未 push)。

## 2026-06-21 — 全量筛选条件测绘 (245 字段, 为全自动化奠基)
- **动机**: 逐个 UI 勾选发现 filter 不可持续; 用户要求独立、穷尽地研究所有筛选条件并成文, 为后续全自动化奠基。
- **方法 (三源交叉, 取代逐个 UI 勾选)**: (1) 静态抓 `screener-BHQXWzqB.js`/`search.js`/`index.js` bundle 做 archaeology → 提取完整 245 字段 catalog (key/中文 label/UI 分组/取值) + 全部 cn-api 端点; (2) chrome-devtools 读已渲染侧栏 → 7 分组 UI map; (3) 对全部 245 字段做 `search/es` 差分探测 (baseline=506, 49 批 fan-out) → 判定服务端是否生效 + 实测有效取值格式。无 /config 端点; bundle 即 schema (解析副本 `research/funds/tmp/filter-block.json`)。
- **产出**: `research/funds/docs/screener-filters.md` — 总表(服务端优先) + UI 分组参考 + 取值格式参考 + **服务端可筛 vs 客户端两份清单** + universe.json 逐字段注解 + 9 条 open questions。记忆 `morningstar-api-search-es.md` 已同步更新。
- **关键发现 (高价值)**:
  - **复合 key 静默 no-op**: `sharpeRatio`/`maximumDrawdown`/`sTD`/`alphaToInd`/.../`hiddenCost`/`management` 共 17 个 — 必须发带周期后缀的子 key。
  - **catalog-vs-实测格式冲突 11 处** (catalog 错): `applyingMaxIv`/`closeOpenPeriod` 要数组不是 range-string; `styleBox`/`totalRisk`/`rating*` 要裸数字码; `upCaptureRatio_*` 百分比制; `successRatio*Y` 百分位排名; 等。
  - **无服务端币种 filter**: `baseCurrencyId` 0 命中 → 美元/人民币份额排除**只能客户端按 fundName** (回应当初悬而未决的问题, engine screen 层是落点)。
  - 当前 universe.json (506) 用法正确 (已用周期后缀 key), headroom ~500。
- workflow: 52 agents / ~1.9M tokens / 28min。后续若需细化 (applyingMaxIv「无」桶码 / baseCurrencyId 存储格式 / categoryId 全树), 走 UI body 反向抓取。

## 2026-06-21 — 搜索策略设计 + 落地 (两层漏斗去冗余) + 两个关键 bug 修复
- **策略确定 (judge-panel 工作流, 5 策略实测)**: 服务端 search_filter = 结构生存(rating3Y 地板/资产大类 EQUTY+ALLOC/非指数/非增强/非FOF/tenure>3/size≥2亿) + oldestShareId 份额去重 + trackPb36mRankPer 真α预筛。实测 **402 只, 100% 捕获无截断**。client screen = 质量底线 + 组合适配 + 防御标注。daily: 402 → **308 候选** (宽, 因 trackPb 网已α精英)。
- **核心修复 1 — 两层漏斗去冗余**: 旧 universe.json 和 thresholds.json 用同一套 9 个 gate → screen 空转。重构: 服务端管结构+真α, 客户端管排名+组合适配+防御, 零重复。rating5Y/alpha3Y/sharpe3Y 移出服务端。
- **🔴 核心修复 2 — trackPb 方向反转**: 工作流综合方案用 trackPb `0~50` 当"杀 closet-indexer", 实测反了 — `0~50` 保留低α基金(meanAlpha 4.77), `50~100` 才保留高α主动基金(10.66)。kept-vs-excluded α对比抓出。改成 `50~100`。教训: rank 方向取决于指标极性, trackPb(跟踪误差)是"原始幅度"型, 不能套 0=best。
- **🔴 核心修复 3 — 阈值 100× bug**: alphaToIndRankP_3Y/sharpeRatioRankP_3Y 字段是 0-100 百分位(非 0-1 小数), 旧阈值 0.5 = top 0.5%(误选极顶, "25 候选"之谜), 改 50 = top half(原意)。
- **截断检测**: client.js 加 totalCount(data.count); market-sweep 若 totalCount>count 警告"截断, 基金丢失"。服务用户原则"不限制数量, 符合筛选条件的全留" — 单调用 ≤cap 即 100% 捕获; 若 >cap 走 sharded multi-call (未实现, 记入 PLAN)。
- **产出**: `research/funds/docs/screener-filter-discovery-methodology.md` (发现/验证/刷新方法论 + 10 条教训 + probe 模板 + 加新 filter 清单)。`screener-filters.md` 已有 245 字段清单。33 tests green, live daily 通过。
- workflow: 14 agents / ~644k tokens / 11min (策略设计) + 手动实测 probe (4 轮 node 脚本)。

## 2026-06-21 — 详情页 API 发现 + detailUrl 持久化 (为 Plan 2 详情深研奠基)
- **动机**: 确定短名单排序能否基于 search/es 的 25 字段行 → 发现不够 (无 Brinson / 下行捕获 / 年度回报) → 必须进基金详情页拿全量研究档案。用户要求先 chrome-devtools RE 出详情页 network 再定架构。
- **发现 (006502 实测)**: 详情页 = `https://www.morningstar.cn/fund/<6位id>.html` (Nuxt SSR, 数据烤进 HTML); legacy `/quicktake/<id>` 已废 (跳维护页)。只 2 个数据 XHR: `POST /cn-api/v2/funds/<id>/growth-data` (净值时序 + rollingReturn + dividend + managerChangeEvents; **要 secId** `F00001LXG1` 非 6 位 id) + `GET /cn-api/v2/manager/return?managerId=`。其余 (Brinson 超额=行业配置+个股选择 / 跌势捕获率 / 年度回报 / 前十持仓带代码 / 经理任职+内部持有 / 费用) 全在 SSR DOM 里。
- **提取架构定论**: 详情抓取 = 导航 `/fund/<id>.html` → 解析渲染 DOM (同 manager 工作流, 首选) + growth-data 拉净值; `__NUXT_DATA__` 内联 JSON (~86KB, Nuxt 扁平需引用解析器) 作更稳备选 + 提供 secId。**不用逆向一堆 XHR** —— 数据已在页面里。
- **架构影响**: 25 字段排序选不出真 α → ranker 重构为两段 (粗排 25 字段 → 详情抓宽池 → Brinson 精排)。API 免费所以抓宽池只受**限速**约束 (非成本)。
- **修复**: 列表行此前只有 6 位 id 没详情链接 → `normalizeRow` 确定性合成 `detailUrl`, schema 设必填+pattern, 34 tests green, 今日 402 快照 + 308 候选本地回填 (store gitignored)。commit `a372cd3`。
- **产出**: `research/funds/docs/fund-detail-api.md` (详情页 API + 提取 + 字段清单, 平行 `screener-filters.md`)。PLAN 阶段排序更新: `parse-fund.js` (详情抓取) 成下一要务, ranker 改两段。
- **安全**: 网络抓包含 live JWT/cookie, 仅响应体落 gitignored `research/funds/tmp/`, 请求头 (含 token) 未落任何 tracked 文件、未 echo。
