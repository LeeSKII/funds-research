# research/funds/ — Morningstar fund research automation

Phase 1 = daily loop. See `../../docs/superpowers/specs/2026-06-20-morningstar-engine-design.md` for design.

## Run the daily loop (offline, no token needed)
```bash
cd research/funds
npm install
npm run daily:offline
```

## Run live (needs a harvested token)
1. Follow `ingest/harvest-token.md` to populate `secrets/token.json`.
2. `npm run daily`

## Analysis pipeline (offline, reads `data/fund/`)
```bash
npm run analysis:offline   # dossier → 判定卡 + 板块流向 heatmap → score-<date>.json
npm run shortlist:offline  # 两段式精排（Brinson 真α + 跌势捕获）→ shortlist-<date>.json
npm run report:offline     # Markdown 研究报告 → reports/report-<code>-<date>.md + pool-summary
npm run smoke              # 全链路自检（offline，隔离 temp store）
npm test                   # 测试套件（155，限定 test/**）
```

Plan 2 bulk detail-sweep（把候选宽池灌成 dossier）：`npm run bulk:dry` 离线自检；live 执行需 chrome-devtools 会话，是外发操作，需授权（见 `orchestrate/bulk-sweep.js`）。
