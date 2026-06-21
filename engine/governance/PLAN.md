# PLAN — rolling "what's next" (update at end of each fire)

> Top item = next to do.

- [ ] **Merge** `feat/morningstar-engine-phase1` → main (Phase 1 DONE, live gate FULL GO).
- [x] **RESOLVE full-market snapshot scope** — DONE: server-side filter (our standards) → 847-fund candidate universe, ≤1000 cap. Verified live.
- [x] **Task 12 live gate: FULL GO** — Node→Layer1 ✅ + scope ✅ (server-side filter). Live daily loop runs end-to-end (847 swept → 30 candidates).
- [x] **Search strategy redesign + land (2026-06-21)** — two-layer de-duplication (server=structural+trackPb true-α 402-net; client=quality floor+portfolio-fit → 308 candidates). Caught trackPb direction inversion (0~50→50~100) + 100× threshold bug (0.5→50). Added truncation detection (totalCount). Docs: `screener-filters.md` (245-field inventory) + `screener-filter-discovery-methodology.md` (discovery/refresh method).
- [ ] **Shortlist ranker (Phase 4 prep)** — screen now yields a broad ~308 candidate pool (trackPb net is alpha-elite). Add a ranking step (composite alpha+sharpe+downside sort → top 16-30) that feeds deep-scrape, distinct from the screen filter.
- [ ] **Sharded retrieval if universe ever >cap** — if criteria legitimately match >1000, shard search/es into disjoint sub-calls (by broadCategoryId/fundSize) to capture 100% (never silently truncate). Add when needed.
- [ ] **Plan 2 (Phase 4):** nav-pull (growth-data) + deep-scrape (browser) + attribution (Brinson). Blocked on Plan 1 done.
- [ ] **Plan 3 (Phase 5):** research-report.js (Markdown + PDF).
- [ ] **Plan 4 (Phase 6):** ops hardening (retry-queue, state, error coverage, live smoke harness) + watchlist per-code tracking + pagination if universe ever needs >1000.
