# INVARIANTS — what must never change (static, rarely edited)

> Read at the START of every fire. If any invariant is violated, STOP and surface to the user.

## (a) Machine guardrails — enforced, non-negotiable
- **No hallucinated data.** Missing field → `null` + warning. Never invent a number.
- **Every store write is schema-validated.** `validate(name, data).valid === false` ⇒ reject the write.
- **Atomic writes.** Temp file + rename. No half-written store artifacts.
- **Idempotent fires.** Same date re-run yields identical output (snapshot keyed by date; diff is deterministic).
- **Tokens never enter git.** `secrets/` is gitignored. Never echo a token value in logs/output.
- **BOUND-1: research only, no trades.** This system produces analysis + reports. It never emits trade orders.
- **Diff guard.** If today's snapshot is byte-identical to yesterday's (suspicious SPA cache or API hiccup), flag and do not silently treat as "no changes" — re-sweep.

## (b) Research north star — what "good" looks like
- Target long-run portfolio Sharpe ≈ 0.40–0.47 (per 8y/10y backtest; NOT the Markowitz arithmetic 0.55).
- Prefer **true alpha** (high stock-selection share in Brinson) over industry-beta pseudo-alpha.
- Defensive layer = smart-beta ETFs (gold 518880 / dividend-low-vol 512890 / quant-multi-factor), because 5y-5★ set has ~0 defensive funds.
- Rebalance every ~3 years (backtest optimum; not annual).
- Manager tenure > 3y preferred (manager-change risk).

## Scope of Phase 1
Daily loop only: snapshot → diff → screen → store → governance. No nav-pull, deep-scrape, attribution, or reports yet (Plans 2–4).
