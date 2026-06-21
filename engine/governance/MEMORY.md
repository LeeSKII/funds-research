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
