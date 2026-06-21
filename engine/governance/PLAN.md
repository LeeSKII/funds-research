# PLAN — rolling "what's next" (update at end of each fire)

> Top item = next to do.

- [ ] **parse-fund.js (detail scraper) — IMMEDIATE NEXT.** Navigate each row's `detailUrl` (`/fund/<id>.html`) → parse rendered DOM (Brinson 归因 / risk / downside-capture / calendar returns / top-10 holdings / manager / fees) + `growth-data` NAV pull (needs secId). Spec: `engine/docs/fund-detail-api.md`. Outputs a per-fund dossier JSON. This is the core of Plan 2.
- [x] **Fund detail-page API discovery (2026-06-21).** `/fund/<id>.html` = Nuxt SSR dossier (legacy `/quicktake/` dead); data XHRs = `growth-data` (NAV+rollingReturn+dividend+managerChangeEvents) + `manager/return`. All north-star gaps (Brinson / 跌势捕获 / 年度回报 / 前十持仓) confirmed present. Doc: `fund-detail-api.md`.
- [x] **detailUrl persisted on rows (2026-06-21, `a372cd3`).** `normalizeRow` synthesizes `/fund/<id>.html`; snapshot schema required + pattern; 308 candidates backfilled locally. Welds list→detail with a deterministic link.
- [ ] **Merge** `feat/morningstar-engine-phase1` → main (Phase 1 DONE, live gate FULL GO).
- [x] **RESOLVE full-market snapshot scope** — DONE: server-side filter (our standards) → 847-fund candidate universe, ≤1000 cap. Verified live.
- [x] **Task 12 live gate: FULL GO** — Node→Layer1 ✅ + scope ✅ (server-side filter). Live daily loop runs end-to-end (847 swept → 30 candidates).
- [x] **Search strategy redesign + land (2026-06-21)** — two-layer de-duplication (server=structural+trackPb true-α 402-net; client=quality floor+portfolio-fit → 308 candidates). Caught trackPb direction inversion (0~50→50~100) + 100× threshold bug (0.5→50). Added truncation detection (totalCount). Docs: `screener-filters.md` (245-field inventory) + `screener-filter-discovery-methodology.md` (discovery/refresh method).
- [ ] **Shortlist ranker — REFRAMED two-stage (after parse-fund.js).** Discovery showed the 25-field row is insufficient for true-α selection (no Brinson). New design: (1) coarse rank on 25 fields → wide pool; (2) detail-scrape that pool via parse-fund.js (API free, throttle); (3) fine rank on true-α (Brinson stock-selection share) + downside capture → final ~15-20. Distinct from the screen filter. Supersedes the old "rank on 25 fields → 16-30".
- [ ] **Sharded retrieval if universe ever >cap** — if criteria legitimately match >1000, shard search/es into disjoint sub-calls (by broadCategoryId/fundSize) to capture 100% (never silently truncate). Add when needed.
- [ ] **Plan 2 (Phase 4):** detail-scrape bulk sweep = parse-fund.js over the coarse-ranked pool (navigate `/fund/<id>.html` + `growth-data` NAV), throttled (free API, polite delay + small concurrency). Yields per-fund dossiers with Brinson attribution → feeds the fine ranker + research report. Path now concrete (was "blocked on Plan 1").
- [ ] **Plan 3 (Phase 5):** research-report.js (Markdown + PDF).
- [ ] **Plan 4 (Phase 6):** ops hardening (retry-queue, state, error coverage, live smoke harness) + watchlist per-code tracking + pagination if universe ever needs >1000.
