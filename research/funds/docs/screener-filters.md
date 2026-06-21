# Morningstar.cn Fund Screener — Definitive Filter Reference

> **Purpose.** Let a future automation agent configure the daily `/cn-api/v2/search/es` query against the Morningstar China fund screener **without re-discovering anything**. Built from three ground-truth inputs — (1) a static bundle archaeology of `screener.js` (the field catalog), (2) a rendered DOM walk of the sidebar (the UI map), (3) a live `search/es` differential-probe sweep against a 506-fund BASELINE (empirical validation). Where they disagree, the disagreement is stated explicitly and the **empirical** result wins for the wire format.
>
> **Scope.** The custom screener at `https://www.morningstar.cn/#/screener/local/my/...` — the left data-point picker panel (`.screener-dp-panel`) that produces the POST body of `search/es`. Not the simple screener, not the fund-detail page, not the manager page.
>
> **Date of probe sweep:** 2026-06-21. **Engine production filter:** `research/funds/core/config/universe.json` (`search_filter` key → 506 funds = the validation BASELINE).

---

## 1. Overview

### What the screener filters

The screener is a **7-group filter panel** (基本信息 / 业绩指标 / 持仓分析 / 费用 / 基金公司 / 基金经理 / 关键字) whose state is serialized into the body of one POST. Each filter is a top-level key in the JSON request body. The server returns matched funds plus a `count` of the full match.

### The endpoint

```
POST https://www.morningstar.cn/cn-api/v2/search/es?source=local
Headers: token: <RS256 JWT>, Content-Type: application/json
Body: { "<dpKey>": "<value>", ..., "sign": "1" }
```

- `?source=local` is mandatory (omit → wrong response shape). `?source=global` switches to the global-universe filter set (different `globalCategoryId`/bond-bucket codes).
- `token` is an RS256 JWT harvested from a logged-in browser's `localStorage['token']` (~14-day expiry, see `research/funds/secrets/token.json`).
- `sign` is **not** a body checksum — its presence/absence changes nothing; send `"sign":"1"`.
- `response_status` is a **string** `"200011"`, not a number. Compare with `String(...) !== '200011'`.

### The 1000-row cap (the central constraint)

```
data.count = total matches (whole market ≈ 10000)
data.rows  = first 1000 rows (hard cap, no pagination)
```

There is **no pagination cursor** in the response; every conventional paging param (page/pageNo/pageIndex/current/start/offset, in both query and body) is ignored — the same `firstId` is returned. The pagination mechanism is opaque (likely server-state locked behind `sign`).

**Therefore automation = server-side filtering.** Push the screening criteria into the request body so a single call returns the entire candidate set (≤1000 rows = `count`). The engine's daily filter (506 funds) leaves ~500 rows of headroom for new funds per day.

### Server-side vs client-side (the critical distinction for automation)

Two qualitatively different "filters" exist in this screener:

1. **Real `search/es` criteria keys** — honored by the ES backend, narrow `data.count`. **These are the only thing automation should send.** Validated empirically in Section 5a.
2. **Client-side-only / UI-composite keys** — appear in `screener.js` and render in the sidebar, but the server **silently ignores them** (probe: `withBase` count stays at baseline AND `alone` count == empty 10000). They are either (a) UI group-switch containers that the front-end fans out into per-period sub-keys before submit, or (b) post-fetch display/derivation columns. **Sending these wastes body bytes and does nothing.** Section 5b lists every one.

The empirical validation distinguishes them rigorously: a "no-op" key leaves both `withBase` and `alone` counts identical to their references; a real-but-empty-data key returns 0 for an all-encompassing range (`0~100` alone → 0, not 10000); a working key changes count. All three signatures appear below.

### Where the static schema lives

There is **no `/config` or `/criteria` endpoint**. The field schema is a single ~29KB object-literal array embedded in the minified `screener.js` bundle (byte offset 38418–67790, anchored at `let t=[{label:\`基本信息\`...`). The 3 `/cn-api/v2/template/*` paths are user-saved-filter CRUD only (GET `config-list` returns saved blobs, not a schema). The bundle IS the schema; the engine keeps a parsed copy at `research/funds/tmp/filter-block.json`.

---

## 2. Master filter table

**Sort order:** server-respected first (A–Z within tier), then client-side / non-functional, then unresolved. `value type` is the empirically-confirmed wire shape (overriding the catalog where they disagree). `aut` (automation) = whether the key is safe to push into the daily query body.

### 2.1 Server-respected — safe for the daily query body

| key | 中文 label | UI group | wire format (empirical) | legal values / examples | aut |
|---|---|---|---|---|---|
| `alphaToIndRankP_1Y` | 阿尔法排名/一年 | 业绩指标/阿尔法 | percentile range-string | `"<5"`, `"0~5"` (= top 5%); both equivalent | ✅ |
| `alphaToIndRankP_3Y` | 阿尔法排名/三年 | 业绩指标/阿尔法 | percentile range-string | `"0~5"`, `"<5"`, `"0~50"` (BASE uses `0~50`) | ✅ |
| `alphaToIndRankP_5Y` | 阿尔法排名/五年 | 业绩指标/阿尔法 | percentile range-string | `"0~5"` etc. | ✅ |
| `alphaToIndRankP_10Y` | 阿尔法排名/十年 | 业绩指标/阿尔法 | percentile range-string | `"0~5"` etc. | ✅ |
| `alphaToInd_1Y` | 阿尔法/一年 | 业绩指标/阿尔法 | range-string (raw %) | `">5"`, `"0~2"`, `"<0"` | ✅ |
| `alphaToInd_3Y` | 阿尔法/三年 | 业绩指标/阿尔法 | range-string (raw %) | same | ✅ |
| `alphaToInd_5Y` | 阿尔法/五年 | 业绩指标/阿尔法 | range-string (raw %) | same | ✅ |
| `alphaToInd_10Y` | 阿尔法/十年 | 业绩指标/阿尔法 | range-string (raw %) | same (very thin coverage) | ✅ |
| `applyingMaxIv` | 申购限制 | 基本信息 | **array of numeric-threshold strings** | `["100"]`, `["1000"]`, `["10000"]` (NOT the catalog's range-string — see §4) | ⚠️ |
| `aum` | 管理规模 (经理) | 基金经理 | range-string (unit: 亿元) | `"10~50"`, `">100"`, `"<1"` | ✅ |
| `bBd_1and11` | 债券券种/国债及地方政府债 | 持仓分析/债券券种分布 | range-string (weight %) | `"50~100"`, `">50"`, `"0~50"` | ✅ |
| `bBd_2` | 债券券种/金融债 | 持仓分析/债券券种分布 | range-string (weight %) | `"50~100"`, `">50"` | ✅ |
| `bBd_3and8and10` | 债券券种/公司债 | 持仓分析/债券券种分布 | range-string (weight %) | same | ✅ |
| `bBd_4` | 债券券种/可转债 | 持仓分析/债券券种分布 | range-string (weight %) | same | ✅ |
| `bBd_6` | 债券券种/ABS | 持仓分析/债券券种分布 | range-string (weight %) | same | ✅ |
| `bBd_12` | 债券券种/同业存单 | 持仓分析/债券券种分布 | **closed range-string only** | `"1~10"`, `"10~100"`, `"1~100"`; bare `>N`/`<N`/scalar ignored | ⚠️ |
| `betaToIndRankP_1Y/3Y/5Y/10Y` | 贝塔排名/* | 业绩指标/贝塔 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `betaToInd_1Y/3Y/5Y/10Y` | 贝塔/* | 业绩指标/贝塔 | range-string (decimal) | `"0~0.5"`, `">1.5"`, `"0.9~1.1"` | ✅ |
| `bondAsset` | 债券占比(不穿透) | 持仓分析/资产配置分布 | range-string (weight %) | `"0~20"`, `">80"` | ✅ |
| `bondAssetPenetrate` | 债券占比(穿透) | 持仓分析/资产配置分布 | range-string (weight %) | same (independent of bondAsset) | ✅ |
| `broadCategoryId` | 资产大类 | 基本信息 | array of `$BCG$*` codes | `["$BCG$EQUTY"]`, `["$BCG$ALLOC","$BCG$FXINC"]` (multi-value items comma-split before send) | ✅ |
| `broadCategoryNameCN` | 资产大类 (CN name form) | 基本信息 | **array of Chinese names** | `["股票"]`, `["股票","混合"]` (yes — server honors CN names directly; see §4) | ✅ |
| `broadCategorySizeAllExMm` | 管理规模/非货币规模 | 基金公司/管理规模 | range-string (raw 亿元) | `">500"`, `"0~50"` | ✅ |
| `broadCategorySizeAllExMmRank` | 管理规模/非货币规模(排名) | 基金公司/管理规模 | range-string (integer rank) | `"1~5"`, `"50~100"` | ✅ |
| `broadCategorySizeEquity` | 管理规模/权益 | 基金公司/管理规模 | range-string (raw 亿元) | `">100"`, `"0~10"` | ✅ |
| `broadCategorySizeEquityRank` | 管理规模/权益(排名) | 基金公司/管理规模 | range-string (integer rank) | `"1~50"`, `"1~10"` ⚠️ **aliased to broadCategorySizeFixIncomeRank** — do not combine | ✅ |
| `broadCategorySizeFixIncome` | 管理规模/固收 | 基金公司/管理规模 | range-string (raw 亿元) | `">100"`, `"0~10"` (distinct from equity) | ✅ |
| `broadCategorySizeFixIncomeRank` | 管理规模/固收(排名) | 基金公司/管理规模 | range-string (integer rank) | same shape ⚠️ **identical backend column to Equity rank** | ✅ |
| `careerYear` | 投资年限 (经理) | 基金经理 | range-string `">N"` (years) | `">5"`, `">10"` | ✅ |
| `cashAsset` | 现金占比(不穿透) | 持仓分析/资产配置分布 | range-string (weight %) | `"0~20"`, `">50"` | ✅ |
| `cashAssetPenetrate` | 现金占比(穿透) | 持仓分析/资产配置分布 | range-string (weight %) | same (independent of cashAsset) | ✅ |
| `categoryId` | 晨星分类 (local) | 基本信息 | array of category codes | `["CHCA000051"]`, `["PGSZ04TTTT","CHCA000002"]` | ✅ |
| `closeOpenPeriod` | 锁定期 | 基本信息 | **array of numeric-year strings** | `["1"]`, `["3"]` (NOT the catalog's range-string — see §4) | ⚠️ |
| `companyName` | 公司名称 | 基金公司 | **array of full company names** | `["易方达基金"]` (scalar/object rejected with 400001) | ✅ |
| `custodianRatio` | 托管费 | 费用/显性费率 | range-string (%, step .01) | `"0~0.2"`, `">0.5"` | ✅ |
| `distibutionFee` | 销售服务费 | 费用/显性费率 | range-string (%) — **key misspelled** | `"0~0.1"`, `">0.5"` (do NOT "fix" to `distributionFee`) | ✅ |
| `downCaptureRatioRankP_1Y/3Y/5Y/10Y` | 跌市捕获比排名/* | 业绩指标/跌市捕获比 | percentile range-string | `"0~30"`, `"90~100"` (0 = best downside defense) | ✅ |
| `downCaptureRatio_1Y/3Y/5Y/10Y` | 跌市捕获比/* | 业绩指标/跌市捕获比 | range-string (decimal) | `"0~0.8"`, `"0~2"` (coverage sparse in BASE) | ✅ |
| `enhancedIndexFund` | 指数增强 | 基本信息/重要属性 | boolean string | `"true"`, `"false"` | ✅ |
| `excessPb120mPer` | 超额收益/近120月(原始值) | 业绩指标/超额收益 | range-string (raw %) | `">0"`, `"<0"`, `"lo~hi"` | ✅ |
| `excessPb120mRankPer` | 超额收益/近120月(排名) | 业绩指标/超额收益 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `excessPb12mPer` | 超额收益/近12月(原始值) | 业绩指标/超额收益 | range-string (raw %) | `"0~5"`, `">5"` | ✅ |
| `excessPb12mRankPer` | 超额收益/近12月(排名) | 业绩指标/超额收益 | percentile range-string | `"0~50"`, `"50~100"`, `"<10"` | ✅ |
| `excessPb36mPer` | 超额收益/近36月(原始值) | 业绩指标/超额收益 | range-string (signed %) | `"-100~-10"`, `"10~100"`, `">20"` | ✅ |
| `excessPb36mRankPer` | 超额收益/近36月(排名) | 业绩指标/超额收益 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `excessPb60mPer` | 超额收益/近60月(原始值) | 业绩指标/超额收益 | range-string (signed %) | same as 36m | ✅ |
| `excessPb60mRankPer` | 超额收益/近60月(排名) | 业绩指标/超额收益 | percentile range-string | same | ✅ |
| `exchangeTradedShare` | ETF | 基本信息/基金组别 | boolean string | `"true"`, `"false"` | ✅ |
| `fundName` | 关键字 | 关键字 | scalar keyword string | `"成长"`, `"医疗"` (substring/fuzzy match) | ✅ |
| `fundOfFunds` | FOF | 基本信息/重要属性 | boolean string | `"true"`, `"false"` | ✅ |
| `fundSize` | 基金规模 | 基本信息 | array of range-strings (or single) | `["0~1"]`, `["2~5","5~10","50~100",">100"]`; UI `0~1:0~1亿` colon form also accepted | ✅ |
| `gSSBd_max` | 第一大股票行业权重 | 持仓分析 | range-string (weight %) | `"0~50"` | ✅ |
| `gSSBd_101` | 股票行业/基础材料 | 持仓分析/股票行业占比 | range-string (weight %) | `"0~10"`, `">30"` | ✅ |
| `gSSBd_102` | 股票行业/可选消费 | 持仓分析/股票行业占比 | range-string (weight %) | `"0~10"`, `">30"` | ✅ |
| `gSSBd_103` | 股票行业/金融服务 | 持仓分析/股票行业占比 | range-string (weight %) | `"50~100"` etc. | ✅ |
| `gSSBd_104` | 股票行业/房地产 | 持仓分析/股票行业占比 | range-string (weight %) | same | ✅ |
| `gSSBd_205` | 股票行业/必选消费 | 持仓分析/股票行业占比 | range-string (weight %) | same | ✅ |
| `gSSBd_206` | 股票行业/医疗保健 | 持仓分析/股票行业占比 | range-string (weight %) | same | ✅ |
| `gSSBd_207` | 股票行业/公用事业 | 持仓分析/股票行业占比 | range-string (weight %) | same | ✅ |
| `gSSBd_308` | 股票行业/通信服务 | 持仓分析/股票行业占比 | range-string (weight %) | `"0~100"`, `"10~100"` | ✅ |
| `gSSBd_309` | 股票行业/能源 | 持仓分析/股票行业占比 | range-string (weight %) | same | ✅ |
| `gSSBd_310` | 股票行业/工业 | 持仓分析/股票行业占比 | range-string (weight %) | `"20~100"` etc. | ✅ |
| `gSSBd_311` | 股票行业/科技 | 持仓分析/股票行业占比 | range-string (weight %) | `"30~100"` etc. | ✅ |
| `gamaRatioRankP_1Y/3Y/5Y/10Y` | 卡玛比率排名/* | 业绩指标/卡玛比率 | percentile range-string | `"0~30"`, `"50~100"` | ✅ |
| `gamaRatio_1Y` | 卡玛比率/一年 | 业绩指标/卡玛比率 | percentile range-string (band form) | `"0~50"`, `"50~100"` (Calmar is itself rank-like here) | ✅ |
| `gamaRatio_3Y/5Y/10Y` | 卡玛比率/* | 业绩指标/卡玛比率 | range-string (raw value) | `"1~100"`, `">3"` (absolute Calmar value) | ✅ |
| `globalCategoryId` | 晨星分类 (global) | 基本信息 | array of `"$GC$CODE:中文"` | `["$GC$CHNEQY:大中华股票"]` | ✅ (global source only) |
| `hiddenCostRankPerByFund` | 隐性费率排名(公司) | 基金公司 | percentile range-string | `"0~50"`, `"0~30"` (very aggressive at 0~30) | ✅ |
| `hkWeighting` | 港股占比 | 持仓分析 | range-string (weight %) | `"0~20"`, `">80"` | ✅ |
| `ifClose` | 封闭式 | 基本信息/基金组别 | boolean string | `"true"`, `"false"` | ✅ |
| `ifOpen` | 开放式 | 基本信息/基金组别 | boolean string | `"true"`, `"false"` (BASE 506 are all ifOpen=true) | ✅ |
| `ihc` | 综合费率(原始值) | 费用/综合费率 | range-string (decimal %) | `"0~0.5"`, `"1.5~100"` | ✅ |
| `iHCRankPer` | 综合费率排名 | 费用/综合费率 | percentile range-string | `"0~10"`, `"90~100"` | ✅ |
| `inceptionDate` | 成立时间 | 基本信息 | range-string `">N"` (years) | `">5"`, `">10"` | ✅ |
| `indexFund` | 指数 | 基本信息/重要属性 | boolean string | `"true"`, `"false"` (BASE uses `false`) | ✅ |
| `individualInvestorsSharesPercentage` | 个人占比 | 基本信息/持有人结构 | range-string (percent) | `"90~100"` | ✅ |
| `infoPb120m` | 信息比率/近120月(原始值) | 业绩指标/信息比率 | range-string (signed) | `"-100~0"` | ✅ |
| `infoPb120mRankPer` | 信息比率/近120月(排名) | 业绩指标/信息比率 | percentile range-string | `"50~100"` etc. | ✅ |
| `infoPb12m` | 信息比率/近12月(原始值) | 业绩指标/信息比率 | range-string (signed) | `"-100~0"` | ✅ |
| `infoPb12mRankPer` | 信息比率/近12月(排名) | 业绩指标/信息比率 | percentile range-string | `"50~100"` etc. | ✅ |
| `infoPb36m` | 信息比率/近36月(原始值) | 业绩指标/信息比率 | range-string (signed) | same | ✅ |
| `infoPb36mRankPer` | 信息比率/近36月(排名) | 业绩指标/信息比率 | percentile range-string | same | ✅ |
| `infoPb60m` | 信息比率/近60月(原始值) | 业绩指标/信息比率 | range-string (signed) | same | ✅ |
| `infoPb60mRankPer` | 信息比率/近60月(排名) | 业绩指标/信息比率 | percentile range-string | same | ✅ |
| `institutionalInvestorsSharesPercentage` | 机构占比 | 基本信息/持有人结构 | range-string (percent) | `"50~100"` | ✅ |
| `longestTenure` | 最长任职时间 | 基本信息 | range-string (years) | `">3"` (BASE), `">2"`, `"<1"` | ✅ |
| `managementFee` | 管理费 | 费用/显性费率 | range-string (%, step .01) | `"0~0.5"`, `">2"` | ✅ |
| `managerCareerTime` | 平均投管经验 | 基金公司 | range-string (years) | `">5"`, `"0~3"` | ✅ |
| `managerOwnership10kshares` | 基金经理持有份额(万份) | 基本信息/持有人结构 | **bare enum-string** (NOT array) | `"0"`, `"1"`, `"2"`, `"3"`, `"4"`; array `["4"]` → 400001 | ✅ |
| `managerStayTime` | 平均任职时间 | 基金公司 | range-string (years) | `">5"`, `"0~1"` | ✅ |
| `masterFeeder` | 联接基金 | 基本信息/基金组别 | boolean string (ternary; only `"true"` selective) | `"true"`, `"false"` | ✅ |
| `maximumDrawdownRankP_1Y/3Y/5Y/10Y` | 最大回撤排名/* | 业绩指标/最大回撤 | percentile range-string | `"0~30"`, `"50~100"` (lower = smaller DD) | ✅ |
| `maximumDrawdown_1Y/3Y/5Y/10Y` | 最大回撤/* | 业绩指标/最大回撤 | range-string (negative %) | `"-10~-5"`, `"-100~-20"` | ✅ |
| `mRF` | 北上基金 | 基本信息/基金组别 | boolean string (ternary; only `"true"` selective) | `"true"`, `"false"` | ✅ |
| `oOCRankPer` | 其它运营成本排名 | 费用/隐性费率 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `ooc` | 其它运营成本(原始值) | 费用/隐性费率 | range-string (%) | `"0~0.5"`, `"0~1"` | ✅ |
| `oldestShareId` | 基本份额 | 基本信息/重要属性 | boolean string | `"true"` (collapses share classes to oldest) | ✅ |
| `personalPension` | 个人养老金 | 基本信息/基金组别 | boolean string | `"true"`, `"false"` | ✅ |
| `qDII` | QDII | 基本信息/基金组别 | boolean string | `"true"`, `"false"` | ✅ |
| `rating10Y` | 晨星评级/十年 | 业绩指标/晨星评级 | array of bare numeric strings | `["5"]`, `["3"]` | ✅ |
| `rating3Y` | 晨星评级/三年 | 业绩指标/晨星评级 | array of bare numeric strings | `["4","5"]` (BASE), `["3"]`, `["0"]`=unrated | ✅ |
| `rating5Y` | 晨星评级/五年 | 业绩指标/晨星评级 | array of bare numeric strings | `["4","5"]` (BASE) | ✅ |
| `retention1Y/3Y/5Y` | 留职率/* | 基金公司/留职率 | range-string (percent 0-100) | `"0~50"`, `"90~100"` | ✅ |
| `return1MonthRankP_M` | 基金排名/1个月 | 业绩指标/基金排名(月末) | percentile range-string | `"0~20"`, `"80~100"`, `"<10"` | ✅ |
| `return1Month_M` | 基金回报/1个月 | 业绩指标/基金回报(月末) | range-string (raw %) | `"10~10000"`, `"<-5"` | ✅ |
| `return1YearRankP_M` | 基金排名/一年 | 业绩指标/基金排名(月末) | percentile range-string | `"0~50"`, `"90~100"` | ✅ |
| `return1Year_M` | 基金回报/一年(年化) | 业绩指标/基金回报(月末) | range-string (raw %) | `"50~10000"`, `"<-20"` | ✅ |
| `return10YearRankP_M` | 基金排名/十年 | 业绩指标/基金排名(月末) | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `return10Year_M` | 基金回报/十年(年化) | 业绩指标/基金回报(月末) | range-string (raw %) | `">12"`, `"<0"` | ✅ |
| `return3MonthRankP_M` | 基金排名/3个月 | 业绩指标/基金排名(月末) | percentile range-string | `"0~20"`, `"80~100"` | ✅ |
| `return3Month_M` | 基金回报/3个月 | 业绩指标/基金回报(月末) | range-string (raw %) | `"20~10000"`, `"<-10"` | ✅ |
| `return3YearRankP_M` | 基金排名/三年 | 业绩指标/基金排名(月末) | percentile range-string | `"0~50"`, `"90~100"` | ✅ |
| `return3Year_M` | 基金回报/三年(年化) | 业绩指标/基金回报(月末) | range-string (raw %) | `">20"`, `"<0"` | ✅ |
| `return5YearRankP_M` | 基金排名/五年 | 业绩指标/基金排名(月末) | percentile range-string | `"0~50"`, `"90~100"` | ✅ |
| `return5Year_M` | 基金回报/五年(年化) | 业绩指标/基金回报(月末) | range-string (raw %) | `">15"`, `"<0"` | ✅ |
| `return6MonthRankP_M` | 基金排名/6个月 | 业绩指标/基金排名(月末) | percentile range-string | `"0~50"`, `"90~100"` | ✅ |
| `return6Month_M` | 基金回报/6个月 | 业绩指标/基金回报(月末) | range-string (raw %) | `"30~10000"`, `"<-15"` | ✅ |
| `return7YearRankP_M` | 基金排名/七年 | 业绩指标/基金排名(月末) | percentile range-string | **server-respected BUT current dataset returns 0 for all ranges** — DO NOT push | ❌ data-sparse |
| `return7Year_M` | 基金回报/七年(年化) | 业绩指标/基金回报(月末) | range-string (raw %) | `">15"`, `"<0"` | ✅ |
| `returnYTD_M` | 基金回报/今年以来 | 业绩指标/基金回报(月末) | range-string (raw %) | `"50~10000"`, `"<0"` | ✅ |
| `rSquaredToIndRankP_1Y/3Y/5Y/10Y` | R平方排名/* | 业绩指标/R平方 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `rSquaredToInd_1Y/3Y/5Y/10Y` | R平方/* | 业绩指标/R平方 | range-string (% 0-100) | `"80~100"`, `"0~50"`, `">50"` | ✅ |
| `sharpeRatioRankP_1Y/3Y/5Y/10Y` | 夏普比率排名/* | 业绩指标/夏普比率 | percentile range-string | `"0~5"`, `"0~50"`, `">95"` | ✅ |
| `sharpeRatio_1Y/3Y/5Y/10Y` | 夏普比率/* | 业绩指标/夏普比率 | range-string (raw decimal) | `"1~3"`, `"0~1"`, `"0~100"` | ✅ |
| `shareclassTna` | 份额规模 | 基本信息 | array of range-strings | `["0~1"]` etc. (per-share-class TNA, distinct from fundSize) | ✅ |
| `sTDRankP_1Y/3Y/5Y/10Y` | 标准差排名/* | 业绩指标/标准差 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `sTD_1Y/3Y/5Y/10Y` | 标准差/* | 业绩指标/标准差 | range-string (% 0-100) | `"0~10"`, `"20~30"` | ✅ |
| `sortinoRatioRankP_1Y/3Y/5Y/10Y` | 索提诺比率排名/* | 业绩指标/索提诺比率 | percentile range-string | `"0~50"`, `"0~25"` | ✅ |
| `sortinoRatio_1Y/3Y/5Y/10Y` | 索提诺比率/* | 业绩指标/索提诺比率 | range-string (raw decimal) | `">1"`, `"0~1"`, `"1~100"` | ✅ |
| `srDate` | 转型 | 基本信息/重要属性 | boolean string | `"true"` (转型 funds; 695 alone), `"false"` | ✅ |
| `stockAsset` | 股票占比(不穿透) | 持仓分析/资产配置分布 | range-string (weight %) | `"0~20"`, `">80"` | ✅ |
| `stockAssetPenetrate` | 股票占比(穿透) | 持仓分析/资产配置分布 | range-string (weight %) | same (independent of stockAsset — look-through adds FoF equity) | ✅ |
| `styleBox` | 晨星风格箱 | 持仓分析 | **array of bare numeric codes 1-9** | `["3"]`, `["1","4","7"]` (NOT `"3:大盘成长"` colon form — rejected) | ✅ |
| `subscription` | 申购状态 | 基本信息 | array of CN status labels | `["可申购"]`, `["不可申购"]`, `["限大额"]` | ✅ |
| `successRatio10Y` | 成功率/近十年 | 基金公司/成功率 | range-string (**percentile-rank semantics**) | `"0~50"`, `"0~30"` (lower = more successful) | ✅ |
| `successRatio3Y` | 成功率/近三年 | 基金公司/成功率 | range-string (percentile-rank semantics) | `"0~50"`, `"0~30"` (⚠️ `"80~100"` → 0; not a raw-percent field) | ✅ |
| `successRatio5Y` | 成功率/近五年 | 基金公司/成功率 | range-string (percentile-rank) | `"0~50"`, `"0~30"` | ✅ |
| `tagging` | 标签 | 基金经理 | array of CN tag strings (OR) | `["FOF持有"]`, `["晨星奖"]`, `["自购超百万份","晨星奖"]` | ✅ |
| `ter` | 运营净费率 | 费用 | range-string (%) | `"0~0.5"`, `"0~1"` | ✅ |
| `tERRankPer` | 年报运营费率排名 | 费用/年报运营费率 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `top10Holding` | 前十大股票集中度 | 持仓分析 | range-string (weight %) | `"0~20"`, `">80"` | ✅ |
| `totalRisk` | 风险等级 | 基本信息 | array of bare numeric strings (1-5) | `["1","2"]` (R1,R2), `["5"]` | ✅ |
| `trackPb120mPer` | 跟踪误差/近120月(原始值) | 业绩指标/跟踪误差 | range-string (raw %) | `"0~5"`, `"0~1"` (thin coverage) | ✅ |
| `trackPb120mRankPer` | 跟踪误差/近120月(排名) | 业绩指标/跟踪误差 | percentile range-string | `"50~100"` etc. | ✅ |
| `trackPb12mPer` | 跟踪误差/近12月(原始值) | 业绩指标/跟踪误差 | range-string (raw %) | `"0~5"`, `">5"` | ✅ |
| `trackPb12mRankPer` | 跟踪误差/近12月(排名) | 业绩指标/跟踪误差 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `trackPb36mPer` | 跟踪误差/近36月(原始值) | 业绩指标/跟踪误差 | range-string (raw %) | `"0~5"`, `"0~1"` | ✅ |
| `trackPb36mRankPer` | 跟踪误差/近36月(排名) | 业绩指标/跟踪误差 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `trackPb60mPer` | 跟踪误差/近60月(原始值) | 业绩指标/跟踪误差 | range-string (raw %) | same | ✅ |
| `trackPb60mRankPer` | 跟踪误差/近60月(排名) | 业绩指标/跟踪误差 | percentile range-string | same | ✅ |
| `ttc` | 交易成本(原始值) | 费用/隐性费率 | range-string (%) | `"0~0.5"`, `">2"` (the REAL 隐性 filter — use over `hiddenCost`) | ✅ |
| `tTCRankPer` | 交易成本排名 | 费用/隐性费率 | percentile range-string | `"0~50"`, `"50~100"` | ✅ |
| `ttcRankPerByFund` | 综合费率排名(公司) | 基金公司 | percentile range-string | `"0~50"`, `"0~30"` (very aggressive at 0~30) | ✅ |
| `turnover_Annu` | 股票换手率 | 持仓分析 | range-string (%, annualized) | `"0~100"`, `">1000"` | ✅ |
| `upCaptureRatioRankP_1Y/3Y/5Y/10Y` | 涨市捕获比排名/* | 业绩指标/涨市捕获比 | percentile range-string | `"0~50"`, `"0~10"` | ✅ |
| `upCaptureRatio_1Y/3Y/5Y/10Y` | 涨市捕获比/* | 业绩指标/涨市捕获比 | **range-string on PERCENTAGE scale (0-100)** | `"90~110"`, `">90"` (NOT ratio ~1.0 — see §4) | ✅ |

### 2.2 Client-side-only / non-functional — DO NOT push into the daily body

Every key below was empirically confirmed to be ignored by the server (probe: `withBase` count stays at baseline 506 AND `alone` count == empty 10000 — or for the bond-bucket globals, recognized but matches zero rows for every format). They are UI-composite group-switch containers or display columns.

| key | 中文 label | why it fails | correct substitute |
|---|---|---|---|
| `alphaToInd` | 阿尔法 (composite) | UI group-switch; no ES field | `alphaToInd_1Y/3Y/5Y/10Y` |
| `betaToInd` | 贝塔 (composite) | same | `betaToInd_1Y/3Y/5Y/10Y` |
| `cashEquivalents` | 债券券种/现金及等价物 | recognized but NULL for all ~10000 funds | no working substitute (data unpopulated) |
| `corporate` | 债券券种/公司债 (global) | recognized but NULL for all funds | use local `bBd_3and8and10` |
| `derivative` | 债券券种/衍生品 | recognized but NULL for all funds | no substitute |
| `downCaptureRatio` | 跌市捕获比 (composite) | UI composite | `downCaptureRatio_1Y/3Y/5Y/10Y` or `*RankP_*` |
| `excessPb` | 超额收益 (composite) | UI composite | `excessPb12mPer`/`*RankPer` etc. |
| `explicitCost` | 显性费率 (composite) | UI composite; even impossible ranges leave count unchanged | `managementFee`/`custodianRatio`/`distibutionFee` or `ihc` |
| `gamaRatio` | 卡玛比率 (composite) | UI composite | `gamaRatio_1Y/3Y/5Y/10Y` |
| `government` | 债券券种/政府债 (global) | recognized but NULL for all funds | use local `bBd_1and11` |
| `hiddenCost` | 隐性费率 (composite) | UI composite (derived post-fetch) | `ttc` + `ooc` |
| `infoPb` | 信息比率 (composite) | UI composite | `infoPb12m`/`*RankPer` etc. |
| `management` | 管理规模 (composite) | UI composite | `broadCategorySizeAllExMm` (+ `*Rank`) |
| `maxManagementFee` | 管理费(最高) | rejected key (0 for `>0` alone); real fee key is `managementFee` | `managementFee` |
| `maximumDrawdown` | 最大回撤 (composite) | UI composite | `maximumDrawdown_1Y/3Y/5Y/10Y` |
| `municipal` | 债券券种/市政债 (global) | recognized but NULL for all funds | no local equivalent |
| `rSquaredToInd` | R平方 (composite) | UI composite | `rSquaredToInd_1Y/3Y/5Y/10Y` |
| `securitized` | 债券券种/资产支持证券 (global) | recognized but NULL for all funds | use local `bBd_6` |
| `sTD` | 标准差 (composite) | UI composite | `sTD_1Y/3Y/5Y/10Y` |
| `sharpeRatio` | 夏普比率 (composite) | UI composite | `sharpeRatio_1Y/3Y/5Y/10Y` |
| `sortinoRatio` | 索提诺比率 (composite) | UI composite | `sortinoRatio_1Y/3Y/5Y/10Y` |
| `trackPb` | 跟踪误差 (composite) | UI composite | `trackPb12mPer`/`*RankPer` etc. |
| `upCaptureRatio` | 涨市捕获比 (composite) | UI composite | `upCaptureRatio_1Y/3Y/5Y/10Y` |
| `categoryName` | 晨星分类 (display) | display columnId only; CN names ignored | `categoryId` (codes) |
| `managerName` | 基金经理 (display) | metaData column; scalar/array both ignored | match client-side post-fetch |
| `indexFlag` | 跨境理财通 | local-API no-op (`true` → full universe, `false` → 0) | none for local source |

### 2.3 Unresolved / low-confidence

| key | status |
|---|---|
| `accReturn3Year_M` etc. | cumulative-return `_M` variants — server-respected (validity inherited from the `_M` range-string family) but cumulative-vs-annualized semantics not directly cross-checked against a row field; verify in parse-fund if used |
| `baseCurrencyId` | catalog lists 23-currency enum; scalar rejected with 400001, array `["CNY"]` accepted syntactically but matches 0 rows. **Not a working filter.** If currency filtering is ever needed, first discover the stored value format via a row inspection of `data.columns.baseCurrencyId`. |
| absolute min/max/step for pure range-sliders (`aum`, `ter`, `top10Holding`, `hkWeighting`, etc.) | server-side; bundle declares `unit`/`step(.01)` not absolute bounds. Use the empirical examples in §2.1 as safe values. |
| `gSSBd_*` full GICS code set | bundle-verified 11 codes (101/102/103/104/205/206/207/308/309/310/311); server may index more |
| `categoryId` full set | catalog lists 47 local codes; the `晨星分类` UI tree has 100+ nodes — full enumeration left to a future tree walk |
| `companyName` full vocabulary | the `公司名称` UI dropdown is a teleported overlay; pass exact stored name in array form |

---

## 3. UI group reference

The sidebar has **exactly 7 collapsible top-level groups** (`.screener-dp-panel` → `group-0..group-6`). Setting `<details>.open=true` directly does **not** trigger Vue reactivity — use `summary.click()` or the MCP `click` tool on the disclosure triangle. Fields below are the rendered `.screener-dp-name` labels.

### 基本信息 (group 0)
| field | control | options |
|---|---|---|
| 基金组别 | checkbox-ternary (是/否 each) | 开放式 `ifOpen`, 封闭式 `ifClose`, QDII `qDII`, ETF `exchangeTradedShare`, 个人养老金 `personalPension`, 北上基金 `mRF`, 联接基金 `masterFeeder` |
| 资产大类 | checkbox-group | 股票型/混合型/可转债/债券型/货币型/另类/商品/其它 → `broadCategoryId` |
| 晨星分类 | multi-select-tree | ~47+ local `categoryId` codes (full tree not enumerated) |
| 风险等级 | checkbox-group | R1..R5 → `totalRisk` `["1".."5"]` |
| 成立时间 | radio | 1年以上/3年以上/大于5年/大于7年/大于10年/自定义 → `inceptionDate` |
| 基金规模 | radio | 0~1亿/1~5亿/5~10亿/10~50亿/50~100亿/大于100亿/自定义 → `fundSize` |
| 份额规模 | radio | same buckets → `shareclassTna` |
| 最长任职时间 | slider-range | `longestTenure` |
| 持有人结构 | radio + sliders | `managerOwnership10kshares` (0-4 enum), `institutionalInvestorsSharesPercentage`, `individualInvestorsSharesPercentage` |
| 申购状态 | checkbox-group | 不可申购/可申购/封闭期/限大额 → `subscription` |
| 申购限制 | radio | 无/小于100/100-1000/1000-10000/大于10000/自定义 → `applyingMaxIv` |
| 锁定期 | radio | 无/小于1年/1-3年/3-5年/大于5年/自定义 → `closeOpenPeriod` |
| 重要属性 | checkbox-ternary | 转型 `srDate`, 指数 `indexFund`, 指数增强 `enhancedIndexFund`, FOF `fundOfFunds`, 基本份额 `oldestShareId` |

### 业绩指标 (group 1)
| field | control |
|---|---|
| 晨星评级 | multi-select (三年/五年/十年 × 5星..1星/无) → `rating3Y/5Y/10Y` (NO 一年 for ratings) |
| 晨星风险评级 | multi-select (same shape) → `riskRating3Y/5Y/10Y` |
| 基金回报(月末) | slider-range → `returnYTD_M`, `return1Month_M`, `return3Month_M`, `return6Month_M`, `return1Year_M`(年化), `return3Year_M`(年化), `return5Year_M`(年化), `return7Year_M`(年化), `return10Year_M`(年化) + `accReturn3Year_M/5Year_M/7Year_M/10Year_M` (累计) |
| 基金排名(月末) | slider-range → `return1MonthRankP_M`…`return10YearRankP_M` (percentile) |
| 夏普/最大回撤/标准差/卡玛/索提诺/R平方/贝塔/阿尔法 (月末) | slider-range, each with `_*_1Y/3Y/5Y/10Y` (raw value) + `*RankP_*Y` (percentile) |
| 超额收益/跟踪误差/信息比率 | slider-range, 12m/36m/60m/120m × (raw + rank) |
| 涨市捕获比/跌市捕获比 | slider-range, `_*_1Y/3Y/5Y/10Y` + `*RankP_*Y` |

### 持仓分析 (group 2)
| field | control |
|---|---|
| 晨星风格箱 | style-box (3×3 visual grid, no text) → `styleBox` `["1".."9"]` |
| 股票换手率/前十大股票集中度/港股占比 | slider-range → `turnover_Annu`, `top10Holding`, `hkWeighting` |
| 资产配置分布 | slider-range → `stockAsset`/`stockAssetPenetrate`, `bondAsset`/`bondAssetPenetrate`, `cashAsset`/`cashAssetPenetrate` |
| 股票行业占比 | slider-range → `gSSBd_101..311` (11 GICS) + `gSSBd_max` |
| 债券券种分布 | slider-range (local: `bBd_*`, global: `government`/`municipal`/`corporate`/`securitized`/`cashEquivalents`/`derivative` — global ones are data-empty) |

### 费用 (group 3)
| field | control |
|---|---|
| 综合费率 | slider-range → `ihc` (raw) + `iHCRankPer` (rank) |
| 显性费率 | slider-range → `managementFee`, `custodianRatio`, `distibutionFee` (composite `explicitCost` ignored) |
| 隐性费率 | slider-range → `ttc`+`tTCRankPer`, `ooc`+`oOCRankPer` (composite `hiddenCost` ignored) |
| 年报运营费率 | slider-range → `ter` + `tERRankPer` |

### 基金公司 (group 4)
| field | control |
|---|---|
| 公司名称 | multi-select (teleported overlay) → `companyName` `["易方达基金"]` |
| 管理规模 | slider-range → `broadCategorySizeAllExMm`(+`Rank`), `broadCategorySizeEquity`(+`Rank`), `broadCategorySizeFixIncome`(+`Rank`) |
| 平均投管经验/平均任职时间 | slider-range (year) → `managerCareerTime`, `managerStayTime` |
| 留职率 | slider-range → `retention1Y/3Y/5Y` |
| 成功率 | slider-range → `successRatio3Y/5Y/10Y` (percentile-rank semantics) |
| 综合费率排名/隐性费率排名 | slider-range → `ttcRankPerByFund`, `hiddenCostRankPerByFund` |

### 基金经理 (group 5)
| field | control |
|---|---|
| 投资年限 | slider-range (year) → `careerYear` |
| 管理规模 | slider-range (亿元) → `aum` |
| 标签 | multi-select → `tagging` `["自购超百万份","FOF持有","晨星奖","晨星奖提名"]` |

### 关键字 (group 6)
| field | control |
|---|---|
| (空名 keyword row) | keyword-input → `fundName` (scalar substring). The "查找数据点" textbox at panel top is a separate filter-search box, NOT this row. |

---

## 4. Value-format reference

The wire format is **NOT uniform** — different field families need different shapes. Sending the wrong shape is silently ignored (or, for enum-as-array, rejected with `400001`).

### 4.1 Boolean-string fields (是/否)
```json
"indexFund": "false", "qDII": "true", "srDate": "true"
```
- Always the **literal string** `"true"`/`"false"`, never JSON boolean.
- Ternary-checkbox fields (`mRF`, `masterFeeder`): only `"true"` is selective; `"false"`/unset = no restriction (NOT an exclusion).
- `indexFlag` is a local-API no-op — do not use.

### 4.2 Array fields (multi-select OR semantics)
```json
"rating3Y": ["4","5"],
"broadCategoryId": ["$BCG$EQUTY","$BCG$ALLOC"],
"categoryId": ["CHCA000051"],
"globalCategoryId": ["$GC$CHNEQY:大中华股票"],
"styleBox": ["3","1","4","7"],
"totalRisk": ["1","2"],
"fundSize": ["2~5","5~10","50~100",">100"],
"subscription": ["可申购"],
"companyName": ["易方达基金"],
"tagging": ["FOF持有","晨星奖"]
```
- `styleBox`: bare numeric codes **1-9**, not the catalog's `"3:大盘成长"` colon form (colon form is rejected).
- `broadCategoryId` multi-value items like `"$BCG$CONVT,$BCG$HYBSC:可转债"` are comma-split before send.
- `companyName` must be the **exact stored name** (`易方达基金` works; the longer legal name `易方达基金管理有限公司` does not); scalar and object forms return `400001`.
- `broadCategoryNameCN` also accepts Chinese-name arrays directly (`["股票"]`) — surprising but server-confirmed.

### 4.3 Range-string fields — the workhorse format

Most numeric filters use a string in one of three forms:
```
"lo~hi"   closed range        "0~50", "1~3", "-10~-5", "90~110"
">N"      open lower bound    ">5", ">100", ">0.5"
"<N"      open upper bound    "<5", "<0", "<10"
```
- For percentile-rank fields (`*RankP_*Y`, `*RankPer`, `return*RankP_M`), `0` = best, `100` = worst. `"<5"` and `"0~5"` are equivalent.
- For raw value fields, units vary: percent (`-10~-5` for drawdown, `0~0.5` for fees), decimal ratio (`0~1` for sharpe), years (`">3"` for tenure), 亿元 (`">100"` for `aum`).
- Negative ranges work for signed fields (`excessPb36mPer: "-100~-10"`).
- Decimal values are accepted (`betaToInd_3Y: "0.9~1.1"`, `managementFee: "0~0.5"`).

### 4.4 Fields whose wire format DISAGREES with the catalog (empirical override)

These are the cases where the catalog's `valueType`/`candidateValues` are **wrong** and the empirical validation is authoritative:

| field | catalog said | server actually wants |
|---|---|---|
| `applyingMaxIv` | range-string `"<100"`,`"100~1000"`,`">10000"`,`"null"` | **array of numeric strings** `["100"]`,`["1000"]`,`["10000"]`; all range-string/null forms → `400001`; the `"无"` bucket code unresolved |
| `closeOpenPeriod` | range-string `"<1"`,`"1~3"`,`">5"`,`"null"` | **array of numeric-year strings** `["1"]`,`["3"]`; all range-string/null forms → `400001`; the `"无"` bucket code unresolved |
| `managerOwnership10kshares` | enum (label-pair `"4:>100"`) | **bare enum-string** `"4"` (array `["4"]` → `400001`) |
| `styleBox` | enum (label-pair `"3:大盘成长"`) | **bare numeric code** `"3"` in array |
| `totalRisk`/`rating*` | enum (label-pair `"5:高风险"`) | **bare numeric code** `"5"` in array |
| `bBd_12` | range with `">N"`/`"<N"` | **closed `"lo~hi"` only** — bare integers and `>0`/`<N` fall through; `">50"` alone returns 814 but `"<10"` returns full 10000 |
| `upCaptureRatio_*` | range on ratio ~1.0 | **range on PERCENTAGE 0-100** — `"90~110"`/`">90"`; `"0.9~1.1"` returns 0 |
| `successRatio*Y` | raw percent 0-100 | **percentile-rank** — `"80~100"` returns 0; `"0~30"` is the "top 30%" (lower = more successful) |
| `gamaRatio_1Y` | raw value | percentile band (`"0~50"`/`"50~100"`) — while `_3Y/_5Y/_10Y` are raw value (`">3"`) |
| `maxManagementFee` | range | rejected key — use `managementFee` |
| `broadCategoryNameCN` | catalog: "display column only, not a sidebar dp" | **server-respected** as a CN-name array filter (`["股票"]` → 64 of 506) |

---

## 5. Server-side vs client-side

### 5a. Pushable into `search/es` body (automation-ready)

All keys in §2.1. The engine's current daily filter (§6) uses a subset of these. When adding new criteria, prefer:
- **percentile-rank** fields (`*RankP_*Y`, `*RankPer`) over raw-value fields for cross-category fairness.
- **period-suffixed** keys (`sharpeRatio_3Y`) over composite keys (`sharpeRatio`) — composites are silent no-ops.
- **`ttc`** over `hiddenCost`; **`ihc`/`iHCRankPer`** over `explicitCost`.

### 5b. Browser-only / cannot be server-pushed

Every key in §2.2. Three failure modes:
1. **UI composite** (`sharpeRatio`, `maximumDrawdown`, `sTD`, `alphaToInd`, `betaToInd`, `rSquaredToInd`, `gamaRatio`, `sortinoRatio`, `upCaptureRatio`, `downCaptureRatio`, `excessPb`, `trackPb`, `infoPb`, `explicitCost`, `hiddenCost`, `management`) — front-end fans out to per-period sub-keys before submit; the bare key is a silent no-op. **Must send the period-suffixed sub-key.**
2. **Display column** (`categoryName`, `managerName`) — metaData only; the server ignores CN-name strings. **Match client-side post-fetch** (e.g. the engine's `managerName` screen, or the 美元/人民币 name-based exclusion noted in the existing memory).
3. **Data-unpopulated global bond buckets** (`government`, `municipal`, `corporate`, `securitized`, `cashEquivalents`, `derivative`) — server recognizes the column but it holds NULL for all ~10000 local-source funds. Use the local `bBd_*` equivalents instead.

> **Implication for name/keyword exclusion.** Anything that requires fuzzy Chinese-name matching on a field that is NOT `fundName` (the only working keyword filter) must be done client-side. The engine's existing client-side screen layer is the correct place for those. **There is no working server-side currency filter** (`baseCurrencyId` matches 0 rows), so the 美元/人民币 share-class exclusion MUST be client-side (name-based, post-fetch).

---

## 6. Current engine production filter

Source: `research/funds/core/config/universe.json` → `search_filter`. The body sent to `search/es?source=local` each day. Empirical result: **506 funds** (well under the 1000-row cap; ~500 rows of headroom).

| field | value | why (what it screens for / excludes) |
|---|---|---|
| `rating3Y` | `["4","5"]` | 3-year Morningstar star rating 4 or 5. Excludes 1-3 star and unrated. Quality floor. |
| `rating5Y` | `["4","5"]` | 5-year star rating 4 or 5. Implies ≥5y track record + sustained outperformance. Strongest single survival filter. |
| `longestTenure` | `">3"` | Longest-serving current manager has >3 years on the fund. Excludes funds with manager churn. |
| `alphaToIndRankP_3Y` | `"0~50"` | Top half by 3-year alpha percentile rank. Excludes benchmark-trackers in the bottom half. |
| `sharpeRatioRankP_3Y` | `"0~50"` | Top half by 3-year Sharpe percentile rank. Risk-adjusted quality floor. |
| `fundSize` | `["2~5","5~10","10~50","50~100",">100"]` | AUM ≥ 2 亿. Excludes micro-caps `<2亿` (liquidity/closure risk). |
| `broadCategoryId` | `["$BCG$EQUTY","$BCG$ALLOC"]` | Equity + Allocation only. **Excludes bonds, money-market, convertibles, alternatives, commodities** — the explicit "no-bond" screen. |
| `indexFund` | `"false"` | Exclude pure index funds (we want active alpha). |
| `enhancedIndexFund` | `"false"` | Exclude enhanced-index funds (semi-active; muddies the active-alpha pool). |

**Implicit consequences** (verified in the empirical sweep):
- All 506 BASE funds are `ifOpen=true` (no closed-end funds).
- Zero are `exchangeTradedShare=true`, `personalPension=true`, `mRF=true`, `masterFeeder=true` (these subsets don't survive the rating/size/tenure gates).
- `indexFlag` is not sent (it is a local-API no-op anyway).
- `shareclassTna`, `inceptionDate`, `subscription`, `applyingMaxIv`, `closeOpenPeriod` are not constrained — candidates flow through regardless of subscription status / lockup. Add these if the downstream use needs purchasable-only funds.

**Watch the headroom.** The filter is sized for ~506; if `rating5Y` is ever tightened to `["5"]` only, or `longestTenure` to `">5"`, the count drops below 200 (per probe: `rating10Y:["5"]` alone cut to 65). Adding too many percentile-top-5% filters (`alphaToIndRankP_3Y:"0~5"`, `sharpeRatioRankP_3Y:"0~5"`) will starve the candidate pool.

---

## 7. Open questions / low-confidence fields

1. **`applyingMaxIv` and `closeOpenPeriod` "无" (none) bucket codes.** The catalog's `"null":"无"` option cannot be sent as JSON `null` and the string `"null"` is rejected (`400001`). Array-of-threshold form (`["100"]`) works for the bounded buckets but the "no limit"/"no lockup" code is unresolved. If the daily query needs "purchasable, no lockup" funds, this must be reverse-engineered from a UI capture of the `search/es` body when "无" is selected.
2. **`baseCurrencyId` stored value format.** Array `["CNY"]` is syntactically accepted but matches 0 rows; scalar is rejected. If currency filtering is needed, inspect a real row's `data.columns.baseCurrencyId` to learn the stored code shape.
3. **`accReturn*_M` cumulative vs annualized semantics.** Server-respected (inherits the `_M` range-string family behavior) but the cumulative-vs-annualized distinction was not cross-checked against a row field. Verify in `parse-fund` if these are pushed.
4. **Absolute slider bounds.** `aum`, `ter`, `top10Holding`, `hkWeighting`, `turnover_Annu`, `managementFee`, `custodianRatio`, `distibutionFee`, `managerCareerTime`, `managerStayTime` — the bundle declares `unit`/`step(.01)` but not absolute min/max. Use the empirical examples in §2.1 as safe operating values; if a query returns surprisingly 0 or full-universe, suspect an out-of-range bound.
5. **Full `categoryId` and `companyName` vocabularies.** The UI tree/dropdown enumerate 100+ categories and all fund companies; the static catalog lists 47 local `categoryId` codes. A full enumeration requires a UI walk.
6. **`globalCategoryId` within-BASE narrowing.** Validated as server-applied (drops BASE to 0 because BASE is China-market-only), but no within-BASE positive narrowing was demonstrated. Safe to use with `source=global`.
7. **Composite keys' exact fan-out.** Confirmed empirically that `sharpeRatio`/`maximumDrawdown`/`sTD`/`alphaToInd`/`betaToInd`/`rSquaredToInd`/`gamaRatio`/`sortinoRatio`/`upCaptureRatio`/`downCaptureRatio`/`excessPb`/`trackPb`/`infoPb`/`explicitCost`/`hiddenCost`/`management` are server-ignored, but the precise client-side dispatch (does the UI submit ALL four periods, or just the selected one?) was not captured. Assume "selected period only" and use the period-suffixed key directly.
8. **`successRatio*Y` semantics.** Confirmed percentile-rank (lower = better), but the exact server encoding (is `0` top-decile, or top-1%?) was not calibrated. Probe `0~10`/`0~1` before production use.
9. **`return7YearRankP_M` data sparsity.** Server-respected (returns 0 for all ranges, including `0~100`), proving the field is recognized but currently unpopulated. Re-check periodically — may populate as more funds reach 7y history.
