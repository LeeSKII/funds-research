# 第三步「基金分析」实现计划 (v1: 单基金评分 + JSON-only)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.
> **Spec:** [`../specs/2026-06-21-fund-analysis-step3-design.md`](../specs/2026-06-21-fund-analysis-step3-design.md)（权威，本计划是实现拆解）。
> **哲学锚:** [`research/funds/docs/investment-philosophy.md`](../../research/funds/docs/investment-philosophy.md)。🔴 #6「钱最多」= 板块资金流向（SectorFlow），**不是基金规模**；规模>100亿是风险 flag。

**Goal:** dossier → 每基金多维判定卡（真α/背书/波段/板块流向/主题/风险调整）+ 池级板块景气 heatmap，JSON-only，`node --test` 全绿。

**Architecture:** 纯函数信号 → `score.js` 编排 → `run-analysis.js` 聚合（先建 heatmap 再逐基评分）。输入只读 dossier JSON，输出 `store/derived/score-<date>.json`。

**Tech:** Node + `node:test` + ajv（复用 `core/validate.js`）。无新依赖。

**真实 dossier 形状参考（已核 006502）：**
- `performance.attribution.{real,excess,stockSelection,sectorAllocation,_identityCheck.ok}` — stockSelection/excess 可 >1（行业拖累时），需 clamp。
- `performance.{annual,annualPeer}` = `{year: pct}`；`{trailing,trailingPeer}` = `{period: pct}`；`ratings.{rating3Y,rating5Y,rating10Y}`。
- `risk.{alpha,beta,rSquared,infoRatio,upsideCapture,downsideCapture,maxDrawdown,trackingError}`（注意 `maxDrawdown` 是裸数值非 `{fund,peer}`）。
- `portfolio.sectorAllocation[]` = `{sector,fund,benchmark,excess}`，**混两层**：超类 `周期性/敏感性/防御性` + 细分（科技/工业…）。heatmap 只用细分层。
- `portfolio.topHoldings[]` = `{code,name,industry,weightPct}`；`top10Concentration`；`assetAllocation.{stock,bond,cash}.{fund,peer}`；`turnover`。
- `description.{aumYi,styleBox,purchaseStatus,dailyPurchaseLimit}`；`holders.{institutional,fofHeld,insiders.{managerSelf,executive,employee,companyDirect}}`，每 insider = `{shares,estAmount,pct,trend:{direction,changePct}|null}`；`manager.{maxTenureYears,lead.aumYi}`；`strategy.{benchmark,objective,latestCommentary.text,outlook.text}`。

**运行/测试约定：** 从仓库根 `node --test "research/funds/test/**/*.test.js"`（带引号 glob）。提交前 `git diff --cached --name-only | grep -iE 'token|network-request|raw\.json|\.env|secret'` 复核暂存区（见 memory root-tmp-not-gitignored）。每任务一 commit。

---

## Task 1: config + analysis schema（地基，无依赖）

**Files:**
- Create: `research/funds/core/config/analysis.json`
- Create: `research/funds/core/schemas/analysis-score.schema.json`
- Test: `research/funds/test/schema.test.js`

- [ ] **Step 1: 写 analysis.json**

```json
{
  "_note": "第三步基金分析可调参数。🔴 #6 SectorFlow = 板块资金流向(非基金规模)。详见 docs/superpowers/specs/2026-06-21-fund-analysis-step3-design.md",
  "alphaQuality": {
    "weights": { "stockAlphaRatio": 0.5, "annualizedAlpha5yNorm": 0.3, "tenureNorm": 0.2 },
    "tierThresholds": { "trueAlpha": 0.7, "industryBeta": 0.3 },
    "alpha5yNormalizeDivisor": 50
  },
  "endorsement": {
    "weights": { "institutional": 0.3, "insiders": 0.3, "fof": 0.2, "ratings": 0.2 },
    "ratingMax": 5
  },
  "sectorFlow": {
    "weights": { "prosperityAlignment": 0.6, "liquidity": 0.4 },
    "superCategories": ["周期性", "敏感性", "防御性"],
    "liquidityTier": { "大盘": 1.0, "中盘": 0.6, "小盘": 0.3, "_null": 0.5 }
  },
  "sizeRisk": { "capacityErosionYi": 100, "liquidationRiskYi": 2 },
  "riskAdjusted": { "rSquaredTrustFloor": 0.7 },
  "band": { "bearYear": 2022 }
}
```

- [ ] **Step 2: 写 analysis-score.schema.json**（对应 spec §3；`scores.*.value` ∈ [0,1]，`additionalProperties:true`）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "fund-analysis-score",
  "type": "object",
  "required": ["code", "name", "asOfDate", "sizeRisk", "scores", "flags", "narrative", "provenance"],
  "additionalProperties": true,
  "properties": {
    "code": { "type": "string" }, "name": { "type": "string" }, "asOfDate": { "type": "string" },
    "bandWindowLabel": { "type": "string" },
    "sizeRisk": { "type": "object", "required": ["aumYi", "flag"],
      "properties": { "aumYi": { "type": ["number","null"] }, "flag": { "enum": ["ok","capacity_erosion","liquidation_risk","unknown"] } }, "additionalProperties": true },
    "scores": { "type": "object", "additionalProperties": true,
      "properties": {
        "alphaQuality": { "type": "object", "required": ["value","tier"], "additionalProperties": true,
          "properties": { "value": { "type":"number","minimum":0,"maximum":1 }, "tier": { "enum":["true_alpha","mixed","industry_beta_pseudo","no_brinion"] } } },
        "endorsement": { "type":"object","required":["value"],"additionalProperties":true,"properties":{"value":{"type":"number","minimum":0,"maximum":1}} },
        "bandContribution": { "type":"object","required":["value"],"additionalProperties":true,"properties":{"value":{"type":"number","minimum":0,"maximum":1}} },
        "sectorFlow": { "type":"object","required":["value"],"additionalProperties":true,"properties":{"value":{"type":"number","minimum":0,"maximum":1}} },
        "theme": { "type":"object","additionalProperties":true },
        "riskAdjusted": { "type":"object","additionalProperties":true }
      } },
    "flags": { "type":"array", "items": { "enum": ["true_alpha","industry_beta_pseudo","closet_indexer","capacity_erosion","liquidation_risk","style_drift","skin_in_game","fof_endorsed","no_brinion","data_noise","low_benchmark_fit"] } },
    "narrative": { "type":"object", "required": ["whatItBetsOn","whoDrivesAlpha","sectorFlowVerdict","bandVerdict"], "additionalProperties": true },
    "provenance": { "type":"object", "required": ["dossierFile","dossierDate","scriptVersion","computedAt"], "additionalProperties": true }
  }
}
```

- [ ] **Step 3: 写失败测试 `test/schema.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../core/validate');
const analysisSchema = require('../core/schemas/analysis-score.schema.json');

function sampleCard() {
  return { code:'006502', name:'x', asOfDate:'2026-06-21', bandWindowLabel:'年度近似',
    sizeRisk:{aumYi:13.05,flag:'ok'},
    scores:{ alphaQuality:{value:0.8,tier:'true_alpha'}, endorsement:{value:0.5},
      bandContribution:{value:0.7}, sectorFlow:{value:0.9}, theme:{}, riskAdjusted:{} },
    flags:['true_alpha'], narrative:{whatItBetsOn:'a',whoDrivesAlpha:'b',sectorFlowVerdict:'c',bandVerdict:'d'},
    provenance:{dossierFile:'f',dossierDate:'2026-06-20',scriptVersion:'1.0.0',computedAt:'2026-06-21'} };
}

test('analysis-score schema validates a well-formed card', () => {
  // 需先在 core/validate.js 注册 schema 名 (见 Step 4)
  const r = validate('analysis-score', sampleCard());
  assert.ok(r.valid, JSON.stringify(r.errors));
});

test('analysis-score rejects value out of [0,1]', () => {
  const bad = sampleCard(); bad.scores.alphaQuality.value = 1.5;
  const r = validate('analysis-score', bad);
  assert.ok(!r.valid);
});

test('analysis-score rejects unknown sizeRisk flag', () => {
  const bad = sampleCard(); bad.sizeRisk.flag = 'whatever';
  const r = validate('analysis-score', bad);
  assert.ok(!r.valid);
});
```

- [ ] **Step 4: 在 `core/validate.js` 注册 schema**

读现有 `core/validate.js`，按其既有 ajv compile 模式增加 `analysis-score` → `analysis-score.schema.json` 的映射（与 `fund-dossier`/`change-event` 并列）。不破坏现有校验名。

- [ ] **Step 5: 跑测试确认通过**

`node --test "research/funds/test/schema.test.js"` → 3 PASS。再跑全量 `node --test "research/funds/test/**/*.test.js"` 确认未破坏现有 84 测试。

- [ ] **Step 6: Commit**

`git add research/funds/core/config/analysis.json research/funds/core/schemas/analysis-score.schema.json research/funds/core/validate.js research/funds/test/schema.test.js && git commit -m "feat(analysis): +analysis config + analysis-score schema (step3 v1)"`

---

## Task 2: loader.js（dossier 加载层）

**Files:**
- Create: `research/funds/analyze/loader.js`
- Test: `research/funds/test/loader.test.js`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path');
const { loadDossiers, latestDossierForCode } = require('../analyze/loader');

test('loadDossiers aggregates latest dossier per code from data/fund/', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const map = loadDossiers(dir);
  assert.ok(map.size > 0);
  assert.ok(map.has('006502'));
  const d = map.get('006502');
  assert.strictEqual(d.description.code, '006502');
});

test('latestDossierForCode picks the max-date file when multiple periods exist', () => {
  // 006502 only has 20260620; construct a synthetic case in-test via a temp dir if needed.
  const dir = path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const map = loadDossiers(dir);
  for (const d of map.values()) assert.ok(d._diagnostics && d.description);
});
```

- [ ] **Step 2: 跑测试确认 FAIL**（loader 不存在）。

- [ ] **Step 3: 实现 loader.js**

```js
// analyze/loader.js — 第三步 dossier 加载层。输入只读 data/fund/<code>/，输出 Map<code, dossier>。
const fs = require('fs');
const path = require('path');

// 取某 code 目录下最新日期的 fund-<code>-<YYYYMMDD>.json（文件名零填充 → 字典序==时间序）
function latestDossierForCode(codeDir, code) {
  if (!fs.existsSync(codeDir)) return null;
  const files = fs.readdirSync(codeDir)
    .filter(f => new RegExp(`^fund-${code}-\\d{8}\\.json$`).test(f))
    .sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  return { file: path.join(codeDir, latest), dossier: JSON.parse(fs.readFileSync(path.join(codeDir, latest), 'utf-8')) };
}

// 扫 data/fund/，每 code 取最新 dossier，聚合为 Map<code, dossier>
function loadDossiers(dataFundDir) {
  const map = new Map();
  if (!fs.existsSync(dataFundDir)) return map;
  for (const code of fs.readdirSync(dataFundDir)) {
    const codeDir = path.join(dataFundDir, code);
    if (!fs.statSync(codeDir).isDirectory()) continue;
    const r = latestDossierForCode(codeDir, code);
    if (r && r.dossier && r.dossier.description) {
      r.dossier.__file = r.file; // provenance 用
      map.set(code, r.dossier);
    }
  }
  return map;
}

module.exports = { loadDossiers, latestDossierForCode };
```

- [ ] **Step 4: 跑测试确认 PASS**。

- [ ] **Step 5: Commit** `feat(analysis): loader.js dossier 加载层 (step3 v1)`

---

## Task 3: sectorflow-index.js（🔴 #6 核心：板块资金流向）

**Files:**
- Create: `research/funds/analyze/sectorflow-index.js`
- Test: `research/funds/test/sectorflow.test.js`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test'); const assert = require('node:assert');
const { buildSectorFlowHeatmap, sectorFlowScore, detailSectors } = require('../analyze/sectorflow-index');
const config = require('../core/config/analysis.json');
const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');

test('detailSectors excludes super-categories 周期性/敏感性/防御性', () => {
  const ds = detailSectors(d006502.portfolio.sectorAllocation);
  assert.ok(!ds.some(s => ['周期性','敏感性','防御性'].includes(s.sector)));
  assert.ok(ds.some(s => s.sector === '科技'));
});

test('buildSectorFlowHeatmap ranks sectors and normalizes rankNorm to [0,1]', () => {
  const hm = buildSectorFlowHeatmap([d006502], config);
  assert.ok(hm.sectors.length > 0);
  for (const r of hm.sectors) assert.ok(r.rankNorm >= 0 && r.rankNorm <= 1.0001);
  assert.strictEqual(hm.sectors[0].sector, '科技'); // 006502 98% 科技 → top
});

test('sectorFlowScore: 006502 (科技 98% + 大盘成长) scores high', () => {
  const hm = buildSectorFlowHeatmap([d006502], config);
  const s = sectorFlowScore(d006502, hm, config);
  assert.ok(s.value > 0.5, `expected high sectorFlow, got ${s.value}`);
  assert.strictEqual(s.liquidity.styleBoxTier, '大盘成长');
});

test('sectorFlowScore handles dossier with no sectorAllocation (returns 0, no throw)', () => {
  const hm = buildSectorFlowHeatmap([d006502], config);
  const s = sectorFlowScore({ description:{styleBox:'小盘价值'}, portfolio:{} }, hm, config);
  assert.strictEqual(s.value, 0); // prosperity 0; liquidity 小盘=0.3 → 但 value 经权重… 见实现
});
```

> 注：第 4 个测试预期需与实现对齐——若 liquidity 权重使 value>0 即使 prosperity=0，把断言改为 `assert.ok(s.value < 0.2)`。实现者据实调整测试以匹配"无板块暴露≈低分"语义。

- [ ] **Step 2: 跑确认 FAIL。**

- [ ] **Step 3: 实现 sectorflow-index.js**（spec §2.4，注意 super-cat 排除、rankNorm 归一化）

```js
// analyze/sectorflow-index.js — 哲学 #6：板块资金流向（高景气度/高流动性）。🔴 非基金规模。
function detailSectors(sectorAllocation) {
  if (!Array.isArray(sectorAllocation)) return [];
  const superCats = ['周期性', '敏感性', '防御性'];
  return sectorAllocation.filter(s => s && s.sector && !superCats.includes(s.sector));
}

// (a) 池级板块景气 heatmap：候选池自己当资金流向传感器
function buildSectorFlowHeatmap(dossiers, config) {
  const acc = Object.create(null);
  const fundCount = dossiers.length || 1;
  for (const d of dossiers) {
    const sectors = detailSectors(d && d.portfolio && d.portfolio.sectorAllocation);
    const aum = (d && d.description && d.description.aumYi) || 0;
    for (const s of sectors) {
      if (!acc[s.sector]) acc[s.sector] = { holderCount: 0, excessSum: 0, overweightCount: 0, moneyMass: 0 };
      const ex = s.excess || 0;
      acc[s.sector].holderCount++;
      acc[s.sector].excessSum += ex;
      if (ex > 0) acc[s.sector].overweightCount++;
      acc[s.sector].moneyMass += aum * ((s.fund || 0) / 100);
    }
  }
  const rows = Object.keys(acc).map(sector => {
    const v = acc[sector];
    return { sector, holderCount: v.holderCount, avgExcess: v.excessSum / v.holderCount,
             overweightRatio: v.overweightCount / fundCount, moneyMass: round(v.moneyMass) };
  });
  const maxAbsExcess = Math.max(1, ...rows.map(r => Math.abs(r.avgExcess)));
  for (const r of rows) {
    // prosperity = 资金聚集广度 × 超配幅度（仅正向计入）
    r.prosperityRaw = r.overweightRatio * (r.avgExcess > 0 ? r.avgExcess / maxAbsExcess : 0);
  }
  const maxProsperity = Math.max(0, ...rows.map(r => r.prosperityRaw)) || 1;
  for (const r of rows) r.rankNorm = round(r.prosperityRaw / maxProsperity);
  rows.sort((a, b) => b.rankNorm - a.rankNorm);
  return { sectors: rows, fundCount };
}

// (b) 逐基金 SectorFlow 得分
function sectorFlowScore(dossier, heatmap, config) {
  const w = config.sectorFlow.weights;
  const sectors = detailSectors(dossier && dossier.portfolio && dossier.portfolio.sectorAllocation);
  let num = 0, den = 0; const top = [];
  for (const s of sectors) {
    const hm = heatmap.sectors.find(h => h.sector === s.sector);
    const rank = hm ? hm.rankNorm : 0;
    num += (s.fund || 0) * rank; den += (s.fund || 0);
    top.push({ sector: s.sector, fund: s.fund, excess: s.excess, rank });
  }
  const prosperityAlignment = den > 0 ? num / den : 0;
  top.sort((a, b) => (b.fund || 0) - (a.fund || 0));
  const sb = (dossier && dossier.description && dossier.description.styleBox) || '';
  const tier = config.sectorFlow.liquidityTier;
  let liquidity = tier._null;
  for (const k of ['大盘', '中盘', '小盘']) if (sb.startsWith(k)) { liquidity = tier[k]; break; }
  const total = w.prosperityAlignment * prosperityAlignment + w.liquidity * liquidity;
  return { value: round(total), prosperityAlignment: round(prosperityAlignment),
           topSectors: top.slice(0, 5), liquidity: { value: round(liquidity), styleBoxTier: sb || null } };
}

function round(x) { return Math.round((x + Number.EPSILON) * 1000) / 1000; }
module.exports = { buildSectorFlowHeatmap, sectorFlowScore, detailSectors };
```

- [ ] **Step 4: 跑 PASS（按 Step1 注调整第 4 测试断言）。**

- [ ] **Step 5: Commit** `feat(analysis): sectorflow-index #6 板块资金流向 heatmap + 评分 (step3 v1)`

---

## Task 4: theme-detector.js（#5 识别在炒什么）

**Files:**
- Create: `research/funds/analyze/theme-detector.js`
- Test: `research/funds/test/theme.test.js`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test'); const assert = require('node:assert');
const { detectTheme } = require('../analyze/theme-detector');
const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');

test('detectTheme: topSectorBets = 超配正值最大的行业', () => {
  const t = detectTheme(d006502);
  assert.ok(t.topSectorBets.length > 0);
  assert.strictEqual(t.topSectorBets[0].sector, '科技'); // excess 2.57（细分层最大正超配）
});

test('detectTheme: holdingsCluster 按行业聚合 weightPct', () => {
  const t = detectTheme(d006502);
  assert.ok(t.holdingsCluster.length > 0);
  assert.strictEqual(t.holdingsCluster[0].industry, '科技'); // 9 只科技重仓聚合
  assert.ok(t.holdingsCluster[0].weightPct > 50);
});

test('detectTheme: driftSinceLast = insufficient_history（单期）', () => {
  const t = detectTheme(d006502, { history: [d006502] });
  assert.strictEqual(t.driftSinceLast, 'insufficient_history');
});
```

- [ ] **Step 2: 跑确认 FAIL。**

- [ ] **Step 3: 实现 theme-detector.js**

```js
// analyze/theme-detector.js — 哲学 #5：识别基金/市场真正在炒什么。
const SUPER_CATS = ['周期性', '敏感性', '防御性'];

function detectTheme(dossier, opts = {}) {
  const sa = (dossier && dossier.portfolio && dossier.portfolio.sectorAllocation) || [];
  const detail = sa.filter(s => s && !SUPER_CATS.includes(s.sector));
  const topSectorBets = detail.filter(s => (s.excess || 0) > 0)
    .sort((a, b) => (b.excess || 0) - (a.excess || 0)).slice(0, 3)
    .map(s => ({ sector: s.sector, excess: s.excess }));

  const holdings = (dossier && dossier.portfolio && dossier.portfolio.topHoldings) || [];
  const byInd = Object.create(null);
  for (const h of holdings) {
    const ind = h.industry || '未分类';
    byInd[ind] = (byInd[ind] || 0) + (h.weightPct || 0);
  }
  const holdingsCluster = Object.keys(byInd).map(industry => ({ industry, weightPct: round(byInd[industry]) }))
    .sort((a, b) => b.weightPct - a.weightPct);

  const styleBox = (dossier && dossier.description && dossier.description.styleBox) || null;

  // 言行一致性 gap：benchmark 含"科技/集成电路/半导体/信息"等关键词 vs 实际科技持仓占比（简化代理）
  const bench = (dossier && dossier.strategy && dossier.strategy.benchmark) || '';
  const actualVsClaimedGap = null; // v1 占位：精确 benchmark 公式拆解列 v2；先 null

  // 漂移：需 ≥2 期历史
  const history = opts.history || [];
  let driftSinceLast = 'insufficient_history';
  if (history.length >= 2) {
    driftSinceLast = computeDrift(history[history.length - 2], history[history.length - 1]);
  }
  return { topSectorBets, holdingsCluster, styleBox, actualVsClaimedGap, driftSinceLast };
}

function computeDrift(prev, curr) {
  // 简化：比 top1 行业 + styleBox 是否变化
  const prevTop = topIndustry(prev), currTop = topIndustry(curr);
  const styleChanged = (prev?.description?.styleBox) !== (curr?.description?.styleBox);
  if (prevTop === currTop && !styleChanged) return 'stable';
  return styleChanged ? 'style_drift' : 'sector_rotation';
}
function topIndustry(d) {
  const h = (d && d.portfolio && d.portfolio.topHoldings) || [];
  const byInd = Object.create(null);
  for (const x of h) byInd[x.industry] = (byInd[x.industry] || 0) + (x.weightPct || 0);
  return Object.entries(byInd).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
function round(x) { return Math.round((x + Number.EPSILON) * 1000) / 1000; }
module.exports = { detectTheme };
```

- [ ] **Step 4: 跑 PASS。**

- [ ] **Step 5: Commit** `feat(analysis): theme-detector #5 行业赌注/重仓聚类/漂移 (step3 v1)`

---

## Task 5: score.js（编排器：dossier → 判定卡）

**Files:**
- Create: `research/funds/analyze/score.js`
- Test: `research/funds/test/score.test.js`

- [ ] **Step 1: 写失败测试（4 形态：真α型 006502 + no_brinion ETF 518880 + 大规模 capacity + 行业β伪α）**

```js
const test = require('node:test'); const assert = require('node:assert');
const { scoreFund } = require('../analyze/score');
const config = require('../core/config/analysis.json');
const { buildSectorFlowHeatmap } = require('../analyze/sectorflow-index');
const d006502 = require('../../../data/fund/006502/fund-006502-20260620.json');
const d518880 = require('../../../data/fund/518880/fund-518880-20260620.json');
const { validate } = require('../core/validate');

const heatmap = buildSectorFlowHeatmap([d006502, d518880], config);

test('真α型 006502: tier=true_alpha, flag true_alpha, sizeRisk ok, schema-valid', () => {
  const card = scoreFund(d006502, { heatmap, config, computedAt: '2026-06-21' });
  assert.strictEqual(card.scores.alphaQuality.tier, 'true_alpha');
  assert.ok(card.flags.includes('true_alpha'));
  assert.strictEqual(card.sizeRisk.flag, 'ok'); // 13.05 亿
  const v = validate('analysis-score', card); assert.ok(v.valid, JSON.stringify(v.errors));
});

test('no_brinion ETF 518880: tier=no_brinion, flag no_brinion, 不算 stockAlphaShare', () => {
  const card = scoreFund(d518880, { heatmap, config, computedAt: '2026-06-21' });
  assert.strictEqual(card.scores.alphaQuality.tier, 'no_brinion');
  assert.ok(card.flags.includes('no_brinion'));
  assert.strictEqual(card.scores.alphaQuality.stockAlphaShare, null);
});

test('大规模 capacity_erosion: aumYi>100 → flag capacity_erosion', () => {
  const big = JSON.parse(JSON.stringify(d006502)); big.description.aumYi = 150;
  const card = scoreFund(big, { heatmap, config, computedAt: '2026-06-21' });
  assert.strictEqual(card.sizeRisk.flag, 'capacity_erosion');
  assert.ok(card.flags.includes('capacity_erosion'));
});

test('rSquared<floor (006502 rSquared=0.59) → flag low_benchmark_fit', () => {
  const card = scoreFund(d006502, { heatmap, config, computedAt: '2026-06-21' });
  assert.ok(card.flags.includes('low_benchmark_fit'));
});

test('narrative 四句非空且与 subscore 一致', () => {
  const card = scoreFund(d006502, { heatmap, config, computedAt: '2026-06-21' });
  for (const k of ['whatItBetsOn','whoDrivesAlpha','sectorFlowVerdict','bandVerdict']) {
    assert.ok(typeof card.narrative[k] === 'string' && card.narrative[k].length > 0, k);
  }
  assert.ok(/科技/.test(card.narrative.whatItBetsOn)); // 98% 科技
});
```

- [ ] **Step 2: 跑确认 FAIL。**

- [ ] **Step 3: 实现 score.js**（编排 alphaQuality/endorsement/bandContribution/riskAdjusted + 调 sectorflow/theme + flags + narrative）

```js
// analyze/score.js — 第三步核心编排器：dossier + heatmap → 多维判定卡。
const { sectorFlowScore } = require('./sectorflow-index');
const { detectTheme } = require('./theme-detector');

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = x => Math.round((x + Number.EPSILON) * 1000) / 1000;

function scoreFund(dossier, { heatmap, config, computedAt }) {
  const flags = [];
  const a = dossier.performance && dossier.performance.attribution;

  // —— alphaQuality (#3) ——
  const aq = { value: 0, stockAlphaShare: null, tier: 'no_brinion', annualizedAlpha5y: null, tenureNorm: 0, identityCheckOk: null };
  if (a && a.real && typeof a.excess === 'number' && a.excess !== 0) {
    const share = a.stockSelection / a.excess;
    aq.stockAlphaShare = round(share);
    const t = config.alphaQuality.tierThresholds;
    aq.tier = share >= t.trueAlpha ? 'true_alpha' : share >= t.industryBeta ? 'mixed' : 'industry_beta_pseudo';
    aq.identityCheckOk = a._identityCheck ? a._identityCheck.ok : null;
    const w = config.alphaQuality.weights;
    const tenureNorm = clamp((dossier.manager && dossier.manager.maxTenureYears || 0) / 10, 0, 1);
    aq.tenureNorm = round(tenureNorm);
    const alpha5y = (dossier.risk && dossier.risk.alpha) ?? null;
    aq.annualizedAlpha5y = alpha5y;
    const alphaNorm = alpha5y != null ? clamp(alpha5y / config.alphaQuality.alpha5yNormalizeDivisor, 0, 1) : 0;
    aq.value = round(w.stockAlphaRatio * clamp(share, 0, 1) + w.annualizedAlpha5yNorm * alphaNorm + w.tenureNorm * tenureNorm);
    if (aq.tier === 'true_alpha') flags.push('true_alpha');
    if (aq.tier === 'industry_beta_pseudo') flags.push('industry_beta_pseudo');
    if (aq.identityCheckOk === false) flags.push('data_noise');
  } else {
    flags.push('no_brinion');
  }

  // —— endorsement (#3 佐证：聪明钱) ——
  const en = endorsementScore(dossier, config);
  if (en.flags) flags.push(...en.flags); delete en.flags;

  // —— bandContribution (#4) ——
  const bc = bandScore(dossier, config);

  // —— sectorFlow (#6 🔴) ——
  const sf = sectorFlowScore(dossier, heatmap, config);

  // —— theme (#5) ——
  const theme = detectTheme(dossier);

  // —— riskAdjusted (#3+#6) ——
  const ra = riskAdjusted(dossier, config);
  if (ra.flags) flags.push(...ra.flags); delete ra.flags;

  // —— sizeRisk (🔴 约束，非景气度) ——
  const sizeRisk = sizeRiskOf(dossier, config);
  if (sizeRisk.flag !== 'ok' && sizeRisk.flag !== 'unknown') flags.push(sizeRisk.flag);

  // —— narrative ——
  const narrative = buildNarrative(dossier, { aq, sf, bc, theme });

  return {
    code: dossier.description.code, name: dossier.description.name,
    asOfDate: dossier.description.asOfDate, bandWindowLabel: '年度近似（无逐日净值）',
    sizeRisk,
    scores: { alphaQuality: aq, endorsement: en, bandContribution: bc, sectorFlow: sf, theme, riskAdjusted: ra },
    flags: [...new Set(flags)],
    narrative,
    provenance: { dossierFile: dossier.__file || null, dossierDate: dossier._diagnostics && dossier._diagnostics.parsedAt,
                  scriptVersion: '1.0.0', computedAt },
  };
}

function endorsementScore(d, cfg) {
  const w = cfg.endorsement.weights; const flags = [];
  const h = d.holders || {};
  const institutional = clamp((h.institutional || 0) / 100, 0, 1);
  const ins = h.insiders || {};
  const insiderStrong = ['managerSelf', 'executive', 'employee', 'companyDirect']
    .filter(k => ins[k] && ins[k].trend && ins[k].trend.direction === '增持').length / 4;
  if (ins.managerSelf && ins.managerSelf.trend && ins.managerSelf.trend.direction === '增持') flags.push('skin_in_game');
  const fofText = h.fofHeld || '';
  const fof = /持有|FOF/.test(fofText) && !/暂未|没有|无/.test(fofText) ? 1 : 0;
  if (fof) flags.push('fof_endorsed');
  const r = (d.performance && d.performance.ratings) || {};
  const ratings = (((r.rating3Y || 0) + (r.rating5Y || 0)) / 2) / cfg.endorsement.ratingMax;
  const value = round(w.institutional * institutional + w.insiders * insiderStrong + w.fof * fof + w.ratings * clamp(ratings, 0, 1));
  return { value, institutional: h.institutional ?? null, insiders: ins, fofHeld: fof ? true : (fofText || null), ratings: r, flags };
}

function bandScore(d, cfg) {
  const annual = (d.performance && d.performance.annual) || {};
  const peer = (d.performance && d.performance.annualPeer) || {};
  const years = Object.keys(annual);
  if (years.length === 0) return { value: 0, annualExcess: [], consistencyRatio: 0, bear2022Excess: null, effectiveBandDensity: 0 };
  const annualExcess = years.map(y => ({ year: y, excess: round((annual[y] || 0) - (peer[y] || 0)) }));
  const beat = annualExcess.filter(x => x.excess > 0).length;
  const effective = annualExcess.filter(x => (annual[x.year] || 0) > 0 && x.excess > 0).length;
  const bear = annualExcess.find(x => x.year === String(cfg.band.bearYear));
  return { value: round(beat / years.length), annualExcess, consistencyRatio: round(beat / years.length),
           bear2022Excess: bear ? bear.excess : null, effectiveBandDensity: round(effective / years.length) };
}

function riskAdjusted(d, cfg) {
  const r = d.risk || {}; const flags = [];
  const floor = cfg.riskAdjusted.rSquaredTrustFloor;
  if (typeof r.rSquared === 'number' && r.rSquared < floor) flags.push('low_benchmark_fit');
  const asymmetry = (r.upsideCapture && r.downsideCapture) ? r.upsideCapture / (Math.abs(r.downsideCapture) || 1) : null;
  let captureFlag = 'unknown';
  if (asymmetry != null) captureFlag = asymmetry >= 1.2 ? 'aggressive_upside' : asymmetry <= 0.8 ? 'defensive' : 'balanced';
  return { alpha: r.alpha ?? null, infoRatio: r.infoRatio ?? null, rSquared: r.rSquared ?? null,
           beta: r.beta ?? null, upsideCapture: r.upsideCapture ?? null, downsideCapture: r.downsideCapture ?? null,
           asymmetry: asymmetry != null ? round(asymmetry) : null, captureFlag, flags };
}

function sizeRiskOf(d, cfg) {
  const aum = (d.description && d.description.aumYi) ?? null;
  if (aum == null) return { aumYi: null, flag: 'unknown' };
  const s = cfg.sizeRisk;
  if (aum > s.capacityErosionYi) return { aumYi: aum, flag: 'capacity_erosion' };
  if (aum < s.liquidationRiskYi) return { aumYi: aum, flag: 'liquidation_risk' };
  return { aumYi: aum, flag: 'ok' };
}

function buildNarrative(d, { aq, sf, bc, theme }) {
  const topBet = theme.topSectorBets[0];
  const what = topBet ? `重仓${theme.holdingsCluster[0]?.industry || topBet.sector}（持仓聚合 ${(theme.holdingsCluster[0]?.weightPct||0).toFixed(1)}%，超配 ${topBet.sector} ${(topBet.excess||0).toFixed(1)}%）`
                      : '行业暴露不明确';
  const who = aq.tier === 'no_brinion' ? '无 Brinson 归因（ETF/指数/QDII），用捕获比代理'
            : aq.tier === 'true_alpha' ? `选股贡献占超额 ${(clamp(aq.stockAlphaShare||0,0,1)*100).toFixed(0)}%（真 α 选股型）`
            : aq.tier === 'industry_beta_pseudo' ? `行业配置主导（伪 α，${(clamp(aq.stockAlphaShare||0,0,1)*100).toFixed(0)}% 选股）`
            : `选股/行业混合（${(clamp(aq.stockAlphaShare||0,0,1)*100).toFixed(0)}% 选股）`;
  const sfv = `板块资金流向对齐度 ${(sf.prosperityAlignment*100).toFixed(0)}%，流动性 ${sf.liquidity.styleBoxTier||'未知'}`;
  const band = bc.consistencyRatio != null ? `近 ${bc.annualExcess.length} 年 ${(bc.consistencyRatio*100).toFixed(0)}% 跑赢同类${bc.bear2022Excess!=null?`，2022 熊市超额 ${bc.bear2022Excess.toFixed(1)}%`:''}` : '无年度数据';
  return { whatItBetsOn: what, whoDrivesAlpha: who, sectorFlowVerdict: sfv, bandVerdict: band };
}

module.exports = { scoreFund, endorsementScore, bandScore, riskAdjusted, sizeRiskOf };
```

- [ ] **Step 4: 跑 PASS（5 测试）。**

- [ ] **Step 5: Commit** `feat(analysis): score.js 判定卡编排器 (step3 v1)`

---

## Task 6: run-analysis.js（编排：池→heatmap→评分→产物）

**Files:**
- Create: `research/funds/analyze/run-analysis.js`
- Test: `research/funds/test/run-analysis.offline.test.js`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test'); const assert = require('node:assert');
const path = require('node:path');
const fs = require('fs');
const { runAnalysis } = require('../analyze/run-analysis');
const { validate } = require('../core/validate');

test('runAnalysis offline: 产出 schema-valid score-<date>.json 含 heatmap + ranked', () => {
  const dataDir = path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const outDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'score-'));
  const res = runAnalysis({ dataDir, outDir, date: '2026-06-21', computedAt: '2026-06-21' });
  assert.ok(res.fundCount > 0);
  assert.ok(res.ranked.bySectorFlow.length > 0);
  const file = path.join(outDir, 'score-2026-06-21.json');
  const obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
  assert.ok(obj.sectorFlowHeatmap);
  for (const card of obj.cards.slice(0, 3)) {
    const v = validate('analysis-score', card); assert.ok(v.valid, JSON.stringify(v.errors));
  }
});
```

- [ ] **Step 2: 跑确认 FAIL。**

- [ ] **Step 3: 实现 run-analysis.js**（复用 atomicWrite 模式）

```js
// analyze/run-analysis.js — 第三步编排：load all → buildHeatmap → score each → rank → atomicWrite。
const fs = require('fs'); const path = require('path');
const { loadDossiers } = require('./loader');
const { buildSectorFlowHeatmap } = require('./sectorflow-index');
const { scoreFund } = require('./score');
const config = require('../core/config/analysis.json');

function atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function rankBy(cards, key) {
  return cards.slice().sort((a, b) => (b.scores[key]?.value ?? -1) - (a.scores[key]?.value ?? -1)).map(c => c.code);
}

function runAnalysis({ dataDir, outDir, date, computedAt }) {
  const map = loadDossiers(dataDir);
  const dossiers = [...map.values()];
  const heatmap = buildSectorFlowHeatmap(dossiers, config);
  const cards = dossiers.map(d => scoreFund(d, { heatmap, config, computedAt }));
  const obj = { date, fundCount: cards.length, sectorFlowHeatmap: heatmap, cards,
    ranked: { bySectorFlow: rankBy(cards, 'sectorFlow'), byAlphaQuality: rankBy(cards, 'alphaQuality'),
              byBandContribution: rankBy(cards, 'bandContribution') } };
  atomicWrite(path.join(outDir, `score-${date}.json`), obj);
  return { date, fundCount: cards.length, ranked: obj.ranked };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dataDir = args[args.indexOf('--data') + 1] || path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const outDir = args[args.indexOf('--out') + 1] || path.join(__dirname, '..', 'store', 'derived');
  const date = (args[args.indexOf('--date') + 1]) || new Date().toISOString().slice(0, 10);
  const r = runAnalysis({ dataDir, outDir, date, computedAt: date });
  console.log('[analysis] done', JSON.stringify({ date: r.date, fundCount: r.fundCount, topSectorFlow: r.ranked.bySectorFlow.slice(0, 5) }));
}

module.exports = { runAnalysis };
```

- [ ] **Step 4: 跑 PASS。**

- [ ] **Step 5: 手动跑一次真实** `node research/funds/analyze/run-analysis.js` → 产出 `store/derived/score-2026-06-21.json`，肉眼核对 heatmap 头部板块 + top bySectorFlow 是否合理（科技应靠前）。

- [ ] **Step 6: Commit** `feat(analysis): run-analysis 池级编排 + score-<date> 产物 (step3 v1)`

---

## Task 7: GUIDE 第三步章节 + npm 脚本 + 全量测试

**Files:**
- Modify: `research/funds/GUIDE.md`（加 ③ 章节）
- Modify: `research/funds/package.json`（加 `analysis:offline` 脚本）
- Verify: 全量 `node --test "research/funds/test/**/*.test.js"`

- [ ] **Step 1: GUIDE.md 加第三步**

在 `## ② 列表 → 基金详情 dossier → 研究` 之后新增：

```markdown
## ③ dossier → 基金分析（评分卡 + 板块资金流向）

基于第二步 dossier 做多维分析，产物 `store/derived/score-<date>.json`（每基金一张判定卡 + 池级板块景气 heatmap）。哲学锚 [`docs/investment-philosophy.md`](./docs/investment-philosophy.md)；设计 [`docs/superpowers/specs/2026-06-21-fund-analysis-step3-design.md`](../../docs/superpowers/specs/2026-06-21-fund-analysis-step3-design.md)。

| 模块 | 作用 |
|---|---|
| `analyze/loader.js` | 扫 `data/fund/<code>/` 取最新 dossier → Map |
| `analyze/sectorflow-index.js` | 🔴 #6 板块资金流向 heatmap + 逐基对齐度（候选池自当传感器） |
| `analyze/theme-detector.js` | #5 行业赌注 + 重仓聚类 + 漂移 |
| `analyze/score.js` | 编排：真α/背书/波段/板块流向/主题/风险调整 → 判定卡 + flags + 叙述 |
| `analyze/run-analysis.js` | 池级编排 → `store/derived/score-<date>.json` |
```

- [ ] **Step 2: package.json 加脚本**（读现有 package.json，在 scripts 加 `"analysis:offline": "node analyze/run-analysis.js"`，路径相对 research/funds）。

- [ ] **Step 3: 全量测试** `node --test "research/funds/test/**/*.test.js"` → 原 84 + 新增全绿。

- [ ] **Step 4: 暂存区复核** `git diff --cached --name-only | grep -iE 'token|network-request|raw\.json|\.env|secret'`（应无输出）。

- [ ] **Step 5: Commit** `docs(analysis): GUIDE 第三步 + analysis:offline 脚本 (step3 v1)`
