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
| 1 | `/cn-api/v2/funds/<id>/growth-data` | POST | **NAV time series + rolling returns + dividends + manager-change events** | Body needs **secId** (e.g. `F00001LXG1`), NOT the 6-digit id. See §5. |
| 2 | `/cn-api/v2/manager/return?managerId=<mgrId>` | GET | Manager's calendar-year total returns vs 沪深300, 任职以来 | Optional `&period=&broadCategory=` filters. |
| 3 | `/cn-api/user/getUserInfo` | GET | auth state | Ignore. |
| 4 | `/v1/write/rum` | POST | telemetry (RUM) | Ignore. |
| 5 | `/ssr-assets/builds/meta/<uuid>.json` | GET | SSR build manifest | Build metadata; not fund data. |

### 2.1 `growth-data` (the NAV pull)

```
POST /cn-api/v2/funds/006502/growth-data
body: {
  growthDataPoint: "cumulativeReturn",
  initValue: 10000, freq: "1d", currency: "CNY", type: "return",
  calcBmkSecId: "F00001LXG1",   // ← secId, not 6-digit id
  bmk1SecId:    "F00001LXG1",
  catAvgSecId:  "CHCA000035",   // category-average secId
  startDate: "2021-06-19", endDate: "2026-06-18",
  outputs: ["tsData","pr","dividend","management"]
}
resp.data: { startDate, endDate, cur, secIds, tsData, pr, rollingReturn,
             dividend, management, managerChangeEvents }
```

`tsData` = the NAV curve (fund + benchmark + category-average series, keyed by `secIds`).
`rollingReturn` = rolling-window returns (risk analysis). `managerChangeEvents` = manager tenure
changes (manager-stability signal). Sample response saved at `engine/tmp/growth-data-006502.response.*`.

---

## 3. Extraction strategy

Two paths; **primary is the rendered DOM** (proven, matches the manager workflow).

### 3.1 PRIMARY — parse the rendered DOM (innerText)

The dossier is server-rendered and section-delimited. Load `/fund/<id>.html`, dump
`document.body.innerText`, parse by section headers (回归% / 资产类型 / 投资组合 / 股票代码 / …).
This is the same pattern as `research/managers/scripts/parse-manager.js`. **Start here.**

> **Known parsing gotcha (prior discovery — memory `morningstar-fund-detail-layouts`):** the
> performance section emits **3 period-label layout variants (7 / 8 / 9 columns)** depending on fund
> age/history. The parser must handle all three, not assume a fixed column count. Brinson methodology
> background: memory `morningstar-alpha-attribution`.

### 3.2 SECONDARY — parse `__NUXT_DATA__` (more robust, build-phase)

```html
<script id="__NUXT_DATA__" type="application/json"> … </script>
```

The structured Nuxt payload (~86 KB), a flattened array with reference indices (root at index 1; fund
data nested under `data[2]`). Requires a reference resolver (Nuxt 3 deserialize). Field **keys** are
more stable than display **labels**, so this is the more robust long-term path — but invest in the
resolver during `parse-fund.js` build, not before.

> **`__NUXT_DATA__` is the authoritative source for `secId`** (needed by growth-data) — it is NOT in
> the rendered HTML. Either resolve it from `__NUXT_DATA__` or capture it from the page's JS state.

---

## 4. Field inventory by section (the dossier map)

Discovered on `006502`. Each section's rows are clearly delimited in the DOM.

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

## 5. `secId` — the growth-data key

`growth-data` is keyed by **secId** (e.g. `F00001LXG1`), not the 6-digit fund id. The page knows the
fund's secId to call growth-data; it lives in `__NUXT_DATA__` / page JS state, **not** in the rendered
HTML. `catAvgSecId` (e.g. `CHCA000035`) = category-average secId.

**Build action:** `parse-fund.js` must capture `secId` from the page (resolve `__NUXT_DATA__` or read
the growth-data request the page itself issues) and persist it on the fund JSON so the NAV pull can be
replayed standalone.

---

## 6. Throttling (bulk scrape)

The API is free, but be a polite crawler: `parse-fund.js`'s bulk driver should use a **configurable
inter-request delay + small concurrency cap** to avoid rate-limiting / IP blocks. (One-fund discovery
needs no throttle; the N-fund Plan 2 sweep does.)

---

## 7. Artifacts & tooling

| Artifact | Role | Location |
|---|---|---|
| This map | detail-page API + extraction spec | `engine/docs/fund-detail-api.md` |
| Detail scraper (build next) | `/fund/<id>.html` → fund JSON | `engine/analyze/parse-fund.js` (TODO) |
| NAV puller (build next) | growth-data → NAV series | (part of parse-fund / Plan 2) |
| Sample growth-data response | response-shape reference | `engine/tmp/growth-data-006502.response.*` (gitignored) |
| Live capture | chrome-devtools MCP (`new_page` + `evaluate_script` + `list_network_requests`) | browser |
| Row deep link | `detailUrl` on every snapshot/candidate row | `core/client.js` normalizeRow |

---

## 8. Open questions (resolve during `parse-fund.js` build)

- Brinson: full decomposition — is it 行业配置 + 个股选择 only, or also 地区配置 / interaction term? (Observed 行业 + 个股 on 006502; confirm across funds.)
- `__NUXT_DATA__` reference resolver: write a Nuxt-3 deserialize + map the fund-data subtree to field keys (the robust path; supersedes innerText long-term).
- `secId` extraction: confirm the exact `__NUXT_DATA__` path or the page-JS hook (`window.__updateFundPage` was seen) that exposes it.
- `pr` / `rollingReturn` / `management` sub-shapes in growth-data (characterize when building the NAV puller).
- Diversification of the Brinson signal across sleeves (does the defensive sleeve's Brinson look structurally different?).
