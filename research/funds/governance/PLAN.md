# PLAN — rolling "what's next"（每次 fire 结束更新）

> Top item = next to do. 2026-06-27 大刷新：Plan 2 驱动 / Plan 3 报告 / Plan 4 ops 硬化 / 两段式精排 / 分片检索 全部落地（离线可测，155 测试全绿）。

## 🔴 现在的下一步（需要人工/外发）

- [ ] **基金评估 HTML 页面（假设推演器 + 出局审计）** — spec 已落档 `docs/superpowers/specs/2026-06-27-fund-eval-page-design.md`（未提交）。骨架1 三栏 + editorial 顶栏；浏览器内 scoreFund/screen 移植（金标准对齐兜底）；出局审计视图回答 317→302。新 app `web-funds/`（端口 8766，0 依赖）。**待 writing-plans → 实现。**
- [x] **🔴 筛选层 USD 回退修复（✅ DONE 2026-06-27 live）** — `exclude_usd_shareclass` 误杀：当一只基金**最老份额恰好是美元份额**时（`oldestShareId:true` 已折叠到它），USD 排除把**整只基金**的人民币份额一起杀掉。坐实案例：**012921/012922 易方达全球成长精选(QDII)**——5★/α-top1%/夏普-top2%/+227%一年 的精英，仅因最老份额是「A(美元现汇份额)」被整只剔出（`screen.js:51`）。**修法（方案 B sibling-resolver，已落地）**：保留 `oldestShareId`，命中 USD 行时用 `fundName` 关键字反查该基金全部份额（searchFunds + fundName filter，返回 25 字段），用纯模块 `orchestrate/sibling-resolver.js`（注入 searchByFundName + hasDossier，18 测试）选**人民币**份额替换 USD 行（优先已有 dossier 的，免重抓）；`run.js` runDaily gated 接入（opts.searchByFundName 缺省则跳过=非回归）。**结果**：012921→012922 替换，candidates 302→303，shortlist widePool 303，012922 dossier 已存在无需重抓；推演列表 rank 104/317 可见（no_brinion 拉低，但下行保护强）。总外发 3 次（1 probe + 1 search/es + 1 sibling lookup）。174 funds 测试 + 21 web-funds 测试全绿。🔴 **已知 v1 缺口**：出局审计视图读 raw snapshot，仍显示 012921(USD) 为"出局"（resolution 只反映到 candidates，未写回 snapshot）——次要展示不一致。未提交（用户规矩）。
- [ ] **Live bulk-sweep 执行（需授权）**：`orchestrate/bulk-sweep.js` 驱动已就绪 + 离线 `--dry-fixture` 自检通过。Live 触发需 chrome-devtools 会话 + 命中 morningstar.cn ~302 次（外发操作），应由人工授权发起：把 shortlist stage1 的 289 pendingScrape 码灌成 dossier。跑完后 shortlist 的 fine-rank 即覆盖全池（当前只排了 13/302）。
- [ ] **Live daily loop 重启**：最近一次 fire 是 2026-06-22（snapshot 06-21），距今多日。`npm run daily`（需 token）刷新 snapshot/candidates/changes。

## ✅ 已完成（本批 2026-06-27）

- [x] **Plan 4 (Phase 6) ops 硬化** — 全套落地：
  - `core/retry.js` 指数退避+抖动（sleep/random 可注入）；已接入 `core/client.js` 替换手写 429 重试（行为不变，client.test.js 7/7）。
  - `core/state.js` 断点续跑 state（done/failed，原子写，损坏文件优雅降级）。
  - `core/watchlist.js` 逐只纵向追踪（评级/经理/规模档/风格漂移事件），消费 `universe.json` watchlist 码集。
  - `orchestrate/shard.js` + `sharded-sweep.js` disjoint 分片检索（universe>cap 时 100% 捕获，去重，截断告警）。
  - `orchestrate/smoke.js` 全链路自检 harness（`npm run smoke`，隔离 temp store）。
- [x] **Plan 3 (Phase 5) research-report** — `analyze/report.js`：dossier+判定卡 → Markdown（7 段：概要/α来源/板块流向/区间表现/风险/持仓/结论 + 否定式边界）。PDF 用外部 `pandoc`/`md-to-pdf` 一行转（不引入重依赖）。池级摘要 `renderPoolReportMarkdown`。`npm run report:offline`。
- [x] **Plan 2 (Phase 4) bulk detail-sweep 驱动** — `orchestrate/bulk-sweep.js`：throttle+小并发+retry+断点续跑，fetchPage 注入（生产=chrome-devtools，测试=mock fixture）。离线 `--dry-fixture` 自检通过；live 待授权。
- [x] **Shortlist 两段式精排** — `analyze/shortlist.js`：① coarseRank（25 字段行：α/夏普百分位+评级）→ 宽池；② fineRank 复用 `scoreFund`（Brinson tier + downsideCapture）按选股目标重加权 → ~15-20。🔴 DRY 不重推导 Brinson；🔴 诚实边界 pendingScrape。产物 `store/derived/shortlist-<date>.json`，schema `shortlist.schema.json`。`npm run shortlist:offline`。
- [x] **Sharded retrieval（universe>cap）** — 见 Plan 4 shard/sharded-sweep。
- [x] **parse-fund.js (detail scraper)** — v2.0.0 8 段 extractor + orchestrator，27 dossier 入库。
- [x] **Fund detail-page API discovery (2026-06-21)** — `/fund/<id>.html` Nuxt SSR dossier。
- [x] **detailUrl persisted (2026-06-21)** — `/fund/<id>.html` 合成链接。
- [x] **Merge feat/morningstar-engine-phase1 → main** — 全部在 main，已 push origin。
- [x] **RESOLVE full-market snapshot scope** — server filter → 候选网，≤1000 cap 无截断。
- [x] **Task 12 live gate: FULL GO** — live daily loop 端到端。
- [x] **Search strategy redesign (2026-06-21)** — 两层漏斗（server trackPb 真α + client 排名）。

## 📋 产物与运行（更新）

| 命令 | 作用 | 产物 |
|---|---|---|
| `npm test` | 测试套件（155，`test/**/*.test.js`，排除 tmp/ scratch） | — |
| `npm run smoke` | 全链路自检（offline） | temp store 全套 |
| `npm run daily:offline` / `daily` | ingest→diff→screen | snapshots/changes/candidates-<date> |
| `npm run analysis:offline` | dossier→判定卡+heatmap | score-<date>.json |
| `npm run shortlist:offline` | 两段式精排 | shortlist-<date>.json |
| `npm run report:offline` | Markdown 报告 | reports/report-<code>-<date>.md + pool-summary |
| `npm run bulk:dry` | bulk-sweep 离线编排自检 | —（live 需 chrome-devtools 会话） |
