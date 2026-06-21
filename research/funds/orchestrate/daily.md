# daily.md — daily fire runbook

> Executes the Phase 1 daily loop. Follow LOOP-GUIDE ceremony.

## Prerequisites
- `research/funds/secrets/token.json` exists and `core/auth.js` reports not-expired. If not, run `ingest/harvest-token.md` first.

## Steps
1. **Orient:** read `governance/INVARIANTS.md` → `LOOP-GUIDE.md` → `MEMORY.md` → `PLAN.md`.
2. **Run the loop:**
   ```bash
   cd research/funds
   node orchestrate/run.js            # live
   # or: node orchestrate/run.js --offline   # fixture, no token
   ```
3. **Sanity-check output.** `run.js` now auto-enforces the byte-identical invariant: if today's snapshot SHA-256 === yesterday's, it prints `⚠ byte-identical snapshot …` and sets `suspiciousIdentical:true`. If that fires, do NOT silently trust "0 changes" — re-sweep (suspected SPA cache / API hiccup) per INVARIANTS. Otherwise confirm artifacts landed:
   ```bash
   ls -la store/snapshots store/changes store/derived
   ```
4. **Inspect changes:** open `store/changes/<date>.json`. Any `rating_change` (esp. 5→4) or `manager_change` is high-signal — note in PLAN for deep-scrape (Plan 2).
5. **Inspect candidates:** `store/derived/candidates-<date>.json` count vs prior days. Sudden spike/drop = investigate.
6. **Finish:** append `MEMORY.md`, update `PLAN.md`.

## What this does NOT do (Phase 1 boundary)
No nav-pull, no deep-scrape, no attribution, no report. Those are Plans 2–4.
