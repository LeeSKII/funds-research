# engine/ — Morningstar fund research automation

Phase 1 = daily loop. See `docs/superpowers/specs/2026-06-20-morningstar-engine-design.md` for design.

## Run the daily loop (offline, no token needed)
```bash
cd engine
npm install
npm run daily:offline
```

## Run live (needs a harvested token)
1. Follow `ingest/harvest-token.md` to populate `secrets/token.json`.
2. `npm run daily`
