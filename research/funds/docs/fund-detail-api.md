# Fund Detail Page — API & Extraction Map

> **What this is.** The discovery map for the **fund detail page** (`/fund/<id>.html`): where the data
> lives (SSR DOM vs XHR), which endpoints carry what, and how to extract a complete per-fund research
> dossier. This is the input spec for `parse-fund.js` (Plan 2 deep-scrape).
>
> **Companion docs.** `screener-filters.md` = the **search/es** field inventory (the 25-field coarse
> list). `screener-filter-discovery-methodology.md` = the **method** (3-source discovery). This doc =
> the **detail page** (the rich per-fund dossier that fills every gap the coarse list leaves).
>
> **Status.** Discovered 2026-06-21 on `006502` (财通集成电路产业股票A). The `/fund/<id>.html` route is
> confirmed live; the legacy `/quicktake/<id>` route is **dead** (redirects to a maintenance page).
> **Updated 2026-06-21:** `__NUXT_DATA__` values confirmed **encrypted** (§3.2) — not a read path;
> `secId` source corrected to the Nuxt runtime / growth-data request body (§5).

---

## 1. The detail page

```
URL    : https://www.morningstar.cn/fund/<6-digit-id>.html      ← deterministic from id
Form   : Nuxt SSR — the dossier is server-rendered into HTML
Load   : only 2 data XHRs fire on load (growth-data + manager/return); the rest is already in the DOM
Dead   : /quicktake/<id>  → 404/maintenance  (do NOT use)
```

The snapshot row now persists this URL as `detailUrl` (`core/client.js` normalizeRow), so the
deep-scrape step navigates directly — no route re-derivation. See commit `a372cd3`.

**What this gives that the 25-field search/es row cannot:** Brinson attribution (true α), downside
capture, calendar-year returns (bear survival), α/β/R²/TE/information ratio, Sharpe/Sortino/Calmar,
top-10 holdings with codes+weights, sector allocation vs benchmark, manager tenure + skin-in-the-game,
holder structure, full fee schedule. I.e. the entire north-star research dossier.

---

## 2. The data endpoints (observed on load)

Same Layer1 base (`/cn-api/v2/`) and JWT `token` header as `search/es`. `response_status` is the
string `"200011"`.

| # | Endpoint | Method | Carries | Notes |
|---|---|---|---|---|
| 1 | `/cn-api/v2/funds/<id>/growth-data` | POST | **NAV time series + rolling returns + dividends + manager-change events** | Keyed by the **6-digit id** in the path (live-confirmed 2026-06-21 on 017730); body carries benchmark ids only. **No F00 secId needed.** See §5. |
| 2 | `/cn-api/v2/manager/return?managerId=<mgrId>` | GET | Manager's calendar-year total returns vs 沪深300, 任职以来 | Optional `&period=&broadCategory=` filters. |
| 3 | `/cn-api/user/getUserInfo` | GET | auth state | Ignore. |
| 4 | `/v1/write/rum` | POST | telemetry (RUM) | Ignore. |
| 5 | `/ssr-assets/builds/meta/<uuid>.json` | GET | SSR build manifest | Build metadata; not fund data. |

### 2.1 `growth-data` (the NAV pull)

```
POST /cn-api/v2/funds/<6-digit-id>/growth-data        ← keyed by the 6-digit id in the PATH
body: {
  growthDataPoint: "cumulativeReturn",
  initValue: 10000, freq: "1d", currency: "CNY", type: "return",
  calcBmkSecId: "PBMK",         // benchmark placeholder (NOT the fund secId)
  bmk1SecId:    "PBMK",
  catAvgSecId:  "CHCA000006",   // category-average secId
  startDate: "2021-06-19", endDate: "2026-06-18",
  outputs: ["tsData","pr","dividend","management"]
}
resp.data: { startDate, endDate, cur, secIds:["<6-digit-id>"], tsData, pr, rollingReturn,
             dividend, management, managerChangeEvents }
```

`tsData` = the NAV curve (fund + benchmark + category-average series, keyed by `secIds`).
`rollingReturn` = rolling-window returns (risk analysis). `managerChangeEvents` = manager tenure
changes (manager-stability signal) **and carries `managerId` for free** (→ drives the `mgr-*` family).
Sample response saved at `research/funds/tmp/growth-data-006502.response.*`.

---

## 3. Extraction strategy

**One viable read path: the rendered DOM.** `__NUXT_DATA__` keys are visible but its **values are
encrypted** (§3.2), so it is not a read path. The growth-data / manager/return XHRs supplement the DOM
(NAV series + manager events) but are not the dossier.

### 3.1 PRIMARY — parse the rendered DOM (innerText)

The dossier is server-rendered and section-delimited. Load `/fund/<id>.html`, dump
`document.body.innerText`, parse by section headers (回归% / 资产类型 / 投资组合 / 股票代码 / …).
This is the same pattern as `research/managers/scripts/parse-manager.js`. **Start here.**

> **Known parsing gotcha (prior discovery — memory `morningstar-fund-detail-layouts`):** the
> performance section emits **3 period-label layout variants (7 / 8 / 9 columns)** depending on fund
> age/history. The parser must handle all three, not assume a fixed column count. Brinson methodology
> background: memory `morningstar-alpha-attribution`.

### 3.2 `__NUXT_DATA__` — keys visible, **values encrypted** (NOT a read path)

```html
<script id="__NUXT_DATA__" type="application/json"> … </script>
```

The Nuxt-3 SSR payload (~86 KB) is a flattened devalue array. The structure is fully legible:

- **Root** `["ShallowReactive", 1]` → `{data, state, once, _errors, serverRendered, path}`.
- **`data`** → `{fund-data, fund-strategy-report-strategies-data, fund-strategy-report-outlooks-data,
  fund-manager-data, fund-doc-data}`.
- **`state`** → 22 `$sfund-*` section keys (the authoritative section inventory — see §4).

The **section keys are stable**: byte-for-byte identical across an A-share equity fund (006502) and a
QDII offshore fund (017730). So the `$sfund-*` keys are the most reliable **section checklist**, far
more stable than the Chinese display labels in the DOM.

**But every VALUE is an encrypted opaque blob** (e.g. `fund-data` = a 14 962-char string; decodes to
~21 KB binary, no compression magic, printable-ratio 0.37). The decrypt routine lives in the page's JS
chunk; the decrypted form appears **only in the rendered DOM**. So `__NUXT_DATA__` is **not** a usable
extraction path — it would require reverse-engineering the client decryption, which contradicts the
project's "don't RE the XHRs — the data is already in the page" principle. Confirmed 2026-06-21.

> **Use the `$sfund-*` keys only as a section checklist** when writing the DOM parser (so a missing
> section is a *detected* absence, not a silent miss). Revisit decryption ONLY if a section disappears
> from the rendered DOM but survives in `__NUXT_DATA__` (no such case observed).

---

## 4. Field inventory by section (the dossier map)

Discovered on `006502`. Each section's rows are clearly delimited in the DOM. The Chinese headers here
are the **display labels**; the stable **machine identifiers** are the `$sfund-*` keys in
`__NUXT_DATA__` (§3.2) — prefer those as the parser's section anchors when a label is ambiguous.

### 业绩 Performance
- **年度回报** (calendar-year): per year `[本基金, 同类平均, 业绩比较基准, 四分位排名, 百分位排名, 同类基金数量]`. ← **bear-survival** signal (e.g. 2022).
- **过往回报** (trailing): `[近一月, 近三月, 近六月, 近一年, 近两年, 近三年, 近五年, 今年以来]` × same 6 rows.

### 风险 Risk
- **性价比**: 夏普比率, 卡玛比率 (Calmar), 索提诺比率 (Sortino) — each `优于X%同类` + 本基金 + 同类平均.
- **风险和波动**: 标准差, 最大回撤, 下行风险, 晨星风险 — each `优于X%同类` + 本基金 + 同类平均.
- **相对收益** (vs benchmark, e.g. 中证信息全收益): Alpha, Beta, R², 超额收益, 跟踪误差, 信息比率, 月度胜率, **涨势捕获率 (upCapture)**, **跌势捕获率 (downCapture)** — each `优于X%同类` + 本基金.

### 业绩归因 Brinson attribution ← **the true-α signal**
- **超额收益 = 行业配置 (sector allocation) + 个股选择 (stock selection)**.
- `006502`: 超额 144% = 行业 −9.8% + 个股 +154% → a pure stock-picker (true α, not sector β).

### 投资组合 Portfolio
- **资产类型**: 股票/债券/现金/商品/其他 (%) + 同类平均.
- **股票持仓 (cap)**: 中国大盘/中盘/小盘/美国/发达/新兴.
- **债券持仓 / 商品持仓**: sub-breakdowns.
- **行业配置 vs 基准** (with +/-): 周期性/基础材料/可选消费/金融服务/房地产/敏感性/通信服务/能源/工业/科技/防御性/必选消费/医疗保健/公用事业.
- **地区配置 vs 基准**: 大亚洲/发达亚洲/新兴亚洲/美洲/北美/拉美/大欧洲/…
- **前十持仓**: 股票代码/股票名称/晨星行业/风格箱/占净值/占比变动/重仓季度.

### 持有人 Holders
- 机构 / 个人 占比.

### 基金经理 Manager
- 任职时间线 (start, 管理X年Y天, category).
- 在管产品 (基金名称/代码/管理期).
- **内部持有 (skin-in-the-game)**: 高管投研 / 内部员工 / 管理人 holdings per product.

### 费用 Fees
- 管理费 / 托管费 / 销售服务费 / 综合费率 / 最小投资额 / 申购费 (tiers) / 赎回费 (tiers).

### 基金公告 Announcements
- 定期报告 / 年度 / 季度报告 list.

### 经理业绩 (via `manager/return`)
- 历年总回报 vs 沪深300 + 任职以来 (total since-inception).

---

## 5. No `secId` needed — the 6-digit id is the key

**CORRECTION 2026-06-21 (live test on 017730):** `growth-data` is keyed by the **6-digit fund id in
the URL path** (`/cn-api/v2/funds/<id>/growth-data`), and the response returns the fund's series under
`secIds:["<6-digit-id>"]`. The request body's `calcBmkSecId`/`bmk1SecId` are **benchmark placeholders**
(observed `"PBMK"`), not the fund's secId. So the earlier "needs F00 secId (e.g. `F00001LXG1`)"
premise was an **unverified assumption — drop it.** The 6-digit id already on every snapshot row is
sufficient for the NAV pull. (`catAvgSecId`, e.g. `CHCA000006`, = category-average.)

**managerId** (needed for the `mgr-*` family) is also free: it appears in `growth-data` →
`managerChangeEvents[].managerId` and in the `manager/return?managerId=<id>` URL the page issues. No
separate lookup. The F00-style secId is simply not on the critical path — this removes the entire
secId-acquisition dependency from the build.

---

## 6. Throttling (bulk scrape)

The API is free, but be a polite crawler: `parse-fund.js`'s bulk driver should use a **configurable
inter-request delay + small concurrency cap** to avoid rate-limiting / IP blocks. (One-fund discovery
needs no throttle; the N-fund Plan 2 sweep does.)

---

## 7. Artifacts & tooling

| Artifact | Role | Location |
|---|---|---|
| This map | detail-page API + extraction spec | `research/funds/docs/fund-detail-api.md` |
| **Layout-variance spec** | empirical 18-fund corpus map (7/8/9 cols, Brinson-null, tickers) | `research/funds/docs/fund-detail-layouts.md` |
| **Detail scraper** | `/fund/<id>.html` innerText → page-structure-aligned dossier (8 section extractors + orchestrator) | `research/funds/analyze/parse-fund.js` (v2.0.0) |
| **Section extractors** | one extractor per page TAB (description/performance/risk/fees/portfolio/holders/manager/strategy) | `research/funds/analyze/sections/*.js` |
| **Shared helpers** | line helpers shared by all sections | `research/funds/analyze/shared.js` |
| **Dossier schema** | page-tab-aligned + versioned; strict on ~7 ranker fields | `research/funds/core/schemas/fund-dossier.schema.json` (v2.0.0) |
| **NAV puller** | growth-data → daily cumulative-return series (Node half) | `research/funds/ingest/pull-nav.js` |
| Sample growth-data response | response-shape reference | `research/funds/tmp/growth-data-006502.response.*` (gitignored) |
| Live capture | chrome-devtools MCP (`new_page` + `evaluate_script` + `list_network_requests`) | browser |
| Row deep link | `detailUrl` on every snapshot/candidate row | `core/client.js` normalizeRow |

---

## 8. Open questions (resolve during `parse-fund.js` build)

- ~~Brinson: full decomposition — 行业配置 + 个股选择 only, or also 地区配置 / interaction term?~~ — **RESOLVED 2026-06-21:** 行业配置 + 个股选择 only (no interaction term). Confirmed across the 18-fund corpus: 超额 ≈ 行业 + 个股 holds with Δ<0.5 on every real-Brinson fund (see `fund-detail-layouts.md` §4). Null (no decomposition) on ETF/QDII/HK funds.
- ~~`__NUXT_DATA__` reference resolver~~ — **RESOLVED 2026-06-21:** values are encrypted, not a read path (§3.2). Keys serve only as a section checklist.
- ~~`secId` extraction~~ — **RESOLVED 2026-06-21:** from the Nuxt runtime (`useNuxtApp`/`__updateFundPage`) or the growth-data request body (§5); NOT from `__NUXT_DATA__`.
- ~~`pr` / `rollingReturn` / `management` sub-shapes in growth-data~~ — **PARTIALLY RESOLVED 2026-06-21:** `research/funds/ingest/pull-nav.js` captures `pr` (period-return summary: return/annulized/startValue/endValue per series), `rollingReturn`, `dividend[]`, and `managerChangeEvents[]` (carries `managerId` for free). Full per-field characterization deferred to backtest integration.
- Diversification of the Brinson signal across sleeves (does the defensive sleeve's Brinson look structurally different?).
