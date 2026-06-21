# Fund Detail Page — Layout-Variance Spec

> **What this is.** The empirical map of how the `/fund/<id>.html` dossier **varies across fund
> types and ages**, derived from an **18-fund corpus** (15 existing snapshots + 3 scraped
> 2026-06-21). This is the spec `parse-fund.js` is locked against — every rule below was measured,
> not assumed.
>
> **Companion.** `fund-detail-api.md` = *where the data lives* (SSR DOM vs XHR). THIS doc = *how the
> DOM layout varies* (column counts, section-header variants, Brinson presence, ticker formats).
>
> **Corpus (18 funds, historical probing inputs):** A-share active equity (000411/000925/001048/
> 002861/005161/006265/006502/006751/009891/010013/014191), HK-cross-border equity (002121),
> ETFs (159994/515050/515880), QDII (017730), ALLOC/混合 mature (001438), ALLOC/混合 young (017102).
> Ages 3.3y→12.5y. These raw snapshots were probing inputs (since deleted); the layout rules below
> stand. Parser regression now runs on `research/funds/test/fixtures/mock-fund-innertext.json`.

---

## 1. Trailing-return columns — **3 variants (7 / 8 / 9), age-driven**

Counted from the **header row** of the `过往回报` table (the labels between `回报%` and `本基金`), NOT
from `text.includes` (which over-counts on stray label mentions).

| Cols | Trigger | Labels |
|---|---|---|
| **9** | fund age **> 10y** | 近一月, 近三月, 近六月, 近一年, 近两年, 近三年, 近五年, **近十年**, 今年以来 |
| **8** | **5y ≤ age ≤ 10y** | same minus 近十年 |
| **7** | age **< 5y** | same minus 近十年 **and** 近五年 |

Evidence: 000411@12.5y=9, 001438@11y=9, 002861@9y=8, 006502@7.6y=8, 009891@5.8y=8, 014191@4.3y=7,
017102@3.3y=7, 017730@3.4y=7. **Memory `morningstar-fund-detail-layouts` ("7/8/9") confirmed correct.**

> **Parser rule:** never hardcode the column list. Read the header row, map each label → value by
> position. A `<5y` fund legitimately has no 近五年; a `5–10y` fund has no 近十年. Missing-period
> fields → `null`, not an error.

## 2. Annual-return years — scale with age (2 → 10), from first full calendar year

The `年度回报` table lists one column per **full** calendar year since inception (partial inception
year is omitted). Read the year-header row dynamically.

Evidence: 017730 (inc 2023-02)→2024,2025 (2 cols); 014191 (inc 2022-03)→2023..2025 (3);
006502 (inc 2018-11)→2019..2025 (7); 000411 (inc 2014-01)→2016..2025 (10 — 2015 partial omitted).

## 3. Section inventory — 14 core sections stable; **headers have variants**

All 18 funds render the same 14 core sections. But two section **display headers vary by fund
origin**, so a single fixed anchor misses them:

| Section | Domestic header | QDII / variant header |
|---|---|---|
| sector allocation | `行业配置` | `股票行业分布` |
| region allocation | `地区配置` | `股票地区分布` |

> **Parser rule:** match a section by **any** of its header variants. The `$sfund-*` keys in
> `__NUXT_DATA__` (§3.2 of fund-detail-api.md) are the *stable* machine identifiers — use them as
> the section checklist when a display label is ambiguous. (`$sfund-portfolio-industry-data` =
> sector, `$sfund-portfolio-region-data` = region.)

## 4. Brinson attribution — **label always renders; values are real ⟺ domestic active**

The `业绩归因` header appears on **every** fund, but only **domestic active** funds (equity OR ALLOC)
carry a real decomposition. Null funds render an explicit message:

```
业绩归因
该基金暂无业绩归因数据。
```

| Brinson | Funds | Signal |
|---|---|---|
| **real** (excess + sector + stock populated) | all domestic active equity + both ALLOC samples (001438, 017102) | numeric rows present |
| **null** (暂无业绩归因数据) | index ETFs (159994/515050/515880), QDII (017730), HK-cross-border (002121) | the 暂无/无业绩归因 message |

> **Parser rule:** after locating `业绩归因`, check the next ~6 lines for `暂无|无业绩归因` → set
> `brinson = null` with `reason: "not_computed"`. Only otherwise grab 超额收益/行业配置/个股选择.
> Identity check 超额 ≈ 行业 + 个股 (tolerance <0.5) flags extraction errors on real-Brinson funds.

## 5. Holdings tickers — **three formats; QDII holds a mix**

| Market | Format | Regex | Example |
|---|---|---|---|
| A-share | 6 digits | `^\d{6}` | 688498, 600519 |
| HK | 5 digits | `^\d{5}` | 00700, 09888 |
| US / foreign | 1–6 letters | `^[A-Z]{1,6}` | AVGO, MU, NVDA, TSM |

017730 (QDII) holds **both** US letters (AVGO/MU/MRVL/NVDA/ASML/KLAC/TSM/AMD) **and** A-share
6-digit (688498 源杰科技, 688256 寒武纪). 002121 (HK) holds 5-digit codes — this is why an earlier
`^\d{6}`-only extractor counted just 3 of 10 holdings.

> **Parser rule:** holding-row regex = `^(\d{6}|\d{5}|[A-Z]{1,6})\t([^\t]+)\t([^\t]*)`, weight on
> the `%` token within the next 1–2 lines. Holding count is **≤ 10** (some funds report 7–9), not
> always exactly 10.

## 6. ALLOC (混合) layout = identical to equity — no special-casing

The two ALLOC samples (001438 积极配置 11y; 017102 行业混合 3.3y) render the **same** 14-section
dossier, the same 7/8/9 column rule, and **real** Brinson. The "test an ALLOC fund" gap was a
non-gap: one template serves EQUTY and ALLOC alike. (Universe `broadCategoryId = EQUTY+ALLOC`, so
this covers the entire strategy surface.)

## 7. Capture ratios can exceed 100%

QDII 017730: 涨势捕获率 318.77%, 跌势捕获率 144.65% (amplified vs benchmark). The parser must
allow capture values > 100 (do not clamp or treat as erroneous).

## 8. Three intra-section value-layouts (the v1.0 bug — adversarially verified)

Within a section, the same kind of field can render in **three** label/value arrangements. A single
`numAfter` (read-the-next-line) helper handles only one and silently mis-reads the other two. This was
the v1.0 defect: fees were swapped 6×, manager return-since was fabricated as a calendar year, and
AUM/count were scrambled. Verified across 16 funds 2026-06-21.

| Layout | Arrangement | Example | Helper |
|---|---|---|---|
| **(c)** value AFTER label | label on line N, value on N+1 | `机构` / `3.73%` (持有人结构), NAV | `numAfter` |
| **(b)** value ON the anchor line | label + value on the SAME line (tab/space-joined) | `任职回报327.11%`, `管理费(每年)\t1.20%` | `numOnLine` |
| **(a)** value BEFORE label | value on N, label on N+1 (KPI strips, cost waterfall) | `118.48亿` / `在管规模` | `numBefore` |

**Where each fires:**
- **NAV, asset-type, 持有人结构 (机构/个人), 相对收益 singletons (alpha/beta/R²/捕获率…)** → layout (c) `numAfter`.
- **性价比 / 风险和波动 caveat rows** (夏普/卡玛/索提诺/标准差/**最大回撤**/**下行风险**/晨星风险) → `pairAfter` → `{fund, peer}` (4-col table 指标|同类表现|本基金|同类平均; the 相对收益 block has NO 同类平均 column, so those stay `numAfter` singletons).
- **Fees** (`管理费(每年)`/`托管费(每年)`/`销售服务费(每年)` prospectus table) and **manager return-since**
  (`任职回报XXX%`) → layout (b). ⚠ The `费率与成本` waterfall uses `(年)` (no 每) with layout (a) —
  do NOT anchor fees there; it returns the custodian value labeled as management (the 6× bug).
- **Manager KPI strip** (`在管规模`/`管理数量`) and the cost waterfall → layout (a).
- **Region/sector rows** can be tab-joined onto the name line (`大亚洲地区\t100.00`) OR name-alone-then-next-line;
  and the region table can be **1-column** (fund only, no benchmark — some funds omit 基准 %) or **3-column**.

---

## Parser-design implications (the lock list)

1. **Column sniff from header rows** — trailing (`过往回报` block) and annual (`年度回报` block).
   Never assume a fixed column set.
2. **Section match by header-variant set** (or `$sfund-*` checklist) — single anchors miss QDII.
3. **Brinson null-detection** via the `暂无业绩归因` message before grabbing values; identity-check
   the real ones.
4. **Multi-market ticker regex** for holdings (6-digit / 5-digit / letters).
5. **Numeric coercion** strips `优于X%同类`, em-dash `—`, `%`, commas; preserves sign; allows >100.
6. **Dispatch the three value-layouts** (§8) — `numAfter` alone mis-reads fees / manager-return / AUM.
7. **Region/sector rows** match by name prefix (allow trailing tab-values) and accept 1-column tables.
8. **Zero hardcoded fund-specific anchors** (no 财通/金梓才 literals — the sin of the old
   prototype parser, now in `research/funds/tmp/funds-prototype/parse-fund.js`).

## Known limitations (not probed — out of strategy universe)

Bond / money-market / commodity-only / conservative-allocation funds are **excluded** by the
universe server-filter (`broadCategoryId = EQUTY+ALLOC`), so their layouts were not probed. They may
omit stock holdings / add bond-specific sections. **Not blocking** — the parser will never be pointed
at them. If the universe ever expands, re-run `research/funds/tmp/probe-layouts.js` + `probe-headers.js` on a
fresh sample of the new type before trusting the parser there.

---

## Probing tooling (regenerable)

| Tool | Role |
|---|---|
| `research/funds/tmp/probe-layouts.js` | per-fund layout summary (sections, Brinson, holdings count) |
| `research/funds/tmp/probe-headers.js` | header-row column/year counts + section-variant + ticker-format detection |
| Corpus (historical) | 18 fund snapshots — probing inputs, since deleted (layout rules above stand) |
| Test fixture | `research/funds/test/fixtures/mock-fund-innertext.json` (anonymized 005827 structure; parser regression) |
