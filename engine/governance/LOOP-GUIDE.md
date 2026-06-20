# LOOP-GUIDE — how to execute one fire (static protocol)

> This is the procedure for every fire (daily/weekly/monthly). Follow in order.

## Fire ceremony
1. **Orient.** Read `INVARIANTS.md` → `LOOP-GUIDE.md` (this file) → `MEMORY.md` → `PLAN.md`.
2. **Pick work.** Take the top item(s) of `PLAN.md`. If running a scheduled fire (daily), execute the matching runbook (`orchestrate/daily.md`).
3. **Execute, checking invariants at each step.** After each store write, confirm schema validity. After each sweep, confirm the diff is not byte-identical to the prior day.
4. **Finish.**
   - Append a dated entry to `MEMORY.md` (what ran, counts, any warnings/anomalies).
   - Update `PLAN.md` (mark done, surface new work — e.g. "new candidate 00XXXX appeared, needs deep-scrape in Plan 2").
   - Log run to `store/logs/` (or stdout in Phase 1).

## Failure handling (do not silently swallow)
- Token 401/expired → run `harvest-token.md`; if re-login impossible → postpone fire + warn user.
- search/es empty or status ≠ 200011 → retry once; persistent → warn, do NOT write a garbage snapshot.
- Schema validation fails → reject write + **abort the fire** (hard stop; CLI exits 1). Prior good artifacts stay intact. A 0-row response is treated the same way.

## What a fire does NOT do
- Does not edit a generated store artifact by hand (regenerate from source instead).
- Does not skip validation to "get it working."
- Does not commit `secrets/`.
