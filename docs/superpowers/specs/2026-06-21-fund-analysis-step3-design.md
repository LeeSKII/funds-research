# 基金研究 · 第三步「基金分析」设计 (v1)

> **哲学溯源**：本设计是 [`research/funds/docs/investment-philosophy.md`](../../research/funds/docs/investment-philosophy.md) 的操作化。
> v1 范围（用户 2026-06-21 拍板）：**单基金评分先行（dossier-only）+ JSON-only 产物**。组合层 / 数据补抓 / PDF 报告推后。
>
> 🔴 **2026-06-21 关键修正**：哲学 #6「钱最多」= **板块高景气度/高流动性**，**不是基金规模**。基金规模过大（>100 亿）反而是**风险**。本 spec 的 #6 信号已从「MoneyFlow(基金 aumYi 加分)」改为「SectorFlow(板块资金流向)」，基金规模降级为**风险 flag**。

**目标**：把第二步 dossier 翻译成每只基金的「此刻在炒什么 + 这波段是否真超额 + 站在多高景气/多流动的板块」三维判定卡。所有结论只对当前波段负责（否定式边界）。

---

## 1. 哲学 → 信号映射

| 哲学论点 | 信号 | dossier 字段 |
|---|---|---|
| #3 某阶段确曾超额 | **真 α 鉴别**：`stockAlphaShare = stockSelection / excess`；tier（>70% 真 α / 30–70% 混合 / <30% 行业 β 伪 α）；`_identityCheck.ok` 标噪声 | `performance.attribution` |
| #3 真α佐证（聪明钱认可） | **背书 endorsement**：机构占比 + 内部人四维自持(经理/高管/员工/公司) + FOF 持有 + 评级 | `holders` + `performance.ratings` |
| #5 识别在炒什么 | **主题识别**：行业赌注（`sectorAllocation.excess` 最大正值）+ 重仓按行业聚类 + 风格箱 + benchmark vs 实际占比（言行一致性） | `portfolio.{sectorAllocation,topHoldings,assetAllocation}` + `description.styleBox` + `strategy.benchmark` |
| #4 波段叠加 | **波段贡献**：`annual[y] - annualPeer[y]` 逐年超额 + 一致性 + 熊市 2022 抗跌 + 有效波段密度 | `performance.{annual,annualPeer,trailing,trailingPeer}` |
| **#6 板块高景气度/高流动性** | **板块资金流向 SectorFlow**：候选池聚合 `sectorAllocation` → 板块景气 heatmap（资金堆在哪）→ 每基金组合对齐度 + 流动性(styleBox 大盘) | `portfolio.sectorAllocation`（池聚合）+ `description.styleBox` |
| #3+#6 超额与风险 | **风险调整超额**：α + infoRatio + 涨跌势捕获不对称 + rSquared>0.7 才采信 | `risk.{alpha,infoRatio,upsideCapture,downsideCapture,rSquared,beta,trackingError}` |
| 🔴 约束：规模风险 | **sizeRisk**：>100 亿 `capacity_erosion` / <2 亿 `liquidation_risk` / 否则 ok（**风险 flag，不是景气度加分**） | `description.aumYi` |

---

## 2. 关键设计决定（写死默认值，可调）

### 2.1 不出单一不透明总分——出多维判定卡 + flags + 叙述

哲学否定式边界禁止「长期赢家」叙事。v1 输出**多维 subscore + flags + 自然语言叙述**，排序时显式声明按哪个轴排（**默认按 SectorFlow，因 #6 是「站在哪」的论点**），真 α / 波段维度并列可重排。

### 2.2 真 α 得分（memory 验证公式）

```
alphaQualityScore = 0.5 × stockAlphaRatio      // stockSelection/excess, 仅 attribution.real=true
                  + 0.3 × annualizedAlpha5yNorm // risk.alpha 归一化（池内分位）
                  + 0.2 × tenureNorm            // maxTenureYears/10, cap 1
```
来源 `memory/morningstar-alpha-attribution.md`（7 基金样本验证）。

### 2.3 ETF/QDII/HK 无 Brinson 分支（`attribution.real !== true`）

跳过 `stockAlphaShare`，`alphaQuality.tier = "no_brinion"`，用 **capture 不对称 + 跟踪误差** 作 α 代理，flag `no_brinion`。**不强行算 stockAlphaShare**。

> strict-real 触发：`real` 缺失/`false`/`null` 任一情况都路由到 no_brinion（实现用 `!== true`，比 `=== null` 更严格——`false`（非真）与 absent 同等对待）。

### 2.4 🔴 SectorFlow = 板块资金流向（#6 的正确落地，核心新增）

**两步：先建池级 heatmap，再逐基金评分。**

**(a) 池级板块景气 heatmap**（`run-analysis.js` 跑全候选池前预计算一次）：
```
buildSectorFlowHeatmap(dossiers):
  对每个板块 s（晨星细分行业，可 rollup 到周期/敏感/防御超类）：
    holderCount    = 持有 s 的基金数
    avgExcess      = mean(fund%_s − benchmark%_s)        // 平均超配
    overweightCount= excess_s > 0 的基金数               // 资金聚集票数
    moneyMass      = Σ aumYi × fund%_s                    // 钱权重（可选，字面"钱堆哪"）
  sectorProsperity[s] = normalize(overweightCount, avgExcess)   // 资金聚集度
  → 板块景气排名
```
> 单源、零外部数据：用 308 只候选池**自己当资金流向传感器**——"哪些板块被主动资金超配/堆钱"即"钱最多的地方"。

**(b) 逐基金 SectorFlow 得分**（`score.js` 传入 heatmap）：
```
sectorFlowScore(dossier, heatmap):
  prosperityAlignment = Σ_s (fund%_s × heatmap.rankNorm(s))   // 组合落在高景气板块的权重
  liquidityNorm       = styleBoxTier(styleBox)                // 大盘=1 / 中盘=0.6 / 小盘=0.3 / null=0.5
  total = 0.6 × prosperityAlignment + 0.4 × liquidityNorm     // config-driven
```
> 流动性用 `styleBox`（大盘=深度足=高流动性板块）作代理；per-holding 市值是已知缺口（dossier 无市值数据）。

### 2.5 🔴 基金规模 = 风险约束（不是景气度）

```
sizeRisk(dossier):
  aum = description.aumYi
  aum > 100  → flag "capacity_erosion"   // 规模过大，侵蚀主动选股灵活性
  aum < 2    → flag "liquidation_risk"   // 清盘风险
  else       → "ok"
```
> **筛选层影响（需用户批准 + 重跑）**：当前 `thresholds.json fundSize_max_yi=200`、`universe.json fundSize` 含 `">100"` 桶——按原则应收紧到 100 亿（client cap 200→100；server 去掉 `">100"` 桶）。这会缩小候选池，属独立动作，不在此 spec 自动执行。

### 2.6 波段粒度 = 年度（v1 已知近似）

dossier 只有 `performance.annual`（7–9 年），无逐日净值。v1 波段以「年」为单元。行情级波段是**已知缺口**，卡 `bandWindowLabel` 标「年度近似」。逐日净值（growth-data XHR + secId）列 v2。

### 2.7 漂移检测 = 占位（v1）

`theme.driftSinceLast`：该基金 `data/fund/<code>/` 有 ≥2 期 dossier 则 diff `topHoldings/sectorAllocation/styleBox`；否则 `"insufficient_history"`。daily loop 累积后自动启用。

---

## 3. 产物 schema（`core/schemas/analysis-score.schema.json`，平行 fund-dossier.schema）

```jsonc
{
  "code": "006502", "name": "...", "asOfDate": "2026-06-21",
  "bandWindowLabel": "年度近似（无逐日净值）",
  "sizeRisk": { "aumYi": 10.6, "flag": "ok" },                       // 🔴 约束，非景气度
  "scores": {
    "alphaQuality":    { "value": 0.0, "stockAlphaShare": 0.72, "tier": "true_alpha",
                         "annualizedAlpha5y": null, "tenureNorm": 0.6, "identityCheckOk": true },
    "endorsement":     { "value": 0.0, "institutional": 32.0,
                         "insiders": {"managerSelf":null,"employee":"增持","executive":null,"companyDirect":null},
                         "fofHeld": true, "ratings": {"rating3Y":5,"rating5Y":5} },
    "bandContribution":{ "annualExcess": [{"year":2024,"excess":12.3}], "consistencyRatio": 0.8,
                         "bear2022Excess": 4.1, "effectiveBandDensity": 0.6 },
    "sectorFlow":      { "value": 0.0,                                // 🔴 #6：板块资金流向
                         "prosperityAlignment": 0.0, "topSectors": [{"sector":"科技","poolOverweight":38}],
                         "liquidity": {"value":0.0,"styleBoxTier":"大盘成长"} },
    "theme":           { "topSectorBets": [{"sector":"科技","excess":35.9}],
                         "holdingsCluster": [{"industry":"半导体","weightPct":38.1}],
                         "styleBox": "大盘成长", "actualVsClaimedGap": 8.2, "driftSinceLast": "insufficient_history" },
    "riskAdjusted":    { "alpha": 18.2, "infoRatio": 0.9, "rSquared": 0.78,
                         "upsideCapture": 112.0, "downsideCapture": 95.0, "asymmetry": 1.18, "captureFlag": "balanced" }
  },
  "flags": ["true_alpha","skin_in_game","fof_endorsed"],              // 枚举子集
  "narrative": { "whatItBetsOn": "...", "whoDrivesAlpha": "...", "sectorFlowVerdict": "...", "bandVerdict": "..." },
  "provenance": { "dossierFile": "...", "dossierDate": "...", "scriptVersion": "1.0.0", "computedAt": "..." }
}
```
- `flags` 枚举：`true_alpha | industry_beta_pseudo | closet_indexer | capacity_erosion | liquidation_risk | style_drift | skin_in_game | fof_endorsed | no_brinion | data_noise`。
- `scores.*.value` 均 0–1 number。
- `additionalProperties: true`（前向兼容）。

**池级产物** `store/derived/score-<date>.json`：
```jsonc
{ "date": "...", "fundCount": 308,
  "sectorFlowHeatmap": { /* 池级板块景气 heatmap，透明可查 */ },
  "cards": [ /* 单基 card[] */ ],
  "ranked": { "bySectorFlow": [...codes], "byAlphaQuality": [...codes], "byBandContribution": [...codes] } }
```

---

## 4. 模块布局（对齐现有 analyze/）

```
research/funds/analyze/
├── sections/  parse-fund.js  screen.js  diff.js  shared.js   # [不动] 第二步
├── loader.js              # [新] 扫 data/fund/<code>/ 取最新 dossier + 跨基金聚合 Map + 跨期 diff
├── score.js               # [新·核心] (dossier, {heatmap, config}) → 判定卡：编排各信号 + flags + narrative
├── sectorflow-index.js    # [新·#6 核心] buildSectorFlowHeatmap(dossiers) + sectorFlowScore(dossier, heatmap)
├── theme-detector.js      # [新·#5] 行业赌注 + 重仓聚类 + 风格 + 言行一致性 + 漂移 diff
├── run-analysis.js        # [新·编排] load all → buildHeatmap → score each → rank → atomicWrite store/derived/score-<date>.json
core/
├── config/analysis.json   # [新] SectorFlow 权重 + 真α公式系数 + 归一化 + sizeRisk 阈值（可调）
├── schemas/analysis-score.schema.json  # [新]
store/derived/score-<date>.json         # [新] 池级评分快照（含 heatmap）
test/
├── fixtures/mock-dossier.json   # [新] 匿名化真实 dossier（多形态：真α型/行业β型/no_brinion ETF/大规模 capacity）
├── sectorflow.test.js · theme.test.js · score.test.js
└── run-analysis.offline.test.js  # 离线跑 fixtures → 校验产物 schema + heatmap + 排序
```

**分层纪律**：`sections/` 永远只提取 dossier（第二步）；`analyze/` 顶层 `loader/score/sectorflow/theme/run-analysis` 是分析函数（第三步），**输入只读 dossier JSON、输出 analysis 产物**。信号函数纯函数，`score.js` 只编排 + 加权 + 叙述。

**pool 依赖**：SectorFlow 需聚合全候选池 → `run-analysis.js` 先 `buildSectorFlowHeatmap(dossiers)` 预计算一次，再逐基金 `score(dossier, {heatmap})`。

---

## 5. 复用（不重造）

- `core/validate.js` + ajv → 分析产物 schema 校验。
- `orchestrate/run.js` 的 atomicWrite + 数据 hash stale 检测 → `run-analysis.js` 复用。
- `analyze/shared.js` 行业/地区名表 → `theme-detector.js` + `sectorflow-index.js` 持仓/板块归类复用。
- dossier 全段已结构化 → 分析层直接消费，**不重抓、不解析原始 innerText**。

---

## 6. 已知缺口（v1 不做，诚实标注）

- 逐日净值 / 资金净流入时序（growth-data XHR + secId）→ 波段只能按「年」切。
- **per-holding 市值**（dossier 无）→ 流动性只能用 `styleBox` 大/中/小盘代理，无法精确到个股市值。
- 公司维度（companyName / 公司管理规模）dossier 不存。
- 漂移检测需 dossier 累积 ≥2 期。
- 同业排名百分位（`*RankP`）只在筛选层，dossier 无 → 用 `peer` 绝对值现场估算，标「近似」。

---

## 7. 验收标准

1. `run-analysis.js --offline`（读 fixtures）→ 产出 schema-valid `score-<date>.json`（含 heatmap）。
2. mock-dossier 覆盖 4 形态（真 α 型 / 行业 β 型 / no_brinion ETF / 大规模 capacity_erosion）→ 各自 flags 正确。
3. **SectorFlow heatmap 透明可查**：每只基金的 `prosperityAlignment` 能手动对回 heatmap 复核。
4. **sizeRisk 正确降级**：>100 亿基金出 `capacity_erosion` flag、不计入景气度加分。
5. 排序 `bySectorFlow/byAlphaQuality/byBandContribution` 三轴独立可用。
6. 每张卡 `narrative` 四句话非空且与 subscore 一致（言行自洽）。
7. `node --test` 全绿（目标 ≥ 每模块 3–5 测试 + 离线 run 1 个）。
