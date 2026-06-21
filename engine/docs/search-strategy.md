# Search Strategy — Design & Lessons

> **What this is.** The *why* behind `engine/core/config/universe.json` (server filter) and
> `engine/analyze/screen.js` + `core/config/thresholds.json` (client screen): which funds we hunt,
> why each gate lives where it does, the empirical evidence for every choice, and the hard-won
> lessons that shaped it. Read this to understand or evolve the daily query.
>
> **Companion docs.** `screener-filters.md` = the **inventory** (all 245 fields, what they are).
> `screener-filter-discovery-methodology.md` = the **method** (how to discover/validate fields).
> This doc = the **strategy** (why this filter set, and what we learned designing it).
>
> **Status.** Landed 2026-06-21 (`commit 2a0080f`). Live-verified: **402-fund server net → 308 candidates**, 100% captured (no truncation), 33 tests green.

---

## 1. The goal

Build the daily candidate universe for a **true-alpha fund-research engine**: surface active, stock-selecting equity funds worth deep research (Brinson attribution, holdings, manager) → portfolio construction. Research-only (BOUND-1: no trades). North star: prefer **true alpha** (high Brinson stock-selection share, not industry-beta pseudo-alpha); long-run Sharpe 0.40–0.47; defensive smart-beta layer; manager tenure >3y; rebalance ~3y.

The single physical constraint: `search/es` returns **≤ ~1000 rows per call, no pagination**. Our principle in response: **capture 100% of funds matching our criteria — never silently drop any.** (The 1000 is the API's limit, not our budget.)

---

## 2. Architecture: a two-layer, non-redundant funnel

```
全市场 (~10000 funds)
   │
   ▼  [SERVER · universe.json search_filter]  ← structural survival + true-alpha pre-filter
 402 funds  (100% captured; totalCount == count, no truncation)
   │
   ▼  [CLIENT · screen.js + thresholds.json]  ← quality floor + portfolio-fit + defensive annotation
 308 candidates
   │
   ▼  [downstream · not yet built]            ← rank → 16-30 shortlist → deep research
```

**The governing principle — distinct jobs, zero duplication:**

| Layer | Owns | Criterion character |
|---|---|---|
| **Server** | structural survival + the one true-alpha discriminant (`trackPb`) | cheap, robust, slow-moving, structural, low-false-negative |
| **Client** | performance ranking + portfolio-fit + defensive annotation | daily-varying, regime-fragile, holistic, or only-expressible-post-fetch |

A gate must NOT appear in both layers. If the server already enforces it, the client treats it as a
defensive *assert*, not a re-filter. This is the fix for the **duplication bug** this strategy
replaced (see §7.1).

---

## 3. Server-side filter (`universe.json` → 402 funds)

Every field below is empirically confirmed server-respected (differential probe). Value formats
per `screener-filters.md` §4.

| Field | Value | Why it's here (server job) |
|---|---|---|
| `rating3Y` | `["4","5"]` | Quality floor; slow-moving (monthly recompute); implies ≥3y history (doubles as a minimal age gate without the <5y cliff). |
| `broadCategoryId` | `[EQUTY, ALLOC]` | The structural no-bond/no-moneymarket/no-commodity screen. The single biggest reliable cut; zero daily variance. |
| `indexFund` | `"false"` | We hunt active stock-selection alpha; pure index has zero alpha. |
| `enhancedIndexFund` | `"false"` | Semi-active; muddies the Brinson signal. |
| `fundOfFunds` | `"false"` | FoF double-charges + layers manager risk; binary flag the client can't detect post-fetch. |
| `longestTenure` | `">3"` | Governance invariant (tenure>3y); changes on manager events, not daily NAV. |
| `fundSize` | `≥2亿` | Micro-cap closure/liquidity floor. (Upper bound is client-side — see §4.) |
| `oldestShareId` | `"true"` | **Share-class dedup** (A/C/E → 1 row). Client has no sibling-link post-fetch; measured −38%. Buys cap headroom + a clean one-row-per-fund population. |
| `trackPb36mRankPer` | `"50~100"` | **The true-alpha pre-filter.** High tracking-error rank = active = high alpha. The ONLY server field that speaks directly to true-alpha-vs-closet-indexer, and TE is NOT returned in the row — so this discrimination can ONLY happen server-side. |

**Deliberately moved OFF the server** (now client-only): `rating5Y`, `alphaToIndRankP_3Y`,
`sharpeRatioRankP_3Y`. Reasons in §4.

---

## 4. Client-side screen (`screen.js` + `thresholds.json` → 308 candidates)

The client can only operate on fields the snapshot row **returns** (~25 fields — the row schema is
fixed and ≠ the filter schema; see lesson §7.4). It does only what the server can't or shouldn't:

| Gate | Value | Why it's a CLIENT job |
|---|---|---|
| structural asserts | rating3Y≥4, tenure≥3, size≥2 | Server-guaranteed; kept as defense-in-depth, not a re-filter. |
| `alphaToIndRankP_3Y` / `sharpeRatioRankP_3Y` | ≤ 50 (top half) | Quality floor. Server no longer sends these (moved here to de-duplicate). On the elite trackPb net this is near-redundant (96% pass) — kept as a floor, not a tight cut. |
| `rating5Y` soft | `[4,5] OR null` | Server dropped rating5Y to rescue <5y emerging funds; client applies a null-tolerant soft gate the server can't express (no OR-null in the filter). |
| `fundSize` upper cap | ≤ 200亿 | Portfolio-fit (mega-funds dilute alpha). Server has no upper bound. |
| exclude USD share-class | fundName regex `/美元\|USD\|US\$\|美金/` | **Forced client-side** — no server currency filter exists (lesson §7.5). |
| `defensive` annotation | `maximumDrawdown_3Y ≥ -30` | Tags the smart-beta-adjacent defensive sleeve. Annotation, not a gate. |

---

## 5. The server-vs-client decision rule

When adding a criterion, place it by character:

- **Structural / cheap / robust / low-false-negative** → **server** (e.g. asset class, size floor, index flag, `trackPb`, dedup).
- **Regime-fragile / holistic / daily-varying / portfolio-fit / only-expressible-post-fetch** → **client** (e.g. multi-period ranking, size cap, USD exclusion, defensive sleeve).
- **If the server already enforces it** → client keeps it as an *assert* at most, never a re-filter.

---

## 6. Empirical results (live, 2026-06-21)

- Server net: **402 funds** (`totalCount == count` → 100% captured, no truncation, ~600 headroom).
- Client screen: **308 candidates**.
- The candidate pool is broad because the `trackPb` net is already alpha-elite (mean alpha-rank
  top-13.7%); the client floor passes most. This is correct, not a defect — it means no redundant
  re-filtering. The tight shortlist (16-30) is a downstream ranking step (§9).

---

## 7. 🔴 Critical lessons learned (the experiences that shaped this)

Each of these caused a real defect or near-miss. They are the most valuable output of this work.

### 7.1 The duplication bug — why two layers must differ
Before this strategy, `universe.json` and `thresholds.json` encoded the *same* nine gates
(rating4-5 / tenure>3 / alpha&sharpe top-50% / size≥2亿 / no-bond / no-index / no-enhanced). The
client screen therefore re-confirmed ~95% of the server net and added almost nothing — defeating the
spec's funnel design. **Fix:** asymmetric role separation (§2). A screen that barely filters is a
*symptom of correct de-duplication*, not a bug.

### 7.2 Rank-direction polarity — `trackPb` was inverted
The strategy synthesis (from a 5-philosophy judge panel, all "approved") specified
`trackPb36mRankPer: "0~50"` to "kill closet-indexers." A kept-vs-excluded alpha comparison exposed
it as **backwards**: `0~50` kept the LOW-alpha funds (meanAlpha 4.77 vs excluded 10.73) — it would
have made the daily funnel systematically select the *worst* funds. Corrected to `50~100`
(meanAlpha 10.66).

**Lesson:** percentile-rank direction depends on the underlying metric's polarity. "Higher-is-better"
metrics (Sharpe, alpha, return ranks) follow `0=best`. "Raw-magnitude / neutral" metrics (tracking
error) do **not** — low rank = low magnitude = (for TE) closet-indexer. **Never assume `0=best`;
confirm direction with a kept-vs-excluded test before locking any rank gate.** No API error is
raised when you get it wrong — the funnel just silently selects the wrong funds.

### 7.3 Verify field SCALE before setting thresholds — the 100× bug
`alphaToIndRankP_3Y` / `sharpeRatioRankP_3Y` are **0-100 percentile points**, not 0-1 fractions.
A threshold of `0.5` therefore meant "top 0.5%", not "top half" — silently over-filtering to the
extreme top for the project's entire prior history (this was the "25 candidates" mystery). Corrected
to `50`.

**Lesson:** when a threshold's effect mismatches expectation, dump the field's min/max/mean first.
A 100× scale error produces no error message — just a quietly wrong result.

### 7.4 Filter schema ≠ row schema
`trackPb36mRankPer`, `downCaptureRatioRankP_3Y`, `alphaToIndRankP_5Y`, etc. are valid server
**filters** but are NOT **returned** in the row. So the client screen cannot use them. Two separate
inventories: "what the server accepts" vs "what the row contains." **Check the snapshot row keys
before writing a client gate.**

### 7.5 No currency filter
`baseCurrencyId` matches 0 rows. USD/RMB share-class exclusion is **client-side only** (fundName
regex). QDII funds have separate USD/RMB share-class entries distinguished only by name.

### 7.6 `count` is capped — use `totalCount` to detect truncation
`searchFunds().count` = rows returned (≤ the per-call ceiling), NOT the true match total. Only
`totalCount` (= `data.count`) reveals silent loss. The client now exposes both; `market-sweep.js`
warns on truncation. This directly serves the **"capture 100%, never silently drop"** principle.

### 7.7 Empirical verification beats multi-agent consensus
The trackPb direction inversion passed a 5-strategy judge panel + 3 adversarial judges + the
synthesis step — all "agreed" on a filter that would have selected the worst funds. It was caught
only by a grounded kept-vs-excluded alpha comparison done *after*. **Multi-agent proposals are not
ground truth; a cheap empirical test against real data is.** Always close the loop with a
differential probe before shipping a strategy.

### 7.8 The differential-probe is the universal validator
For any filter field: baseline count → add filter → count delta (respected?) → kept-vs-excluded
alpha (direction?) → `totalCount>count` (truncation?). Recipe in
`screener-filter-discovery-methodology.md` §5.

---

## 8. Tuning levers (how to evolve the strategy)

| Want | Lever | Effect (measured) |
|---|---|---|
| Smaller candidate pool | tighten client `alpha3Y`/`sharpe3Y` | `≤10` → ~200; `≤5` → ~120 |
| Tighter true-alpha server net | tighten `trackPb` | `60~100` → ~338 (stronger α separation) |
| Include offshore equity (QDII) | add a QDII sleeve (client) | portfolio decision, not a funnel gate |
| Capture >1000 if criteria grow | shard the query (disjoint sub-calls) | preserves 100% capture — never truncate |
| Re-add age gate | `rating5Y` server-side | re-excludes <5y cohort (currently rescued) |

**Always re-run the live daily after any change and confirm no `[market-sweep] ⚠ TRUNCATION`.**

---

## 9. Execution workflow (`node orchestrate/run.js`)

```
[1] ingest/market-sweep.js   searchFunds(token, universe.search_filter) → search/es
                            → 402 rows + totalCount → schema validate → truncation guard
                            → atomic write store/snapshots/<date>.json
[2] analyze/diff.js          yesterday ⊕ today snapshot → rating/manager/new/removed events
                            → byte-identical guard (stale-SPA-data defense)
                            → atomic write store/changes/<date>.json
[3] analyze/screen.js        today's snapshot × thresholds → 308 candidates (+ defensive tag)
                            → atomic write store/derived/candidates-<date>.json
[4] return { swept:402, changes:N, candidates:308, suspiciousIdentical:false }
```

**Hard guards (INVARIANTS):** 0-row response or schema fail → hard stop (no dirty snapshot written,
prior day's artifacts preserved). Token never enters git. Missing field → `null` + warning, never
invented. Same-day re-run is idempotent.

`--offline` reads the fixture (no network/browser) for tests.

---

## 10. Outcomes

Per daily fire:
- **`store/snapshots/<date>.json`** — the 402-fund candidate universe (25 fields each).
- **`store/changes/<date>.json`** — today-vs-yesterday events (rating/manager/new/removed). *This is
  the core value of the daily loop: dynamic tracking, not a static list.*
- **`store/derived/candidates-<date>.json`** — 308 candidates with defensive annotations.
- **308 active-equity candidates** — quality-gated, USD-excluded, share-deduped, defense-tagged:
  the clean input pool for deep research.

**Next (PLAN):** the detail page is now mapped (`/fund/<id>.html` Nuxt SSR — see `fund-detail-api.md`).
Ranking is **two-stage**: coarse-rank the 308 on this 25-field row → detail-scrape a wider pool
(parse `detailUrl` for Brinson / downside-capture / calendar returns / holdings + `growth-data` NAV) →
fine-rank on true-α (Brinson stock-selection share) → research report + portfolio construction. The
25-field row alone cannot separate true-α from sector-β — **Brinson lives only on the detail page.**

---

## 11. File map

| File | Role |
|---|---|
| `core/config/universe.json` | server `search_filter` (the 402-net) |
| `core/config/thresholds.json` | client screen config |
| `analyze/screen.js` | client screen logic (pure) |
| `core/client.js` | `searchFunds` → `{count, totalCount, rows}` + truncation surface |
| `ingest/market-sweep.js` | server call + schema/truncation guards + atomic write |
| `orchestrate/run.js` | the daily pipeline (only cross-layer caller) |
| `docs/screener-filters.md` | field inventory (what exists) |
| `docs/screener-filter-discovery-methodology.md` | discovery/refresh method (how to find fields) |
| `docs/search-strategy.md` | **this doc** — strategy rationale + lessons (why) |
