# Morningstar Screener Filter — Discovery & Refresh Methodology

> **Purpose.** A repeatable method for (a) discovering what filter conditions the morningstar.cn
> screener supports, (b) validating how each one actually behaves on the wire, and (c) refreshing
> that knowledge when morningstar adds or changes fields — so the daily automated query never
> silently breaks or silently selects the wrong funds.
>
> **Companion document.** `engine/docs/screener-filters.md` is the **INVENTORY** — the current
> validated set of all 245 fields. THIS document is the **METHOD** — how the inventory was built
> and how to rebuild/extend it. Read the inventory for *what*; read this for *how*.

---

## 1. Why this is hard (the discovery problem)

The morningstar CN screener is unusually hostile to reverse-engineering. Five properties combine:

1. **No schema endpoint.** There is no `/config`, `/criteria`, or `/fields` endpoint. `GET /cn-api/v2/template/config-list` returns the *user's saved filter blobs*, NOT a field schema. The only place the field schema lives is **inside the minified JS bundle** (a ~29KB object-literal array in `screener-*.js`).
2. **Composite keys are silent no-ops.** `sharpeRatio`, `maximumDrawdown`, `sTD`, `hiddenCost`, etc. appear in the UI and bundle, are accepted by the API without error, and do **nothing** (the front-end fans them out to period-suffixed sub-keys before submitting). You cannot tell a working filter from a no-op by whether the API errors.
3. **Value formats are non-uniform.** Arrays vs range-strings vs boolean-strings vs enum-codes, and the *bundle's declared format is sometimes wrong* (empirical override needed — see `screener-filters.md` §4.4).
4. **Rank-direction polarity varies by metric.** Most `*RankP` fields are `0=best`, but `trackPb*RankPer` (tracking error) is inverted — low rank = closet-indexer = low alpha. Getting this wrong selects the *worst* funds. Direction can only be confirmed empirically.
5. **The returned row schema ≠ the accepted filter schema.** A field can be a valid server-side *filter* yet never appear in the *returned* row (e.g. `downCaptureRatioRankP_3Y`, `trackPb36mRankPer`). So the client screen can't use fields the server filters on. Two separate inventories.

**Consequence:** you cannot trust any single source. The method below cross-checks four sources and lets **empirical behavior** overrule the static catalog whenever they disagree.

---

## 2. The four discovery sources (reliability-ranked)

| # | Source | Best for | Reliability | Cost |
|---|---|---|---|---|
| 1 | **Bundle archaeology** | Enumerating ALL field keys + UI labels + groups + declared options | High for *existence*; **medium for formats** | Low (Node fetch) |
| 2 | **Metadata endpoints** | (Mostly a dead end — see §2.2) | Low | Low |
| 3 | **Empirical differential probe** | Confirming server-respected? + correct format + direction | **Authoritative** | Medium (live API calls) |
| 4 | **UI reverse-capture** | User-visible option codes the bundle hides (e.g. `applyingMaxIv` "无" bucket, `categoryId` tree) | High for what it captures | High (manual clicks) |

### 2.1 Source 1 — Bundle archaeology (PRIMARY for enumeration)

The single most powerful, independent source. One parse gives every field.

**Steps:**
1. With the screener open in the browser (chrome-devtools MCP), harvest the loaded JS chunks:
   ```js
   performance.getEntriesByType('resource').map(r => r.name).filter(u => /\.js(\?|$)/i.test(u))
   ```
   The important ones: `screener-*.js` (the filter config), `search-*.js`, `index-*.js`.
2. Fetch each as text (plain Node `fetch` — static assets, no auth, no CORS in Node).
3. The field schema is a single object-literal array anchored near `let t=[{label:\`基本信息\`...`. Extract it; keep a parsed copy at `engine/tmp/filter-block.json`.
4. For each entry mine: `key`, UI `label` (Chinese), `group`, declared `valueType`, declared `candidateValues`.
5. Grep the same bundles for `/cn-api/` to enumerate endpoints.

**Why it's primary:** complete, deterministic, no browser, no token, repeatable. One script reproduces the whole catalog.

**Its blind spot:** the bundle's *declared value formats are sometimes wrong* (e.g. it says `applyingMaxIv` is a range-string; the server actually wants an array). Never ship a filter on bundle format alone — always confirm with Source 3.

### 2.2 Source 2 — Metadata endpoints (mostly a dead end)

Confirmed: **no endpoint returns the field schema.** `/cn-api/v2/template/config-list*` returns saved-filter CRUD blobs. Don't waste time hunting for a schema endpoint — the bundle IS the schema (Source 1). Metadata endpoints are only useful to confirm the *list of endpoints* the app calls.

### 2.3 Source 3 — Empirical differential probe (AUTHORITATIVE for behavior)

The ground truth. The bundle claims; the server decides; **the server wins.** This is the source that caught the `trackPb` direction inversion and the `0.5`-vs-`50` scale bug.

**The core test — "is this field server-respected, and what format works?":**
```
baselineCount = searchFunds({ token, filter: BASE }).count        // a known-good reference filter
probeCount    = searchFunds({ token, filter: { ...BASE, [field]: value } }).count
respected     = (probeCount != baselineCount) for a value that SHOULD differ
```
- If `probeCount == baselineCount` for every value → the field is a **silent no-op** (composite key) OR the format is wrong.
- If the API returns `400001` → the format is **rejected** (e.g. enum sent as array, scalar where array required). Distinct from a no-op.
- Use `totalCount` (=`data.count`) vs `count` (=`rows.length`) to detect **truncation** — if `totalCount > count`, the match set exceeds the per-call cap and the snapshot is incomplete.

**The direction test (critical for rank fields):**
```
kept     = searchFunds({ filter: { ...BASE, [rankField]: "LO~HI" } })   // funds PASSING the band
excluded = BASE rows not in kept
compare mean(alphaToInd_3Y) of kept vs excluded.
→ if kept has HIGHER alpha, the band selects the GOOD set (direction confirmed).
→ if kept has LOWER alpha, the band is INVERTED (you're keeping the worst).
```
This is exactly how `trackPb 0~50` was exposed as keeping low-alpha funds → corrected to `50~100`.

**Note:** some filter fields (e.g. `trackPb36mRankPer`) are **not returned in the row**, so you can't read their value directly — you can only infer direction via the kept-vs-excluded comparison.

### 2.4 Source 4 — UI reverse-capture (for hidden option codes)

For the few things the bundle doesn't expose cleanly: exact option codes for "none"/"custom" buckets (`applyingMaxIv` "无"), the full `categoryId` tree, the `companyName` stored-name vocabulary.

**Steps:** open `https://www.morningstar.cn/#/screener`, **manually** check the box in the UI, then capture the request body via chrome-devtools `list_network_requests` + `get_network_request` (filter to `search/es`). The body shows the exact key+value the UI sent.

**Caveats:** Vue disclosure panels don't respond to programmatic `.click()`/pointer events — a human must expand them. Use sparingly; Sources 1+3 cover ~95% of needs without it.

---

## 3. Decision matrix — which source answers which question

| Question | Primary source | Confirm with |
|---|---|---|
| What fields exist? | 1 (bundle) | — |
| What's the field's Chinese label / UI group? | 1 (bundle) | 4 (UI) |
| Does the server respect this field? | **3 (probe)** | — |
| What value format works? | **3 (probe)** | 1 (bundle, as starting guess) |
| Is the rank direction 0=best or inverted? | **3 (kept-vs-excluded)** | — |
| Is this field in the returned row? | snapshot row keys | — |
| What's the exact code for a UI bucket? | 4 (UI capture) | — |

---

## 4. Refresh workflow — when morningstar adds/changes a field

Run this when (a) the bundle hash changes, (b) a daily fire surfaces an unknown field, or (c) periodically (quarterly).

1. **Detect.** Re-harvest the bundle chunk URLs; if `screener-*.js` hash differs from last time, the schema likely changed.
2. **Re-enumerate (Source 1).** Re-run the bundle archaeology → new catalog. Diff against `engine/tmp/filter-block.json` to see added/removed/renamed fields.
3. **Probe new/changed fields (Source 3).** For each new field: differential-probe respect + format + direction.
4. **Update the inventory.** Edit `engine/docs/screener-filters.md` §2 (master table) — add the field with its empirically-confirmed format and server/client classification.
5. **If the strategy uses the field**, update `universe.json` (server) or `thresholds.json` (client) and re-run the live daily.
6. **Check the truncation guard.** After any `universe.json` change, confirm the live run does NOT emit `[market-sweep] ⚠ TRUNCATION` (totalCount == count). If it does, the match set exceeded the cap — tighten the filter or shard the query (§6).
7. **Commit** the updated inventory + methodology lessons.

---

## 5. The differential-probe recipe (copy-paste template)

```js
// engine/tmp/probe-<field>.js  (gitignored working artifact)
const fs = require('fs'), path = require('path');
const { searchFunds } = require('../core/client');
const token = JSON.parse(fs.readFileSync(path.join(__dirname,'..','secrets','token.json'),'utf8')).token;

const BASE = { /* the production search_filter from universe.json */ };
const num = v => (v==null||v==='') ? null : Number(v);
const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;

(async () => {
  const all = await searchFunds({ token, filter: BASE });
  const byId = new Map(all.rows.map(r => [r.id, r]));
  for (const value of ['LO~HI', '>N', '<N']) {           // try the plausible formats
    const kept = await searchFunds({ token, filter: { ...BASE, <FIELD>: value } });
    const keptIds = new Set(kept.rows.map(r => r.id));
    const keptAlpha = kept.rows.map(r => num(r.alphaToInd_3Y)).filter(x=>x!=null);
    const exclAlpha = all.rows.filter(r => !keptIds.has(r.id)).map(r => num(r.alphaToInd_3Y)).filter(x=>x!=null);
    console.log(`<FIELD>="${value}": kept=${kept.count} truncation=${kept.totalCount>kept.count}  ` +
      `keptAlpha=${mean(keptAlpha)?.toFixed(2)} vs exclAlpha=${mean(exclAlpha)?.toFixed(2)}  ` +
      `${mean(keptAlpha)>mean(exclAlpha) ? '✓good-set' : '✗INVERTED'}`);
  }
})();
```
Run with `node tmp/probe-<field>.js`. A field is **safe to ship** only after this prints `✓good-set` (or the field is non-directional) with no truncation.

---

## 6. Handling the per-call row cap (no pagination)

`search/es` returns at most ~1000 rows per call with no pagination cursor. **This is a physical API limit, not a policy.** Our principle: capture **100%** of funds matching our criteria — never silently lose any.

- The client exposes `totalCount` (true match total, `data.count`) alongside `count` (rows returned, capped). `market-sweep.js` **warns on truncation** (`totalCount > count`).
- As long as the match set ≤ the cap, a single call captures everything. Our current strategy matches ~402 → fully captured.
- **If criteria ever match more than the cap:** do NOT drop funds. Shard the query into disjoint sub-calls (e.g. split by `broadCategoryId` or `fundSize` buckets), run each, merge, and dedup. This preserves complete capture. (Not yet implemented; add when a strategy legitimately needs >cap.)

---

## 7. Lessons learned (the war stories — read before trusting any filter)

These each caused a real defect or near-miss in this project. Internalize them.

1. **Composite keys are silent no-ops.** `sharpeRatio`, `maximumDrawdown`, `sTD`, `alphaToInd`, `betaToInd`, `rSquaredToInd`, `gamaRatio`, `sortinoRatio`, `upCaptureRatio`, `downCaptureRatio`, `excessPb`, `trackPb`, `infoPb`, `explicitCost`, `hiddenCost`, `management`, `maxManagementFee`. Always send the **period-suffixed sub-key** (`sharpeRatio_3Y`, `ttc`+`ooc`, `managementFee`). *Symptom:* filter accepted, count unchanged.
2. **Rank-direction polarity.** `trackPb*RankPer` is INVERTED vs other `*RankP` fields: low rank = low tracking error = closet-indexer = low alpha. To keep active funds use the HIGH band (`50~100`), not `0~50`. *Always confirm direction with the kept-vs-excluded test (§5) — a wrong-direction gate silently selects the worst funds, and no error is raised.* Other "lower=better" fields (Sharpe, alpha, drawdown ranks) follow `0=best`.
3. **Catalog format ≠ server format (11 overrides).** `applyingMaxIv`/`closeOpenPeriod` want **arrays of numeric strings**; `styleBox`/`totalRisk`/`rating*` want **bare numeric codes** in arrays (not `"N:label"`); `upCaptureRatio_*` is on a **0-100 percentage scale**; `successRatio*Y` is **percentile-rank not raw percent**. See `screener-filters.md` §4.4. *The bundle is a starting guess, never the final word.*
4. **Filter schema ≠ row schema.** `trackPb36mRankPer`, `downCaptureRatioRankP_3Y`, `alphaToIndRankP_5Y`, etc. are valid server filters but are NOT returned in the row. The client screen can only gate on the ~25 returned fields. *Check the snapshot row keys before writing a client gate.*
5. **No currency filter.** `baseCurrencyId` matches 0 rows. USD/RMB share-class exclusion is **client-side only** (fundName regex). QDII funds have separate USD/RMB share-class entries distinguished by name.
6. **`count` is capped; use `totalCount` for truncation detection.** `searchFunds().count` = rows returned (≤ cap). Only `totalCount` reveals silent loss.
7. **Verify field SCALE before setting thresholds.** `alphaToIndRankP_3Y` / `sharpeRatioRankP_3Y` are **0-100 percentile points**, not 0-1 fractions. A threshold of `0.5` meant "top 0.5%", not "top half" — this bug silently over-filtered to the extreme top for the project's whole history. *When a threshold's effect mismatches expectation, dump the field's min/max/mean first.*
8. **`oldestShareId:"true"` collapses share classes** (~38%: 245→151). It's a server-side dedup the client can't replicate — keep it server-side if you want one row per fund.
9. **`response_status` is a STRING** (`"200011"`). Compare with `String(...) !== '200011'`. `400001` = bad request (wrong shape), distinct from the silent no-op signature.
10. **`sign` is irrelevant** (presence changes nothing); send `"sign":"1"` to match the UI but don't treat it as a checksum.

---

## 8. Artifacts & tooling

| Artifact | Role | Location |
|---|---|---|
| Filter inventory (the "what") | All 245 fields, validated formats, server/client split | `engine/docs/screener-filters.md` |
| This methodology (the "how") | Discovery/validation/refresh process | `engine/docs/screener-filter-discovery-methodology.md` |
| Detail-page API map | Fund-detail dossier discovery — **the same 3-source method applied to `/fund/<id>.html`** | `engine/docs/fund-detail-api.md` |
| Parsed bundle schema | Raw catalog from `screener-*.js` | `engine/tmp/filter-block.json` (gitignored, regenerable) |
| Probe scripts | One-off differential probes | `engine/tmp/probe-*.js` (gitignored) |
| Production client | `searchFunds({token, filter})` → `{count, totalCount, rows}` | `engine/core/client.js` |
| UI capture | chrome-devtools MCP (`list_network_requests` + `get_network_request`) | browser (screener page) |
| Auto-memory | Stable API facts (cap, formats, direction, no-currency) | `~/.claude/.../memory/morningstar-api-search-es.md` |

---

## 9. Checklist — adding a new filter to the daily strategy

- [ ] Field confirmed server-respected via differential probe (§5)?
- [ ] Value format empirically validated (not just bundle-declared)?
- [ ] If it's a rank field: direction confirmed via kept-vs-excluded (not inverted)?
- [ ] Is it a **server** job (structural/cheap/robust/low-false-negative) or a **client** job (fragile/holistic/regime-dependent/portfolio-fit)? Put it in the right layer — never duplicate.
- [ ] If server-side: does the new `universe.json` still capture 100% (no truncation warning)?
- [ ] If client-side: is the field actually in the returned row schema?
- [ ] Inventory (`screener-filters.md`) updated with the field + format + classification?
- [ ] `npm test` green + live daily re-run sane?
