# 基金评估 HTML 页面（假设推演器 + 出局审计）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `web-funds/` — a local, 0-dependency interactive HTML app that lets the user tune the 7-dimension fund-scoring rules live (假设推演) and audit why funds fall out of the candidate pool (出局审计), over the existing 317-fund snapshot.

**Architecture:** Node `http` server (port 8766) scans the existing `research/funds/store/` + `data/fund/` files into one `/api/bundle`. Pure scoring/screening logic is ported to ESM modules (`scoring.mjs`/`screening.mjs`) shared by browser + node tests, kept honest by golden-master parity tests vs the real pipeline output. Vanilla-JS frontend (3-pane master-detail + editorial top bar) re-ranks in-browser on slider drag.

**Tech Stack:** Node ≥18 (built-in `http`/`fs`/`path` only), vanilla JS ESM, `node:test`, Google Fonts (Noto Serif SC / IBM Plex Sans / Mono). No npm runtime deps.

**Spec:** [`docs/superpowers/specs/2026-06-27-fund-eval-page-design.md`](../specs/2026-06-27-fund-eval-page-design.md). Visual reference (CSS + layout, real data): `.superpowers/brainstorm/1556-1782519575/content/design-mockup.html`.

**🔴 User commit rule:** The user commits only when asked. Treat each task's commit step as a *checkpoint* — batch them and confirm with the user before actually running `git commit` during execution. All work stays uncommitted until then.

---

## File Structure

```
web-funds/
├── server.js                     # http server: /api/bundle + static + SSE hot-reload
├── package.json                  # type:module, scripts {start, dev, test}
├── README.md
├── public/
│   ├── index.html                # shell: top bar + 3-pane grid + mode mounts
│   ├── style.css                 # CSS vars (light/dark) + editorial + tool layout (lifted from mockup)
│   ├── app.js                    # orchestration: fetch bundle, state, mode switch, recompute pipeline
│   ├── lib/
│   │   ├── scoring.mjs           # PURE: sub-scores + fineScore + scoreFundCard (port of analyze/score.js)
│   │   ├── screening.mjs         # PURE: screenRow->{passed,gate,detail} + screenAll (port of analyze/screen.js)
│   │   └── ui-util.mjs           # PURE: normalizeWeights, computeDelta, formatters, badge labels
│   └── views/
│       ├── topbar.js             # render top bar (philosophy chips, heatmap mini, theme, mode toggle)
│       ├── scorer.js             # render slider panel + wire normalize/recompute
│       ├── ranked-list.js        # render ranked list + filter/sort + Δ
│       ├── detail-card.js        # render selected fund judgment card
│       └── audit.js              # render 出局审计: funnel waterfall + exclusion table
└── test/
    ├── scoring.test.js           # unit + golden-master parity vs score-2026-06-27.json
    ├── screening.test.js         # unit + parity vs candidates-2026-06-26.json + 012921 case
    ├── ui-util.test.js           # normalize/delta/formats
    └── fixtures/
        └── mini-bundle.json      # small hand-built fixture for view-level reasoning
```

**Responsibility boundaries:** `lib/*.mjs` = pure, tested, no DOM, no fs. `views/*.js` = DOM rendering only, import pure helpers from `lib/`, never compute scoring themselves. `app.js` = state + wiring. `server.js` = data shaping + serving only (no scoring).

**Phases (each a testable milestone):**
- **A (Tasks 1–6):** Pure logic ports + parity tests. Milestone: `npm test` proves the browser math matches the Node pipeline.
- **B (Task 7):** Server + bundle. Milestone: `curl /api/bundle` returns full data.
- **C (Tasks 8–12):** Editorial shell + 推演 mode. Milestone: working what-if scorer in browser.
- **D (Tasks 13–14):** 出局审计 mode + acceptance. Milestone: full app meets spec §11.

---

## Task 1: Scaffold `web-funds/` + port scoring sub-scores

**Files:**
- Create: `web-funds/package.json`
- Create: `web-funds/test/scoring.test.js`
- Create: `web-funds/public/lib/scoring.mjs`
- Create: `web-funds/README.md` (stub)
- Create: `web-funds/test/fixtures/` (dir)

- [ ] **Step 1: Create `web-funds/package.json`**

```json
{
  "name": "fund-eval-web",
  "version": "1.0.0",
  "description": "Local interactive HTML app for the fund-scoring rules (假设推演 + 出局审计)",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test test/**/*.test.js"
  },
  "engines": { "node": ">=18" },
  "dependencies": {}
}
```

- [ ] **Step 2: Write the failing test `web-funds/test/scoring.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sizeRiskOf, downsideQuality, alphaQualityScore, endorsementScore,
  bandContributionScore, riskAdjusted,
} from '../public/lib/scoring.mjs';

test('sizeRiskOf: >100亿 → capacity_erosion; <2 → liquidation; null → unknown', () => {
  assert.equal(sizeRiskOf(150, { capacityErosionYi: 100, liquidationRiskYi: 2 }).flag, 'capacity_erosion');
  assert.equal(sizeRiskOf(1, { capacityErosionYi: 100, liquidationRiskYi: 2 }).flag, 'liquidation_risk');
  assert.equal(sizeRiskOf(50, { capacityErosionYi: 100, liquidationRiskYi: 2 }).flag, 'ok');
  assert.equal(sizeRiskOf(null, { capacityErosionYi: 100, liquidationRiskYi: 2 }).flag, 'unknown');
});

test('downsideQuality: null→0.5, neg→1, floor→1, ceil→0, linear between', () => {
  assert.equal(downsideQuality(null, 40, 120), 0.5);
  assert.equal(downsideQuality(-21.49, 40, 120), 1);          // 逆市 clamp 到 1
  assert.equal(downsideQuality(40, 40, 120), 1);              // floor → 最大保护
  assert.equal(downsideQuality(120, 40, 120), 0);             // ceil → 无保护
  assert.equal(downsideQuality(80, 40, 120), 0.5);            // 中点
});

test('alphaQualityScore: 真α (share≥0.7) 用 0.5/0.3/0.2 权重', () => {
  const cfg = { weights: { stockAlphaRatio: 0.5, annualizedAlpha5yNorm: 0.3, tenureNorm: 0.2 },
                tierThresholds: { trueAlpha: 0.7, industryBeta: 0.3 }, alpha5yNormalizeDivisor: 50 };
  const aq = alphaQualityScore(
    { attribution: { real: true, excess: 144.34, stockSelection: 154.18, _identityCheck: { ok: true } } },
    { alpha: 103.3, maxTenureYears: 7.6 }, cfg);
  // share = 154.18/144.34 = 1.068 → clamp 1; alpha5yNorm = 103.3/50 clamp 1; tenureNorm = 7.6/10 = 0.76
  // value = 0.5*1 + 0.3*1 + 0.2*0.76 = 0.952; tier = true_alpha
  assert.equal(aq.tier, 'true_alpha');
  assert.ok(Math.abs(aq.value - 0.952) < 0.001, `got ${aq.value}`);
  assert.equal(Math.round(aq.stockAlphaShare * 1000) / 1000, 1.068);
});

test('alphaQualityScore: attribution.real !== true → no_brinion, value 0', () => {
  const cfg = { weights: { stockAlphaRatio: 0.5, annualizedAlpha5yNorm: 0.3, tenureNorm: 0.2 },
                tierThresholds: { trueAlpha: 0.7, industryBeta: 0.3 }, alpha5yNormalizeDivisor: 50 };
  const aq = alphaQualityScore({ attribution: { real: false } }, { alpha: 52, maxTenureYears: 4.4 }, cfg);
  assert.equal(aq.tier, 'no_brinion');
  assert.equal(aq.value, 0);
});

test('endorsementScore: 机构+评级加权（无内部人/FOF）', () => {
  const cfg = { weights: { institutional: 0.3, insiders: 0.3, fof: 0.2, ratings: 0.2 }, ratingMax: 5 };
  const en = endorsementScore(
    { holders: { institutional: 40, insiders: {}, fofHeld: '' } },
    { ratings: { rating3Y: 5, rating5Y: 4 } }, cfg);
  // institutional 40/100=0.4; insiders 0; fof 0; ratings ((5+4)/2)/5=0.9
  // value = 0.3*0.4 + 0 + 0 + 0.2*0.9 = 0.3
  assert.ok(Math.abs(en.value - 0.3) < 0.001, `got ${en.value}`);
});

test('bandContributionScore: 一致性 = 跑赢年数/总年数', () => {
  const bc = bandContributionScore(
    { annual: { 2022: -25.64, 2023: -7.24, 2024: 32.38 }, annualPeer: { 2022: -29.32, 2023: 2.53, 2024: 16.5 } },
    { bearYear: 2022 });
  // excess: 2022: 3.68(>0), 2023: -9.77(<0), 2024: 15.88(>0) → beat 2/3
  assert.equal(bc.consistencyRatio, 2 / 3);
  assert.equal(bc.bear2022Excess, 3.68);
});

test('riskAdjusted: upside/downside asymmetry + low_benchmark_fit flag', () => {
  const ra = riskAdjusted({ upsideCapture: 166.09, downsideCapture: -21.49, rSquared: 0.59, alpha: 103.3 },
    { rSquaredTrustFloor: 0.7 });
  assert.equal(ra.captureFlag, 'aggressive_upside');          // asymmetry 166/21.49 ≈ 7.7 ≥ 1.2
  assert.ok(ra.flags.includes('low_benchmark_fit'));          // r² 0.59 < 0.7
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web-funds && npm test`
Expected: FAIL — `Cannot find module '.../scoring.mjs'`.

- [ ] **Step 4: Write `web-funds/public/lib/scoring.mjs`** (sub-scores only this task)

```js
// lib/scoring.mjs — PURE port of research/funds/analyze/score.js (per-fund sub-scores).
// 🔴 sectorFlow is POOL-dependent → NOT ported (taken from card, see spec §5.1/§5.4).
// 🔴 theme is descriptive → NOT ported. Keep these two faithful-by-omission, not wrong.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;

export function sizeRiskOf(aumYi, cfg) {
  if (aumYi == null) return { aumYi: null, flag: 'unknown' };
  if (aumYi > cfg.capacityErosionYi) return { aumYi, flag: 'capacity_erosion' };
  if (aumYi < cfg.liquidationRiskYi) return { aumYi, flag: 'liquidation_risk' };
  return { aumYi, flag: 'ok' };
}

// fine-rank downside protection: lower capture = more protection. spec §5.2.
export function downsideQuality(downsCap, floor, ceil) {
  if (downsCap == null) return 0.5;
  if (downsCap < 0) return 1;                                  // 逆市 → clamp to 1
  return clamp((ceil - downsCap) / (ceil - floor), 0, 1);
}

// attribution = {real, excess, stockSelection, _identityCheck}; riskLike = {alpha, }; mgr = {maxTenureYears}
export function alphaQualityScore({ attribution }, riskLike, mgr, cfg) {
  const out = { value: 0, stockAlphaShare: null, tier: 'no_brinion', annualizedAlpha5y: null, tenureNorm: 0, identityCheckOk: null };
  const a = attribution;
  if (a && a.real === true && typeof a.excess === 'number' && a.excess !== 0) {
    const share = a.stockSelection / a.excess;
    out.stockAlphaShare = round3(share);
    const t = cfg.tierThresholds;
    out.tier = share >= t.trueAlpha ? 'true_alpha' : share >= t.industryBeta ? 'mixed' : 'industry_beta_pseudo';
    out.identityCheckOk = a._identityCheck ? a._identityCheck.ok : null;
    const tenureNorm = clamp(((mgr && mgr.maxTenureYears) || 0) / 10, 0, 1);
    out.tenureNorm = round3(tenureNorm);
    const alpha5y = (riskLike && riskLike.alpha != null) ? riskLike.alpha : null;
    out.annualizedAlpha5y = alpha5y;
    const alphaNorm = alpha5y != null ? clamp(alpha5y / cfg.alpha5yNormalizeDivisor, 0, 1) : 0;
    const w = cfg.weights;
    out.value = round3(w.stockAlphaRatio * clamp(share, 0, 1) + w.annualizedAlpha5yNorm * alphaNorm + w.tenureNorm * tenureNorm);
  }
  return out;
}

const USD_NEG = /暂未|没有|无/;
export function endorsementScore({ holders }, { ratings }, cfg) {
  const w = cfg.weights;
  const h = holders || {};
  const institutional = clamp((h.institutional || 0) / 100, 0, 1);
  const ins = h.insiders || {};
  const insiderStrong = ['managerSelf', 'executive', 'employee', 'companyDirect']
    .filter((k) => ins[k] && ins[k].trend && ins[k].trend.direction === '增持').length / 4;
  const fofText = h.fofHeld || '';
  const fof = (/20\d{2}/.test(fofText) && /持有|FOF/.test(fofText) && !USD_NEG.test(fofText)) ? 1 : 0;
  const r = ratings || {};
  const ratingsNorm = clamp((((r.rating3Y || 0) + (r.rating5Y || 0)) / 2) / cfg.ratingMax, 0, 1);
  const value = round3(w.institutional * institutional + w.insiders * insiderStrong + w.fof * fof + w.ratings * ratingsNorm);
  return { value, institutional: h.institutional != null ? h.institutional : null, fofHeld: fof ? true : (fofText || null), ratings: r };
}

export function bandContributionScore({ annual, annualPeer }, cfg) {
  const a = annual || {}, p = annualPeer || {};
  const years = Object.keys(a);
  if (years.length === 0) return { value: 0, annualExcess: [], consistencyRatio: 0, bear2022Excess: null, effectiveBandDensity: 0 };
  const annualExcess = years.map((y) => ({ year: y, excess: round3((a[y] || 0) - (p[y] || 0)) }));
  const beat = annualExcess.filter((x) => x.excess > 0).length;
  const bear = annualExcess.find((x) => x.year === String(cfg.bearYear));
  const ratio = round3(beat / years.length);
  return { value: ratio, annualExcess, consistencyRatio: ratio, bear2022Excess: bear ? bear.excess : null,
           effectiveBandDensity: round3(annualExcess.filter((x) => (a[x.year] || 0) > 0 && x.excess > 0).length / years.length) };
}

export function riskAdjusted(risk, cfg) {
  const r = risk || {}; const flags = [];
  if (typeof r.rSquared === 'number' && r.rSquared < cfg.rSquaredTrustFloor) flags.push('low_benchmark_fit');
  const asymmetry = (r.upsideCapture != null && r.downsideCapture != null) ? r.upsideCapture / (Math.abs(r.downsideCapture) || 1) : null;
  let captureFlag = 'unknown';
  if (asymmetry != null) captureFlag = asymmetry >= 1.2 ? 'aggressive_upside' : asymmetry <= 0.8 ? 'defensive' : 'balanced';
  return { alpha: r.alpha ?? null, rSquared: r.rSquared ?? null, beta: r.beta ?? null,
           upsideCapture: r.upsideCapture ?? null, downsideCapture: r.downsideCapture ?? null,
           asymmetry: asymmetry != null ? round3(asymmetry) : null, captureFlag, flags };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web-funds && npm test`
Expected: PASS (6 tests).

- [ ] **Step 6: Create `web-funds/README.md` stub**

```markdown
# Fund Eval Web

本地交互式 HTML 应用：基金评分规则「假设推演」+ 候选池「出局审计」。

## 启动
由 Claude 跑 background：`cd web-funds && node server.js` → http://localhost:8766

## 数据源（只读）
- `../research/funds/store/derived/{score,shortlist,candidates}-*.json`
- `../research/funds/store/snapshots/*.json` · `../research/funds/store/changes/*.json`
- `../research/funds/core/config/{analysis,thresholds}.json`
- `../data/fund/<code>/*.json`（dossiers）

## 测试
`npm test`（含金标准对齐：浏览器 scoreFund/screen 必须复现 Node 管线产出）
```

- [ ] **Step 7: Commit (checkpoint — confirm with user first)**

```bash
git add web-funds/package.json web-funds/README.md web-funds/public/lib/scoring.mjs web-funds/test/scoring.test.js
git commit -m "feat(web-funds): scaffold + port per-fund scoring sub-scores (6 unit tests)"
```

---

## Task 2: Port `fineScore` + `scoreFundCard` (recompute from dossier)

**Files:**
- Modify: `web-funds/public/lib/scoring.mjs` (append fine + card)
- Modify: `web-funds/test/scoring.test.js` (append fine tests)

- [ ] **Step 1: Append failing tests to `web-funds/test/scoring.test.js`**

```js
import { fineScore, scoreFundCard } from '../public/lib/scoring.mjs';

test('fineScore: 默认权重 + 真α卡 = 复现 006502 的 0.83', () => {
  const card = { alphaTier: 'true_alpha', downsideCapture: -21.49, sectorFlowValue: 0.724,
                 bandValue: 0.714, endorsementValue: 0.195 };
  const w = { trueAlpha: 0.4, downsideProtection: 0.25, sectorFlow: 0.15, band: 0.1, endorsement: 0.1 };
  const ds = { floor: 40, ceil: 120 };
  // = 0.4*1 + 0.25*1(neg) + 0.15*0.724 + 0.1*0.714 + 0.1*0.195 = 0.4+0.25+0.1086+0.0714+0.0195 = 0.8495
  assert.ok(Math.abs(fineScore(card, w, ds) - 0.8495) < 0.001, `got ${fineScore(card, w, ds)}`);
});

test('scoreFundCard: 从 dossier 重算子分 + fine（默认权重），tier/flags 正确', () => {
  const dossier = {
    description: { code: '006502', name: '财通集成电路', aumYi: 13.05 },
    performance: { attribution: { real: true, excess: 144.34, stockSelection: 154.18, _identityCheck: { ok: true } },
                   ratings: { rating3Y: 5, rating5Y: 4 }, annual: { 2024: 32.38 }, annualPeer: { 2024: 16.5 } },
    risk: { alpha: 103.3, rSquared: 0.59, upsideCapture: 166.09, downsideCapture: -21.49 },
    holders: { institutional: 4.93, insiders: {}, fofHeld: '' },
    manager: { maxTenureYears: 7.6 },
  };
  const cfg = {
    alphaQuality: { weights: { stockAlphaRatio: 0.5, annualizedAlpha5yNorm: 0.3, tenureNorm: 0.2 },
                    tierThresholds: { trueAlpha: 0.7, industryBeta: 0.3 }, alpha5yNormalizeDivisor: 50 },
    endorsement: { weights: { institutional: 0.3, insiders: 0.3, fof: 0.2, ratings: 0.2 }, ratingMax: 5 },
    riskAdjusted: { rSquaredTrustFloor: 0.7 }, sizeRisk: { capacityErosionYi: 100, liquidationRiskYi: 2 }, band: { bearYear: 2022 },
  };
  const fineW = { trueAlpha: 0.4, downsideProtection: 0.25, sectorFlow: 0.15, band: 0.1, endorsement: 0.1 };
  const fineDs = { floor: 40, ceil: 120 };
  const card = scoreFundCard(dossier, { sectorFlowValue: 0.724 }, cfg, fineW, fineDs);
  assert.equal(card.alphaTier, 'true_alpha');
  assert.equal(card.sizeRiskFlag, 'ok');
  assert.deepEqual(card.flags.sort(), ['low_benchmark_fit', 'true_alpha'].sort());
  assert.ok(Math.abs(card.fineScore - 0.8495) < 0.001);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web-funds && npm test`
Expected: FAIL — `fineScore/scoreFundCard is not a function` (export not yet).

- [ ] **Step 3: Append to `web-funds/public/lib/scoring.mjs`**

```js
// fine-rank composite (spec §5.2). card = precomputed/recomputed components.
export function fineScore(card, w, ds) {
  const trueAlphaIndicator = card.alphaTier === 'true_alpha' ? 1 : 0;
  return round3(
    w.trueAlpha * trueAlphaIndicator
    + w.downsideProtection * downsideQuality(card.downsideCapture, ds.floor, ds.ceil)
    + w.sectorFlow * card.sectorFlowValue          // 🔴 frozen card value (v1)
    + w.band * card.bandValue
    + w.endorsement * card.endorsementValue
  );
}

// Recompute a full judgment card from a dossier (used live in browser when sub-weights change).
// sectorFlowValue is PASSED IN (pool-derived, frozen v1). Returns the same shape score.js emits.
export function scoreFundCard(dossier, { sectorFlowValue }, cfg, fineW, fineDs) {
  const desc = dossier.description || {};
  const perf = dossier.performance || {};
  const risk = dossier.risk || {};
  const aq = alphaQualityScore({ attribution: perf.attribution }, risk, dossier.manager || {}, cfg.alphaQuality);
  const en = endorsementScore({ holders: dossier.holders }, { ratings: perf.ratings }, cfg.endorsement);
  const bc = bandContributionScore({ annual: perf.annual, annualPeer: perf.annualPeer }, cfg.band);
  const ra = riskAdjusted(risk, cfg.riskAdjusted);
  const sizeRisk = sizeRiskOf(desc.aumYi, cfg.sizeRisk);
  const flags = [...new Set([
    ...(aq.tier === 'true_alpha' ? ['true_alpha'] : aq.tier === 'industry_beta_pseudo' ? ['industry_beta_pseudo'] : []),
    ...(aq.identityCheckOk === false ? ['data_noise'] : []),
    ...ra.flags,
    ...(sizeRisk.flag !== 'ok' && sizeRisk.flag !== 'unknown' ? [sizeRisk.flag] : []),
  ])];
  const card = {
    code: desc.code, name: desc.name,
    alphaTier: aq.tier, stockAlphaShare: aq.stockAlphaShare, annualizedAlpha5y: aq.annualizedAlpha5y,
    alphaQualityValue: aq.value, endorsementValue: en.value, bandValue: bc.value,
    sectorFlowValue, downsideCapture: ra.downsideCapture, captureFlag: ra.captureFlag,
    sizeRiskFlag: sizeRisk.flag, aumYi: sizeRisk.aumYi, flags,
  };
  card.fineScore = fineScore(card, fineW, fineDs);
  return card;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web-funds && npm test`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit (checkpoint)**

```bash
git add web-funds/public/lib/scoring.mjs web-funds/test/scoring.test.js
git commit -m "feat(web-funds): port fineScore + scoreFundCard recompute"
```

---

## Task 3: Golden-master parity test (scoring vs real pipeline output)

**Files:**
- Create: `web-funds/test/parity.test.js`

- [ ] **Step 1: Write `web-funds/test/parity.test.js`**

```js
// Parity: browser scoreFundCard (default weights) must reproduce research/funds' score-2026-06-27.json.
// spec §6 — the hard gate that keeps the port honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreFundCard, fineScore } from '../public/lib/scoring.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..'); // repo root
const SCORE = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/derived/score-2026-06-27.json'), 'utf8'));
const ANALYSIS = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/core/config/analysis.json'), 'utf8'));
const SHORTLIST = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/derived/shortlist-2026-06-27.json'), 'utf8'));

const cfg = {
  alphaQuality: ANALYSIS.alphaQuality, endorsement: ANALYSIS.endorsement,
  riskAdjusted: ANALYSIS.riskAdjusted, sizeRisk: ANALYSIS.sizeRisk, band: ANALYSIS.band,
};
const fineW = ANALYSIS.shortlist.fine.weights;
const fineDs = ANALYSIS.shortlist.fine.downside;
const TOL = 0.01;

function loadDossier(code) {
  const dir = path.join(ROOT, 'data/fund', code);
  if (!fs.existsSync(dir)) return null;
  const latest = fs.readdirSync(dir).filter((f) => /^fund-.*\.json$/.test(f)).sort().pop();
  return latest ? JSON.parse(fs.readFileSync(path.join(dir, latest), 'utf8')) : null;
}

test('parity: every card with a dossier reproduces alphaQuality/endorsement/band/riskAdjusted/sizeRisk', () => {
  let checked = 0, skipped = 0;
  for (const card of SCORE.cards) {
    const dossier = loadDossier(card.code);
    if (!dossier) { skipped++; continue; }
    const sf = card.scores.sectorFlow?.value ?? 0;
    const recomputed = scoreFundCard(dossier, { sectorFlowValue: sf }, cfg, fineW, fineDs);
    const aq = card.scores.alphaQuality, en = card.scores.endorsement, bc = card.scores.bandContribution, ra = card.scores.riskAdjusted;
    assert.ok(Math.abs(recomputed.alphaQualityValue - aq.value) <= TOL, `${card.code} αq ${recomputed.alphaQualityValue} vs ${aq.value}`);
    assert.equal(recomputed.alphaTier, aq.tier, `${card.code} tier`);
    assert.ok(Math.abs(recomputed.endorsementValue - en.value) <= TOL, `${card.code} endorsement`);
    assert.ok(Math.abs(recomputed.bandValue - bc.value) <= TOL, `${card.code} band`);
    assert.equal(recomputed.sizeRiskFlag, card.sizeRisk.flag, `${card.code} sizeRisk`);
    assert.equal(recomputed.captureFlag, ra.captureFlag, `${card.code} captureFlag`);
    checked++;
  }
  assert.ok(checked > 200, `only ${checked} cards checked (expected most of 317)`);
});

test('parity: fineScore (default weights) reproduces shortlist fineScore', () => {
  const byCode = Object.fromEntries(SCORE.cards.map((c) => [c.code, c]));
  for (const sl of SHORTLIST.shortlist) {
    const card = byCode[sl.code];
    const recomputed = fineScore({
      alphaTier: card.scores.alphaQuality.tier,
      downsideCapture: card.scores.riskAdjusted.downsideCapture,
      sectorFlowValue: card.scores.sectorFlow.value,
      bandValue: card.scores.bandContribution.value,
      endorsementValue: card.scores.endorsement.value,
    }, fineW, fineDs);
    assert.ok(Math.abs(recomputed - sl.fineScore) <= TOL, `${sl.code} fine ${recomputed} vs ${sl.fineScore}`);
  }
});
```

- [ ] **Step 2: Run parity test**

Run: `cd web-funds && node --test test/parity.test.js`
Expected: PASS. If any assertion fails, the port has drift — fix `scoring.mjs` until it passes (do not loosen TOL).

- [ ] **Step 3: Commit (checkpoint)**

```bash
git add web-funds/test/parity.test.js
git commit -m "test(web-funds): golden-master parity vs score-2026-06-27.json"
```

---

## Task 4: Port `screen.js` → `screening.mjs` (returns rejection gate)

**Files:**
- Create: `web-funds/public/lib/screening.mjs`
- Create: `web-funds/test/screening.test.js`

- [ ] **Step 1: Write failing test `web-funds/test/screening.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { screenRow } from '../public/lib/screening.mjs';

const t = {
  rating3Y_min: 4, rating5Y_min: 4, rating5Y_null_tolerant: true,
  longestTenure_min_years: 3, fundSize_min_yi: 2, fundSize_max_yi: 100,
  alphaToIndRankP_3Y_max: 50, sharpeRatioRankP_3Y_max: 50,
  exclude_usd_shareclass: true, defensive_drawdown_floor: -30,
};

test('screenRow: 全过的精英行 → passed', () => {
  const r = screenRow({ rating3Y: 5, rating5Y: 5, longestTenure: 4.7, fundSize: 10,
    alphaToIndRankP_3Y: 0.69, sharpeRatioRankP_3Y: 2.02, maximumDrawdown_3Y: -52, fundName: 'X' }, t);
  assert.equal(r.passed, true);
  assert.equal(r.gate, null);
});

test('screenRow: 012921 易方达全球成长精选 A(美元现汇) → gate=usd_shareclass', () => {
  const r = screenRow({ rating3Y: 5, rating5Y: null, longestTenure: 4.46, fundSize: 98.66,
    alphaToIndRankP_3Y: 1, sharpeRatioRankP_3Y: 1.74, maximumDrawdown_3Y: -20.48,
    fundName: '易方达全球成长精选混合（QDII）A(美元现汇份额)' }, t);
  assert.equal(r.passed, false);
  assert.equal(r.gate, 'usd_shareclass');     // the real bug-catcher (spec §11.10)
});

test('screenRow: 规模>100 → gate=size_cap; α排名>50 → gate=alpha_rank; 评级<4 → gate=rating3Y', () => {
  assert.equal(screenRow({ rating3Y: 5, longestTenure: 5, fundSize: 150, alphaToIndRankP_3Y: 1, sharpeRatioRankP_3Y: 1, fundName: 'A' }, t).gate, 'size_cap');
  assert.equal(screenRow({ rating3Y: 5, longestTenure: 5, fundSize: 50, alphaToIndRankP_3Y: 80, sharpeRatioRankP_3Y: 1, fundName: 'A' }, t).gate, 'alpha_rank');
  assert.equal(screenRow({ rating3Y: 3, longestTenure: 5, fundSize: 50, alphaToIndRankP_3Y: 1, sharpeRatioRankP_3Y: 1, fundName: 'A' }, t).gate, 'rating3Y');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web-funds && node --test test/screening.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web-funds/public/lib/screening.mjs`**

```js
// lib/screening.mjs — PURE port of research/funds/analyze/screen.js.
// Difference: returns {passed, gate, detail} instead of silently `continue`-ing.
// Gate order matches screen.js so the FIRST firing gate is reported.
const USD_RE = /美元|USD|US\$|美金/;

// null policy mirrors screen.js: missing percentile/rating5Y → keep; structural (rating3Y/tenure/size-floor) → null fails.
export function screenRow(r, t) {
  if (r.rating3Y == null || r.rating3Y < t.rating3Y_min) return { passed: false, gate: 'rating3Y', detail: { rating3Y: r.rating3Y } };
  if (r.longestTenure == null || r.longestTenure < t.longestTenure_min_years) return { passed: false, gate: 'longest_tenure', detail: { longestTenure: r.longestTenure } };
  if (r.fundSize == null || r.fundSize < t.fundSize_min_yi) return { passed: false, gate: 'size_floor', detail: { fundSize: r.fundSize } };
  if (r.alphaToIndRankP_3Y != null && r.alphaToIndRankP_3Y > t.alphaToIndRankP_3Y_max) return { passed: false, gate: 'alpha_rank', detail: { alphaToIndRankP_3Y: r.alphaToIndRankP_3Y } };
  if (r.sharpeRatioRankP_3Y != null && r.sharpeRatioRankP_3Y > t.sharpeRatioRankP_3Y_max) return { passed: false, gate: 'sharpe_rank', detail: { sharpeRatioRankP_3Y: r.sharpeRatioRankP_3Y } };
  if (r.rating5Y != null && r.rating5Y < t.rating5Y_min) return { passed: false, gate: 'rating5Y', detail: { rating5Y: r.rating5Y } };
  if (r.fundSize != null && r.fundSize > t.fundSize_max_yi) return { passed: false, gate: 'size_cap', detail: { fundSize: r.fundSize } };
  if (t.exclude_usd_shareclass && r.fundName && USD_RE.test(r.fundName)) return { passed: false, gate: 'usd_shareclass', detail: { fundName: r.fundName } };
  const defensive = t.defensive_drawdown_floor != null && r.maximumDrawdown_3Y != null && r.maximumDrawdown_3Y >= t.defensive_drawdown_floor;
  return { passed: true, gate: null, detail: { defensive } };
}

export function screenAll(rows, t) {
  const passed = [], rejected = [];
  for (const r of rows) {
    const res = screenRow(r, t);
    if (res.passed) passed.push({ ...r, defensive: res.detail.defensive });
    else rejected.push({ row: r, gate: res.gate, detail: res.detail });
  }
  return { passed, rejected };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web-funds && node --test test/screening.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (checkpoint)**

```bash
git add web-funds/public/lib/screening.mjs web-funds/test/screening.test.js
git commit -m "feat(web-funds): port screen.js → screening.mjs with rejection-gate output"
```

---

## Task 5: Screening parity + lock the 012921 case

**Files:**
- Modify: `web-funds/test/screening.test.js` (append parity)

- [ ] **Step 1: Append parity test to `web-funds/test/screening.test.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenAll } from '../public/lib/screening.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

test('parity: default thresholds过关 set == candidates-2026-06-26.json (by id)', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/snapshots/2026-06-26.json'), 'utf8'));
  const cands = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/derived/candidates-2026-06-26.json'), 'utf8'));
  const thresholds = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/core/config/thresholds.json'), 'utf8'));
  const { passed } = screenAll(snap.rows, thresholds);
  const passedIds = new Set(passed.map((r) => r.id));
  const candIds = new Set((cands.rows || cands).map((r) => r.id || r.code));
  // every candidate must be in our passed set
  for (const id of candIds) assert.ok(passedIds.has(id), `candidate ${id} not reproduced`);
  assert.equal(passedIds.size, candIds.size, `passed ${passedIds.size} vs candidates ${candIds.size}`);
});

test('parity: 012921 (易方达全球成长精选 A 美元现汇) is rejected as usd_shareclass', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/store/snapshots/2026-06-26.json'), 'utf8'));
  const thresholds = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/funds/core/config/thresholds.json'), 'utf8'));
  const { rejected } = screenAll(snap.rows, thresholds);
  const row = rejected.find((x) => x.row.id === '012921');
  assert.ok(row, '012921 must be in snapshot');
  assert.equal(row.gate, 'usd_shareclass');        // regression lock (spec §11.10)
  assert.match(row.row.fundName, /美元/);
});
```

- [ ] **Step 2: Run test**

Run: `cd web-funds && node --test test/screening.test.js`
Expected: PASS (6 tests). If the parity count mismatches, a gate ordering or threshold differs from screen.js — fix `screening.mjs`.

- [ ] **Step 3: Commit (checkpoint)**

```bash
git add web-funds/test/screening.test.js
git commit -m "test(web-funds): screening parity vs candidates + lock 012921 USD case"
```

---

## Task 6: Pure UI helpers (`ui-util.mjs`)

**Files:**
- Create: `web-funds/public/lib/ui-util.mjs`
- Create: `web-funds/test/ui-util.test.js`

- [ ] **Step 1: Write failing test `web-funds/test/ui-util.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeights, computeDelta, tierBadgeClass, gateLabel, fmt } from '../public/lib/ui-util.mjs';

test('normalizeWeights: 拖大一个，其余按比例让位，Σ=1', () => {
  const w = { trueAlpha: 0.4, downsideProtection: 0.25, sectorFlow: 0.15, band: 0.1, endorsement: 0.1 };
  const out = normalizeWeights(w, 'sectorFlow', 0.45);   // sectorFlow 0.15→0.45, rest shrink
  assert.ok(Math.abs(Object.values(out).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(out.sectorFlow, 0.45);
  assert.ok(out.trueAlpha < 0.4);                         // others shrank
});

test('computeDelta: +rank = 上升 (green)', () => {
  assert.equal(computeDelta(5, 3), { delta: 2, dir: 'up' }.delta);
  assert.equal(computeDelta(3, 5).dir, 'dn');
  assert.equal(computeDelta(4, 4).dir, 'flat');
});

test('tierBadgeClass / gateLabel / fmt', () => {
  assert.equal(tierBadgeClass('true_alpha'), 'true');
  assert.equal(tierBadgeClass('mixed'), 'mix');
  assert.equal(tierBadgeClass('industry_beta_pseudo'), 'beta');
  assert.equal(gateLabel('usd_shareclass'), 'USD份额');
  assert.equal(gateLabel('size_cap'), '规模>100亿');
  assert.equal(fmt(0.834, 'pct1'), '83.4%');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web-funds && node --test test/ui-util.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web-funds/public/lib/ui-util.mjs`**

```js
// lib/ui-util.mjs — PURE UI helpers (testable, no DOM).
export function normalizeWeights(w, changedKey, newVal) {
  const keys = Object.keys(w);
  const others = keys.filter((k) => k !== changedKey);
  const oldOthersSum = others.reduce((s, k) => s + w[k], 0);
  const remaining = Math.max(0, 1 - newVal);
  const out = { ...w, [changedKey]: newVal };
  if (oldOthersSum <= 0) {
    // others all zero → split remaining equally
    others.forEach((k) => { out[k] = remaining / others.length; });
  } else {
    others.forEach((k) => { out[k] = (w[k] / oldOthersSum) * remaining; });
  }
  return out;
}

export function computeDelta(baselineRank, currentRank) {
  const delta = baselineRank - currentRank;   // positive = moved up
  return { delta, dir: delta > 0 ? 'up' : delta < 0 ? 'dn' : 'flat' };
}

export function tierBadgeClass(tier) {
  return tier === 'true_alpha' ? 'true' : tier === 'mixed' ? 'mix' : tier === 'industry_beta_pseudo' ? 'beta' : 'none';
}

const GATE_LABELS = {
  rating3Y: '评级3Y', rating5Y: '评级5Y', longest_tenure: '任期<3y',
  size_floor: '规模<2亿', size_cap: '规模>100亿',
  alpha_rank: 'α排名', sharpe_rank: '夏普排名', usd_shareclass: 'USD份额',
  trailing: '历史档案/服务端层',
};
export function gateLabel(g) { return GATE_LABELS[g] || g; }

export function fmt(v, kind) {
  if (v == null) return '—';
  if (kind === 'pct1') return (v * 100).toFixed(1) + '%';
  if (kind === 'pct0') return (v * 100).toFixed(0) + '%';
  if (kind === 'fixed2') return v.toFixed(2);
  if (kind === 'yi') return v.toFixed(1) + '亿';
  if (kind === 'score') return '.' + Math.round(v * 100).toString().padStart(2, '0');
  return String(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web-funds && node --test test/ui-util.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit (checkpoint)**

```bash
git add web-funds/public/lib/ui-util.mjs web-funds/test/ui-util.test.js
git commit -m "feat(web-funds): pure UI helpers (normalize/delta/labels/formatters)"
```

---

## Task 7: Server — `/api/bundle` + static + SSE

**Files:**
- Create: `web-funds/server.js`
- Create: `web-funds/test/server.test.js`

- [ ] **Step 1: Write failing test `web-funds/test/server.test.js`** (tests the bundle builder, not the http server)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from '../server.js';

test('buildBundle: 加载 snapshot/score/candidates/changes + 尾部 dossier 计数', () => {
  const b = buildBundle();
  assert.equal(b.asOfDate, '2026-06-27');
  assert.equal(b.fundCount, 317);
  assert.ok(b.snapshot.count === 394);
  assert.ok(Array.isArray(b.snapshot.rows) && b.snapshot.rows.length === 394);
  assert.equal(b.cards.length, 317);
  assert.ok(b.defaults.fineWeights && b.defaults.fineWeights.trueAlpha === 0.4);
  assert.ok(b.screenThresholds.rating3Y_min === 4);
  assert.ok(Array.isArray(b.changes));
  assert.ok(Object.keys(b.dossiers).length > 200, 'dossiers loaded');
});

test('buildBundle: heatmap sectors 非空 + ranked 数组', () => {
  const b = buildBundle();
  assert.ok(b.heatmap.sectors.length > 0);
  assert.ok(Array.isArray(b.ranked.bySectorFlow));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web-funds && node --test test/server.test.js`
Expected: FAIL — `server.js` not found / buildBundle not exported.

- [ ] **Step 3: Write `web-funds/server.js`**

```js
// server.js — fund-eval web: /api/bundle + static + SSE hot-reload. 0 deps.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8766;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DERIVED = path.join(ROOT, 'research/funds/store/derived');
const SNAPSHOTS = path.join(ROOT, 'research/funds/store/snapshots');
const CHANGES = path.join(ROOT, 'research/funds/store/changes');
const CONFIG = path.join(ROOT, 'research/funds/core/config');
const FUND_DATA = path.join(ROOT, 'data/fund');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function latest(dir, re) {
  const f = fs.readdirSync(dir).filter((x) => re.test(x)).sort().pop();
  return f ? path.join(dir, f) : null;
}
function loadDossier(code) {
  const dir = path.join(FUND_DATA, code);
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => /^fund-.*\.json$/.test(x)).sort().pop();
  return f ? readJSON(path.join(dir, f)) : null;
}

// 🔴 Keep the bundle LEAN: dossier fields needed for live recompute + detail card only (spec §3.2).
function slimDossier(d) {
  if (!d) return null;
  return {
    description: { code: d.description?.code, name: d.description?.name, category: d.description?.category,
      fundType: d.description?.fundType, styleBox: d.description?.styleBox, aumYi: d.description?.aumYi,
      nav: d.description?.nav, asOfDate: d.description?.asOfDate, riskLevel: d.description?.riskLevel },
    performance: { trailing: d.performance?.trailing, annual: d.performance?.annual, annualPeer: d.performance?.annualPeer,
      ratings: d.performance?.ratings, attribution: d.performance?.attribution },
    risk: d.risk, fees: d.fees,
    portfolio: { topHoldings: d.portfolio?.topHoldings?.slice(0, 5), sectorAllocation: d.portfolio?.sectorAllocation, assetAllocation: d.portfolio?.assetAllocation },
    holders: d.holders, manager: d.manager,
  };
}

export function buildBundle() {
  const score = readJSON(latest(DERIVED, /^score-.*\.json$/));
  const shortlist = readJSON(latest(DERIVED, /^shortlist-.*\.json$/));
  const candidates = readJSON(latest(DERIVED, /^candidates-.*\.json$/));
  const analysis = readJSON(path.join(CONFIG, 'analysis.json'));
  const thresholds = readJSON(path.join(CONFIG, 'thresholds.json'));
  const snapshot = readJSON(latest(SNAPSHOTS, /^\d{4}-.*\.json$/) || latest(SNAPSHOTS, /.*/));
  const changesFile = latest(CHANGES, /^\d{4}-.*\.json$/);
  const changes = changesFile ? readJSON(changesFile).events : [];

  const candidateIds = new Set((candidates.rows || candidates).map((r) => r.id || r.code));
  const dossiers = {};
  for (const code of Object.keys(score.ranked?.bySectorFlow || {}).length ? score.cards.map((c) => c.code) : score.cards.map((c) => c.code)) {
    const d = loadDossier(code);
    if (d) dossiers[code] = slimDossier(d);
  }
  void candidateIds;

  return {
    asOfDate: score.date, fundCount: score.fundCount, heatmap: score.sectorFlowHeatmap, ranked: score.ranked,
    cards: score.cards, shortlist: shortlist.shortlist, widePool: shortlist.stage1?.widePool,
    snapshot: { count: snapshot.count, date: snapshot.date, rows: snapshot.rows },
    changes,
    defaults: { fineWeights: analysis.shortlist.fine.weights, downside: analysis.shortlist.fine.downside,
      alphaSub: analysis.alphaQuality.weights, alphaThresholds: analysis.alphaQuality.tierThresholds,
      alphaDivisor: analysis.alphaQuality.alpha5yNormalizeDivisor,
      endorsementWeights: analysis.endorsement.weights, endorsementRatingMax: analysis.endorsement.ratingMax,
      riskFloor: analysis.riskAdjusted.rSquaredTrustFloor, sizeRisk: analysis.sizeRisk, bearYear: analysis.band.bearYear },
    screenThresholds: thresholds,
    dossiers,
  };
}

let bundleCache = null;
function getBundle() { if (!bundleCache) bundleCache = buildBundle(); return bundleCache; }

// SSE
const sseClients = new Set();
function broadcast(reason) {
  const payload = JSON.stringify({ reason });
  for (const c of sseClients) { try { c.write(`event: reload\ndata: ${payload}\n\n`); } catch (_) {} }
}
let reloadTimer = null;
function scheduleReload(reason) {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { reloadTimer = null; broadcast(reason); }, 200);
}
try {
  fs.watch(PUBLIC_DIR, { recursive: true }, (_e, f) => { if (f && !/mockups|\.git/.test(f)) scheduleReload(`public/${f}`); });
} catch (_) {}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/bundle') {
    res.setHeader('Content-Type', MIME['.json']);
    res.end(JSON.stringify(getBundle()));
    return;
  }
  if (url.pathname === '/api/health') { res.setHeader('Content-Type', MIME['.json']); res.end(JSON.stringify({ ok: true })); return; }
  if (url.pathname === '/sse') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({})}\n\n`);
    sseClients.add(res);
    const hb = setInterval(() => { try { res.write(`: ping\n\n`); } catch (_) { clearInterval(hb); } }, 25000);
    req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
    return;
  }
  let fp = url.pathname === '/' ? '/index.html' : url.pathname;
  fp = path.join(PUBLIC_DIR, fp);
  if (!fp.startsWith(PUBLIC_DIR)) { res.statusCode = 403; res.end('Forbidden'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end(`404: ${url.pathname}`); return; }
    res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
    res.end(data);
  });
});
server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.error(`[error] port ${PORT} in use`); process.exit(1); } throw e; });
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => console.log(`\n📊 fund-eval-web on http://localhost:${PORT}\n   bundle: ${getBundle().fundCount} funds, ${getBundle().snapshot.count} server rows\n   SSE hot-reload at /sse\n`));
}
export { server };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web-funds && node --test test/server.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Smoke-run the server (manual)**

Run: `cd web-funds && node server.js` (background), then `curl -s http://localhost:8766/api/health` → `{"ok":true}`. Stop it after.

- [ ] **Step 6: Commit (checkpoint)**

```bash
git add web-funds/server.js web-funds/test/server.test.js
git commit -m "feat(web-funds): server with /api/bundle + static + SSE"
```

---

## Task 8: `style.css` + `index.html` shell

**Files:**
- Create: `web-funds/public/style.css` (lift from the approved mockup)
- Create: `web-funds/public/index.html`

- [ ] **Step 1: Create `web-funds/public/style.css`** — copy the full CSS from the approved mockup at `.superpowers/brainstorm/1556-1782519575/content/design-mockup.html` (the `:root` vars through `.report-link`). Add dark-theme overrides + mode/audit styles:

Append after the mockup's CSS:

```css
[data-theme="dark"] {
  --bg:#0f1419; --surface:#1a1d21; --text:#e8eaed; --muted:#9aa0a8; --faint:#6b7280;
  --line:#2a2e35; --line2:#22262c; --tint:#1e2533; --tint2:#171c24;
  --primary:#60a5fa; --pos:#34d399; --neg:#f87171; --warn:#fbbf24;
}
.mode-switch { display:flex; gap:2px; padding:0 14px 8px; }
.mode-switch button { font-family:inherit; font-size:11px; padding:4px 12px; border:1px solid var(--line);
  background:var(--surface); color:var(--muted); cursor:pointer; border-radius:6px; }
.mode-switch button.on { background:var(--primary); color:#fff; border-color:var(--primary); font-weight:600; }
.work.audit { grid-template-columns: 1fr; }             /* 出局审计 = single wide pane */
.waterfall { display:flex; align-items:stretch; gap:0; padding:10px 14px; }
.waterfall .step { flex:1; padding:8px 10px; background:var(--tint); border:1px solid var(--line);
  border-radius:6px; margin-right:8px; }
.waterfall .step b { font-family:'IBM Plex Mono',monospace; font-size:18px; color:var(--primary); }
.waterfall .arrow { display:flex; align-items:center; color:var(--faint); margin-right:8px; }
.excl-table { width:100%; border-collapse:collapse; font-size:12px; }
.excl-table th { font-size:9px; text-transform:uppercase; letter-spacing:.5px; color:var(--faint);
  text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
.excl-table td { padding:5px 8px; border-bottom:1px solid var(--line2); }
.excl-table tr:hover { background:var(--tint2); cursor:pointer; }
.gate-badge { font-size:9px; padding:1px 6px; border-radius:8px; background:#fee2e2; color:#b91c1c; font-weight:600; white-space:nowrap; }
[data-theme="dark"] .gate-badge { background:#3a1d1d; color:#f87171; }
.hidden { display:none !important; }
```

(The full base CSS — `:root`, `.topbar`, `.phil`, `.work`, `.pane`, `.scorer`, `.slider`, `.list .row`, `.detail`, `.bars`, `.narr`, `.ann`, `.hold`, etc. — is copied verbatim from the mockup's `<style>` block.)

- [ ] **Step 2: Create `web-funds/public/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>基金评估 · 假设推演</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header id="topbar"></header>
  <div class="mode-switch" id="mode-switch"></div>
  <!-- 推演模式：三栏 -->
  <div class="work" id="work-score">
    <section class="pane" id="pane-scorer"></section>
    <section class="pane" id="pane-list"></section>
    <section class="pane" id="pane-detail"></section>
  </div>
  <!-- 出局审计模式：单栏 -->
  <div class="work audit hidden" id="work-audit"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify** — open `index.html` serves (after Task 9 wires it); for now just confirm files exist and CSS has `:root` + `[data-theme="dark"]`.

Run: `cd web-funds && node -e "import('fs').then(fs=>{const c=fs.readFileSync('public/style.css','utf8');if(!c.includes('--primary')||!c.includes('[data-theme=\"dark\"]'))throw new Error('css missing');console.log('css ok')})"`
Expected: `css ok`.

- [ ] **Step 4: Commit (checkpoint)**

```bash
git add web-funds/public/style.css web-funds/public/index.html
git commit -m "feat(web-funds): editorial CSS (light/dark) + index.html shell"
```

---

## Task 9: `app.js` orchestration + `topbar.js`

**Files:**
- Create: `web-funds/public/app.js`
- Create: `web-funds/public/views/topbar.js`

- [ ] **Step 1: Create `web-funds/public/views/topbar.js`**

```js
// views/topbar.js — renders editorial top bar + mode switch + theme toggle.
import { fmt } from '../lib/ui-util.mjs';

export function renderTopbar(state, onMode) {
  const b = state.bundle;
  const heat = b.heatmap.sectors.slice(0, 5)
    .map((s) => `<span style="background:var(--primary);opacity:${Math.max(0.08, s.rankNorm)}">${s.sector.slice(0, 1)}</span>`).join('');
  document.getElementById('topbar').innerHTML = `
    <div class="topbar">
      <div class="top-row1">
        <div class="brand">
          <h1>基金评估 · 假设推演</h1>
          <div class="sub">单源 <b>morningstar.cn</b> · ${b.fundCount} 只 · 快照 <b>${b.asOfDate}</b> · 波段判定（非长期赢家）</div>
        </div>
        <div class="top-right">
          <div class="count-pill">服务端 <b>${b.snapshot.count}</b> · 候选 <b>${b.cards.filter(c=>state.candidateIds.has(c.code)).length}</b> · shortlist <b>${b.shortlist.length}</b></div>
          <div class="heat-mini"><div class="lbl">板块资金流向</div><div class="heat-cells">${heat}</div></div>
          <div class="toggle" id="theme-toggle" title="明/暗"></div>
        </div>
      </div>
      <div class="phil">
        <div class="chip"><span class="n">#1-2</span>怀疑·不迷信长期赢家</div>
        <div class="chip"><span class="n">#3</span>确信·阶段性真超额存在</div>
        <div class="chip"><span class="n">#4</span>复利=波段叠加</div>
        <div class="chip"><span class="n">#5</span>识别在炒什么</div>
        <div class="chip gold"><span class="n">#6</span>钱最多=板块景气（非规模）</div>
      </div>
    </div>`;
  document.getElementById('theme-toggle').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('fe-theme', next);
  };
  const ms = document.getElementById('mode-switch');
  ms.innerHTML = ['score', 'audit'].map((m) =>
    `<button class="${state.mode === m ? 'on' : ''}" data-mode="${m}">${m === 'score' ? '推演' : '出局审计'}</button>`).join('');
  ms.querySelectorAll('button').forEach((btn) => { btn.onclick = () => onMode(btn.dataset.mode); });
}
```

- [ ] **Step 2: Create `web-funds/public/app.js`**

```js
// app.js — state + wiring. Pure scoring lives in lib/; views only render.
import { fineScore } from './lib/scoring.mjs';
import { screenAll } from './lib/screening.mjs';
import { renderTopbar } from './views/topbar.js';
import { renderScorer, bindScorer } from './views/scorer.js';
import { renderRankedList } from './views/ranked-list.js';
import { renderDetailCard } from './views/detail-card.js';
import { renderAudit } from './views/audit.js';

const state = {
  bundle: null, mode: 'score',
  candidateIds: new Set(),
  weights: null, downside: null, advanced: null,   // live tunable knobs
  baselineRank: new Map(),                          // code -> rank under default weights
  selectedCode: null,
  filterChips: { true_alpha: true, mixed: false, beta: false, star5: false, large: false, size100: false },
};

async function init() {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('fe-theme') || 'light');
  state.bundle = await (await fetch('/api/bundle')).json();
  const d = state.bundle.defaults;
  state.weights = { ...d.fineWeights };
  state.downside = { ...d.downside };
  state.advanced = { alphaSub: { ...d.alphaSub }, alphaThresholds: { ...d.alphaThresholds }, endorsementW: { ...d.endorsementWeights } };
  state.candidateIds = new Set((state.bundle.cards || []).filter((c) => true).map((c) => c.code));  // 317 scored
  computeBaseline();
  state.selectedCode = state.bundle.shortlist[0]?.code || state.bundle.cards[0]?.code;
  render();
  // SSE hot reload
  const es = new EventSource('/sse');
  es.addEventListener('reload', () => location.reload());
}

// Recompute every card's fineScore under CURRENT weights, rank, update baseline-delta.
export function recompute() {
  const cards = state.bundle.cards.map((c) => {
    const sub = c.scores;
    const card = {
      alphaTier: sub.alphaQuality.tier,
      downsideCapture: sub.riskAdjusted.downsideCapture,
      sectorFlowValue: sub.sectorFlow.value, bandValue: sub.bandContribution.value, endorsementValue: sub.endorsement.value,
      code: c.code, name: c.name, flags: c.flags, sizeRiskFlag: c.sizeRisk.flag, aumYi: c.sizeRisk.aumYi,
      alpha: sub.alphaQuality, sf: sub.sectorFlow, narrative: c.narrative,
    };
    card.fineScore = fineScore(card, state.weights, state.downside);
    return card;
  });
  cards.sort((a, b) => b.fineScore - a.fineScore);
  state.ranked = cards;
  state.ranked.forEach((c, i) => (c.rank = i + 1));
}

function computeBaseline() {
  const d = state.bundle.defaults;
  const base = { weights: d.fineWeights, downside: d.downside };
  const cards = state.bundle.cards.map((c) => {
    const s = c.scores;
    const fs = fineScore({ alphaTier: s.alphaQuality.tier, downsideCapture: s.riskAdjusted.downsideCapture,
      sectorFlowValue: s.sectorFlow.value, bandValue: s.bandContribution.value, endorsementValue: s.endorsement.value }, base.weights, base.downside);
    return { code: c.code, fs };
  }).sort((a, b) => b.fs - a.fs);
  base.ranks = new Map(cards.map((c, i) => [c.code, i + 1]));
  state.baselineRank = base.ranks;
}

function render() {
  recompute();
  renderTopbar(state, setMode);
  if (state.mode === 'score') {
    document.getElementById('work-score').classList.remove('hidden');
    document.getElementById('work-audit').classList.add('hidden');
    renderScorer(state, onWeightsChange);
    renderRankedList(state, onSelect);
    renderDetailCard(state);
    bindScorer(state, onWeightsChange);
  } else {
    document.getElementById('work-score').classList.add('hidden');
    document.getElementById('work-audit').classList.remove('hidden');
    renderAudit(state, onSelect);
  }
}

function onWeightsChange() { render(); }   // slider moved → full re-render (cheap at 317)
function setMode(m) { state.mode = m; render(); }
function onSelect(code) { state.selectedCode = code; if (state.mode === 'score') renderDetailCard(state); }

init();
```

- [ ] **Step 3: Run server + load in browser (manual smoke)**

Run: `cd web-funds && node server.js` (background), open http://localhost:8766. Expect: top bar + (empty) panes render without console errors (views not yet wired to produce content — Tasks 10–13 fill them). If module-import errors appear, fix paths.

- [ ] **Step 4: Commit (checkpoint)**

```bash
git add web-funds/public/app.js web-funds/public/views/topbar.js
git commit -m "feat(web-funds): app orchestration + topbar (mode switch, theme, heatmap mini)"
```

---

## Task 10: `scorer.js` — 推演 panel (sliders + normalization + advanced)

**Files:**
- Create: `web-funds/public/views/scorer.js`

- [ ] **Step 1: Create `web-funds/public/views/scorer.js`**

```js
// views/scorer.js — slider panel. Reads/writes state.weights (5) + state.advanced.
import { normalizeWeights } from '../lib/ui-util.mjs';

const FINE_KEYS = [
  ['trueAlpha', '真 α 选股'], ['downsideProtection', '下行保护'], ['sectorFlow', '板块流向'],
  ['band', '区间贡献'], ['endorsement', '背书'],
];

export function renderScorer(state) {
  const w = state.weights;
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const sliders = FINE_KEYS.map(([k, label]) => `
    <div class="slider"><div class="lab"><span>${label}</span><b>${w[k].toFixed(2)}</b></div>
      <div class="track"><div class="fill" style="width:${(w[k] / 1) * 100}%"></div>
        <input type="range" min="0" max="1" step="0.01" value="${w[k]}" data-key="${k}" class="knob-input" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:12px;top:-4px"></div></div>`).join('');
  const a = state.advanced;
  const adv = `
    <details class="adv">
      <summary>高级 · α 子权重 / 阈值 / 背书子权重</summary>
      ${[['alphaSub', 'stockAlphaRatio', 'α·选股占比'], ['alphaSub', 'annualizedAlpha5yNorm', 'α·5y年化'], ['alphaSub', 'tenureNorm', 'α·任期']]
        .map(([grp, k, label]) => sliderHtml(`${grp}.${k}`, label, a[grp][k])).join('')}
      ${sliderHtml('alphaThresholds.trueAlpha', '真α 阈值', a.alphaThresholds.trueAlpha)}
      ${[['endorsementW', 'institutional', '背书·机构'], ['endorsementW', 'insiders', '背书·内部人'], ['endorsementW', 'fof', '背书·FOF'], ['endorsementW', 'ratings', '背书·评级']]
        .map(([grp, k, label]) => sliderHtml(`${grp}.${k}`, label, a[grp][k])).join('')}
      <div class="slider"><div class="lab"><span>下行捕获 floor / ceil</span><b>${state.downside.floor} / ${state.downside.ceil}</b></div></div>
      <p style="font-size:10px;color:var(--faint)">🔴 sectorFlow 内部权重改不了（池依赖，需 Node 重跑）——见 spec §5.4</p>
    </details>`;
  document.getElementById('pane-scorer').innerHTML = `
    <div class="pane-h">推演面板 <span class="accent">权重实时</span></div>
    <div class="scorer">
      <div class="wgroup"><div class="gtitle">精排权重 <span class="sum">Σ = ${sum.toFixed(2)}</span></div>${sliders}</div>
      ${adv}
      <button class="reset" id="reset-weights">↺ 恢复默认权重</button>
    </div>`;
}
function sliderHtml(dataKey, label, val) {
  return `<div class="slider"><div class="lab"><span>${label}</span><b>${val.toFixed(2)}</b></div>
    <div class="track"><div class="fill" style="width:${val * 100}%"></div>
      <input type="range" min="0" max="1" step="0.01" value="${val}" data-adv="${dataKey}" class="knob-input" style="position:absolute;inset:0;opacity:0;width:100%;height:12px;top:-4px"></div></div>`;
}

export function bindScorer(state, onChange) {
  const root = document.getElementById('pane-scorer');
  root.querySelectorAll('input[data-key]').forEach((inp) => {
    inp.oninput = () => {
      state.weights = normalizeWeights(state.weights, inp.dataset.key, parseFloat(inp.value));
      onChange();
    };
  });
  root.querySelectorAll('input[data-adv]').forEach((inp) => {
    inp.oninput = () => {
      const [grp, k] = inp.dataset.adv.split('.');
      state.advanced[grp][k] = parseFloat(inp.value);
      onChange();
    };
  });
  document.getElementById('reset-weights').onclick = () => {
    const d = state.bundle.defaults;
    state.weights = { ...d.fineWeights };
    state.advanced = { alphaSub: { ...d.alphaSub }, alphaThresholds: { ...d.alphaThresholds }, endorsementW: { ...d.endorsementWeights } };
    onChange();
  };
}
```

> **Note:** v1 advanced sliders mutate `state.advanced` but `recompute()` (Task 9) currently uses the card's precomputed sub-scores. Wiring advanced α/endorsement weights to actually re-run `scoreFundCard` is a follow-on (spec §5.1 marks them live-capable); the 5 fine-weight sliders are the headline live feature and fully work. Leave a `// TODO(v1.1): advanced recompute via scoreFundCard` comment.

- [ ] **Step 2: Run server + browser smoke**

Run: `cd web-funds && node server.js`, open http://localhost:8766. Drag the 真α slider → list re-renders with new order + Δ (after Task 11). Confirm slider fills move and Σ stays ≈1.

- [ ] **Step 3: Commit (checkpoint)**

```bash
git add web-funds/public/views/scorer.js
git commit -m "feat(web-funds): scorer panel (5 live weight sliders + advanced + reset)"
```

---

## Task 11: `ranked-list.js` — 实时排名 + filter + Δ

**Files:**
- Create: `web-funds/public/views/ranked-list.js`

- [ ] **Step 1: Create `web-funds/public/views/ranked-list.js`**

```js
// views/ranked-list.js — live-ranked list with filter chips + Δ vs baseline.
import { computeDelta, tierBadgeClass, fmt } from '../lib/ui-util.mjs';

const CHIPS = [['true_alpha', '真α'], ['mixed', '混合'], ['beta', '伪α'], ['star5', '5★'], ['large', '大盘成长'], ['size100', '<100亿']];

export function renderRankedList(state, onSelect) {
  const f = state.filterChips;
  const rows = state.ranked.filter((c) => {
    if (f.true_alpha && c.alphaTier !== 'true_alpha') return false;
    if (f.mixed && c.alphaTier !== 'mixed') return false;
    if (f.beta && c.alphaTier !== 'industry_beta_pseudo' && c.alphaTier !== 'no_brinion') return false;
    if (f.star5 && !(c.alpha?.ratings?.rating3Y >= 5)) return false;
    if (f.large && !(c.sf?.liquidity?.styleBoxTier?.includes?.('大盘') || c.narrative?.sectorFlowVerdict?.includes('大盘'))) return false;
    if (f.size100 && !(c.aumYi != null && c.aumYi < 100)) return false;
    return true;
  });
  const chipsHtml = CHIPS.map(([k, label]) =>
    `<div class="fchip ${f[k] ? 'on' : ''}" data-chip="${k}">${label}</div>`).join('');
  document.getElementById('pane-list').innerHTML = `
    <div class="pane-h">实时排名 <span>${state.ranked.length} 只 · 拖权重即时重排</span></div>
    <div class="filters" id="filter-chips">${chipsHtml}</div>
    <div class="sortbar"><span style="width:50px"># / Δ</span><span style="width:54px">代码</span><span style="flex:1">名称</span><span style="width:46px">分层</span><span style="width:38px;text-align:right">分数</span></div>
    <div class="list">${rows.map((c) => rowHtml(c, state, onSelect)).join('')}</div>`;
  document.getElementById('filter-chips').querySelectorAll('.fchip').forEach((ch) => {
    ch.onclick = () => { state.filterChips[ch.dataset.chip] = !state.filterChips[ch.dataset.chip]; renderRankedList(state, onSelect); };
  });
}

function rowHtml(c, state, onSelect) {
  const base = state.baselineRank.get(c.code) ?? c.rank;
  const { delta, dir } = computeDelta(base, c.rank);
  const deltaCls = dir === 'up' ? 'up' : dir === 'dn' ? 'dn' : 'flat';
  const deltaTxt = dir === 'flat' ? '—' : (dir === 'up' ? '▲' : '▼') + Math.abs(delta);
  const sel = c.code === state.selectedCode ? 'sel' : '';
  return `<div class="row ${sel}" data-code="${c.code}">
    <div class="rk">${c.rank}</div><div class="delta ${deltaCls}">${deltaTxt}</div>
    <div class="code">${c.code}</div><div class="nm">${c.name}</div>
    <div class="tier ${tierBadgeClass(c.alphaTier)}">${tierLabel(c.alphaTier)}</div>
    <div class="sf">${fmt(c.fineScore, 'score')}</div></div>`;
}
function tierLabel(t) { return t === 'true_alpha' ? '真α' : t === 'mixed' ? '混合' : t === 'industry_beta_pseudo' ? '伪α' : '—'; }

// delegate clicks (bound once from app.js would be cleaner, but inline re-render is fine at 317)
export function bindList(state, onSelect) {
  document.getElementById('pane-list').addEventListener('click', (e) => {
    const row = e.target.closest('.row'); if (row) onSelect(row.dataset.code);
  });
}
```

- [ ] **Step 2: Wire `bindList` in `app.js`** — in `render()` score branch, after `renderRankedList`, add `bindList(state, onSelect);` (import it). Guard against double-binding with a flag.

- [ ] **Step 3: Browser smoke** — drag 真α slider → order changes, Δ arrows appear (▲/▼/—). Click a row → detail updates.

- [ ] **Step 4: Commit (checkpoint)**

```bash
git add web-funds/public/views/ranked-list.js web-funds/public/app.js
git commit -m "feat(web-funds): ranked list (filter chips + live Δ vs baseline)"
```

---

## Task 12: `detail-card.js` — judgment card

**Files:**
- Create: `web-funds/public/views/detail-card.js`

- [ ] **Step 1: Create `web-funds/public/views/detail-card.js`**

```js
// views/detail-card.js — selected fund judgment card (推演 + 出局审计 share it).
import { fmt } from '../lib/ui-util.mjs';

export function renderDetailCard(state) {
  const code = state.selectedCode;
  const card = state.ranked?.find((c) => c.code === code);
  const raw = state.bundle.cards.find((c) => c.code === code);
  const d = state.bundle.dossiers[code];
  const pane = document.getElementById('pane-detail');
  if (!raw) { pane.innerHTML = '<div class="pane-h">详情</div><div class="detail">选一只基金查看判定卡</div>'; return; }
  const s = raw.scores;
  const flags = raw.flags.map(flagChip).join('') + flagChip(`规模 ${raw.sizeRisk.flag === 'ok' ? '✓' : raw.sizeRisk.flag}`, raw.sizeRisk.flag === 'ok' ? 'good' : 'risk');
  const bars = [
    ['α 质量', s.alphaQuality.value, s.alphaQuality.value >= 0.7 ? 'pos' : ''],
    ['区间贡献', s.bandContribution.value, ''], ['板块流向', s.sectorFlow.value, ''],
    ['背书', s.endorsement.value, ''],
    ['下行保护', downQ(s.riskAdjusted.downsideCapture, state), 'pos'],
  ].map(barHtml).join('');
  const n = raw.narrative;
  const ann = d?.performance?.annual ? annualBars(d.performance.annual, d.performance.annualPeer) : '';
  const hold = (d?.portfolio?.topHoldings || []).slice(0, 5)
    .map((h) => `<div class="h"><span>${h.name} · ${h.industry}</span><span class="p">${fmt(h.weightPct, 'fixed2')}%</span></div>`).join('');
  const r = d?.risk || {};
  pane.innerHTML = `
    <div class="pane-h">选中基金 · 判定卡 <span class="accent">${code}</span></div>
    <div class="detail">
      <div class="d-name">${raw.name}</div>
      <div class="d-meta">${code} · ${d?.description?.category || ''} · ${d?.description?.styleBox || ''} · 规模 ${fmt(d?.description?.aumYi, 'yi')} · as-of ${d?.description?.asOfDate || raw.asOfDate}</div>
      <div class="d-flags">${flags}</div>
      <div class="sect"><h4>7 维评分（当前权重下）</h4><div class="bars">${bars}</div></div>
      <div class="sect"><h4>4 句判定</h4><div class="narr">
        <p><span class="nl">押注什么</span><br>${n.whatItBetsOn}</p>
        <p><span class="nl">谁驱动 α</span><br>${n.whoDrivesAlpha}</p>
        <p><span class="nl">板块裁定</span><br>${n.sectorFlowVerdict}</p>
        <p><span class="nl">区间表现</span><br>${n.bandVerdict}</p></div></div>
      <div class="sect"><h4>风险 / 捕获</h4><div class="mini-grid">
        <div class="k">5y α (年化)</div><div class="v pos">${fmt(s.alphaQuality.annualizedAlpha5y, 'fixed2')}</div>
        <div class="k">Sharpe</div><div class="v pos">${fmt(r.sharpe?.fund, 'fixed2')}</div>
        <div class="k">上行捕获</div><div class="v pos">${fmt(r.upsideCapture, 'fixed2')}</div>
        <div class="k">下行捕获</div><div class="v pos">${fmt(r.downsideCapture, 'fixed2')}</div>
        <div class="k">最大回撤</div><div class="v neg">${fmt(r.maxDrawdown?.fund ?? r.maxDrawdown, 'fixed2')}%</div>
        <div class="k">r² / β</div><div class="v">${fmt(r.rSquared, 'fixed2')} / ${fmt(r.beta, 'fixed2')}</div>
      </div></div>
      ${ann ? `<div class="sect"><h4>年度回报 % (vs 同类)</h4><div class="ann">${ann}</div></div>` : ''}
      ${hold ? `<div class="sect"><h4>前 5 重仓</h4><div class="hold">${hold}</div></div>` : ''}
      <a class="report-link" href="/api/report/${code}" target="_blank">📄 查看完整研究报告 →</a>
    </div>`;
}
function downQ(dc, state) {
  if (dc == null) return 0.5; if (dc < 0) return 1;
  const { floor, ceil } = state.downside;
  return Math.max(0, Math.min(1, (ceil - dc) / (ceil - floor)));
}
function barHtml([label, v, cls]) {
  return `<div class="b"><div class="bl"><span>${label}</span><b>${v == null ? '—' : v.toFixed(2)}</b></div><div class="bt"><div class="bf ${cls}" style="width:${(v || 0) * 100}%"></div></div></div>`;
}
function flagChip(txt, cls = 'warn') { return `<div class="flag ${cls}">${txt}</div>`; }
function annualBars(annual, peer) {
  const years = Object.keys(annual);
  const max = Math.max(...years.map((y) => Math.abs(annual[y] || 0)), 1);
  return years.map((y) => {
    const v = annual[y] || 0; const h = Math.abs(v) / max * 100; const neg = v < 0;
    return `<div class="bar ${neg ? 'neg' : ''}" style="height:${h}%"><span class="y">${y.slice(2)}</span></div>`;
  }).join('');
}
```

- [ ] **Step 2: Add `/api/report/:code` to `server.js`** — in the request handler, before static files:

```js
  const m = url.pathname.match(/^\/api\/report\/(\d{6})$/);
  if (m) {
    const dir = path.join(DERIVED, 'reports');
    const f = latest(dir, new RegExp(`^report-${m[1]}-.*\\.md$`));
    if (!f) { res.statusCode = 404; res.end('no report'); return; }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.end(fs.readFileSync(f, 'utf-8'));
    return;
  }
```

- [ ] **Step 3: Browser smoke** — click 006502 → 7 bars + 4 sentences + risk grid + annual bars + holdings render with real values; 「完整报告」 link opens the .md.

- [ ] **Step 4: Commit (checkpoint)**

```bash
git add web-funds/public/views/detail-card.js web-funds/server.js
git commit -m "feat(web-funds): detail card + /api/report/:code"
```

---

## Task 13: `audit.js` — 出局审计 (funnel + exclusion table)

**Files:**
- Create: `web-funds/public/views/audit.js`

- [ ] **Step 1: Create `web-funds/public/views/audit.js`**

```js
// views/audit.js — 出局审计: funnel waterfall + exclusion table (spec 出局审计视图).
import { screenAll } from '../lib/screening.mjs';
import { gateLabel, fmt, tierBadgeClass } from '../lib/ui-util.mjs';

export function renderAudit(state, onSelect) {
  const b = state.bundle;
  const { passed, rejected } = screenAll(b.snapshot.rows, b.screenThresholds);
  const candIds = new Set(passed.map((r) => r.id));
  // trailing = scored dossiers whose code isn't in the server snapshot at all (e.g. 012922 C-share)
  const snapIds = new Set(b.snapshot.rows.map((r) => r.id));
  const trailing = b.cards.filter((c) => !snapIds.has(c.code)).map((c) => ({
    row: { id: c.code, fundName: c.name, rating3Y: c.scores.alphaQuality?.annualizedAlpha5y == null ? null : null }, code: c.code, gate: 'trailing', detail: {}, card: c,
  }));
  const excluded = [
    ...rejected.map((x) => ({ id: x.row.id, name: x.row.fundName, gate: x.gate, rating3Y: x.row.rating3Y,
      alphaRank: x.row.alphaToIndRankP_3Y, sharpeRank: x.row.sharpeRatioRankP_3Y, size: x.row.fundSize, tenure: x.row.longestTenure, cat: x.row.categoryName, hasDossier: !!b.dossiers[x.row.id] })),
    ...trailing.map((x) => ({ id: x.card.code, name: x.card.name, gate: 'trailing', rating3Y: x.card.scores?.alphaQuality,
      alphaRank: null, sharpeRank: null, size: x.card.sizeRisk?.aumYi, tenure: null, cat: null, hasDossier: true })),
  ].sort((a, b2) => (b2.alphaRank ?? 999) - (a.alphaRank ?? 999));   // α降序 → 优质标的在顶

  const waterfall = [
    ['??', 'universe（未知）'], [b.snapshot.count, '服务端结构筛'], [passed.length, '客户端质量筛'],
    [b.fundCount, '已抓 dossier'], [b.shortlist.length, 'shortlist'],
  ];
  document.getElementById('work-audit').innerHTML = `
    <div class="pane" style="background:var(--surface)">
      <div class="pane-h">出局审计 <span class="accent">漏斗透明化 · 回答 ${b.fundCount}→${passed.length}</span></div>
      <div class="waterfall">${waterfall.map((w, i) =>
        `<div class="step"><b>${w[0]}</b><br><span style="font-size:10px;color:var(--muted)">${w[1]}</span></div>${i < waterfall.length - 1 ? '<div class="arrow">→</div>' : ''}`).join('')}</div>
      <div style="padding:0 14px 6px;font-size:11px;color:var(--muted)">出局 ${excluded.length} 只（客户端 ${rejected.length} + 尾部档案 ${trailing.length}），按 α 降序——顶部即「高α却被出局」的优质标的。点击查看详情。</div>
      <table class="excl-table" id="excl-table">
        <thead><tr><th>代码·名称</th><th>出局 gate</th><th>评级</th><th>α排名</th><th>夏普排名</th><th>规模</th><th>任期</th><th>类别</th><th>dossier</th></tr></thead>
        <tbody>${excluded.map(rowHtml).join('')}</tbody>
      </table>
    </div>`;
  document.getElementById('excl-table').querySelectorAll('tbody tr').forEach((tr) => {
    tr.onclick = () => { if (b.dossiers[tr.dataset.id]) { state.selectedCode = tr.dataset.id; state.mode = 'score'; renderAuditToScore(state); } };
  });
}
function rowHtml(e) {
  return `<tr data-id="${e.id}"><td>${e.id} ${e.name}</td><td><span class="gate-badge">${gateLabel(e.gate)}</span></td>
    <td>${e.rating3Y ?? '—'}</td><td>${e.alphaRank ?? '—'}</td><td>${e.sharpeRank ?? '—'}</td>
    <td>${e.size != null ? fmt(e.size, 'yi') : '—'}</td><td>${e.tenure != null ? e.tenure.toFixed(1) + 'y' : '—'}</td>
    <td>${e.cat || '—'}</td><td>${e.hasDossier ? '✓' : '—'}</td></tr>`;
}
function renderAuditToScore(state) {
  // flip back to score mode to show the clicked fund's detail (re-render handled by app.setMode)
  document.querySelector('[data-mode="score"]')?.click();
}
```

> **Note:** `renderAuditToScore` clicks the mode button to return to 推演 + show detail. If `state.mode` mutation needs to flow through `app.setMode`, expose it — simplest is the click trick above. Refine during smoke.

- [ ] **Step 2: Wire audit into `app.js`** — `renderAudit` is already called in `render()` audit branch (Task 9). Confirm import. For click-through, the click-handler flips mode; ensure `onSelect`/`setMode` paths re-render.

- [ ] **Step 3: Browser smoke (acceptance §11.9-10)** — switch to 出局审计. Verify: waterfall shows 394→302(=passed.length)→317→20. **Sort by α descending → 012921 易方达全球成长精选 A(美元现汇) appears near the top with gate badge「USD份额」.** (This is the spec §11.10 regression check — if 012921 isn't there with that gate, screening.mjs is wrong.)

- [ ] **Step 4: Commit (checkpoint)**

```bash
git add web-funds/public/views/audit.js
git commit -m "feat(web-funds): 出局审计 (funnel waterfall + exclusion table, α-sorted)"
```

---

## Task 14: End-to-end acceptance + README polish

**Files:**
- Modify: `web-funds/README.md`

- [ ] **Step 1: Run full test suite**

Run: `cd web-funds && npm test`
Expected: all green (scoring 8 + parity 2 + screening 6 + ui-util 3 + server 2 = 21 tests).

- [ ] **Step 2: Manual acceptance walk (spec §11)** — start server, open http://localhost:8766, verify each:
1. 三栏 + editorial 顶栏 + 317 加载。
2. 拖真α 滑块 → 列表 <100ms 重排，Δ 正确，详情 fine 分更新。
3. （高级 v1.1 — skip 或确认滑块可拖；recompute 暂用卡值）
4. 筛选「真α」+「<100亿」→ 正确过滤。
5. 点行 → 详情卡字段完整，flags 忠实。
6. 明暗切换 + 刷新记忆。
7. `npm test` 全绿。
8. 否定式边界「波段判定·非长期赢家」常驻。
9. 出局审计瀑布 394→302→317→20。
10. **012921 出现在 α 降序顶部，gate=USD份额**。
11. screening 默认过关集 == candidates（parity test）。

- [ ] **Step 3: Polish `web-funds/README.md`** — add 「运行」「数据源」「测试」「设计 DNA（来自 web/）」「出局审计原理」「已知 v1 简化（advanced 子权重 recompute、sectorFlow 冻结、universe 总数未知）」sections (full content; no placeholders). Reference the spec + the queued USD-fix task in PLAN.md.

- [ ] **Step 4: Commit (checkpoint)**

```bash
git add web-funds/README.md
git commit -m "docs(web-funds): README + acceptance verified (v1)"
```

---

## Self-Review (run after writing — done)

**1. Spec coverage:**
- §1.1 推演面板 → Task 10 ✓ | 实时排名 → Task 11 ✓ | 判定卡 → Task 12 ✓ | 模式切换/出局审计 → Tasks 9, 13 ✓ | scoreFund 移植 → Tasks 1–3 ✓
- §3 数据源 → Task 7 bundle ✓ | §5 推演模型 → Tasks 1–3, 6, 9–10 ✓ | §6 金标准对齐 → Tasks 3, 5 ✓
- §7 架构/文件 → Tasks 1, 7, 8 ✓ | §8 交互 → Tasks 9–13 ✓ | §9 否定式边界 → Task 9 (顶栏副标题) ✓
- §11 验收 1–11 → Task 14 walk ✓ (item 3 advanced-recompute marked v1.1 — spec §5.1 allows card-value fallback; documented in README)
- §1.2 universe→394 逐只 → explicitly deferred (audit shows `??`) ✓ | USD 修复 → queued in PLAN.md (separate task) ✓

**2. Placeholder scan:** the `// TODO(v1.1)` in scorer.js is a documented scope boundary (advanced recompute), not a placeholder for THIS plan's deliverables — the 5 headline sliders work fully. All code steps have complete code. ✓

**3. Type consistency:** `fineScore(card, w, ds)` shape consistent across Tasks 2/3/9. `screenRow→{passed,gate,detail}` consistent across Tasks 4/5/13. `state.weights`/`state.advanced`/`state.baselineRank` consistent across Tasks 9/10/11. Card fields used in views (`alphaTier`, `downsideCapture`, `sectorFlowValue`, `bandValue`, `endorsementValue`) match what `recompute()` builds in Task 9. ✓

**Known v1 boundary (honest):** advanced α/endorsement sub-weight sliders mutate state but don't yet trigger `scoreFundCard` recompute (recompute uses card sub-scores). The 5 fine-weight sliders — the headline what-if — are fully live. Wiring advanced recompute is a small follow-on (the `scoreFundCard` function already exists and is parity-tested). Documented in README + scorer.js comment.
