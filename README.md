# China Public Fund Manager 10Y Alpha Hunt

**投资哲学（终极目标）**：不预设任何策略或个人能长期跑赢市场——真正的复利来自**波段收益的叠加**。我们持续分析基金，识别「市场和这些基金当前真正在炒的是什么」，并站在**钱最多、流动性最充裕、信心最足**的地方。详见 [`投资哲学`](./research/funds/docs/investment-philosophy.md)；工程化 north-star 见 [`INVARIANTS`](./research/funds/governance/INVARIANTS.md) §(b)。

**研究目标**：找出**在某个阶段确曾创造风险调整后超额收益（alpha）**的公募基金经理/基金，分析其策略与所属基金公司。长周期指标只用于**扩大可识别波段的样本**，不用于断言 α 会延续。

> 🤖 **Claude 工作流约束读 [`CLAUDE.md`](./CLAUDE.md)** ——manager 子模块 4 步工作流（抓取 → parse → validate → 保存）+ 反例。
>
> ## 🎯 单源原则
>
> **本项目只用唯一morningstar定量数据源**：`https://www.morningstar.cn/fund/<6位代码>.html` + `https://www.morningstar.cn/#/fund-manager/<id>`
>
> - 单只基金页：50+ 字段（晨星评级 / 风险调整后指标 / 业绩归因 / 重仓股 / 经理自持等）
> - 经理详情页：画像标签 / 历年回报 / 行业变化 / 持仓 / 持有期
> - 避免多源数据冲突导致的"伪矛盾"
> - 详见 [`research/managers/scripts/manager-schema.json`](./research/managers/scripts/manager-schema.json)

---

## 📁 目录结构

```
funds-research/
├── README.md                      ← 你正在读的（项目入口）
├── CLAUDE.md                      ← 🤖 Claude 工作流约束
├── data/                          ← 结构化数据
│   ├── manager/                   ← 经理数据（manager-<id>-<name>.json）
│   └── fund/                      ← 基金 dossier（<code>/fund-<code>-<date>.json，按基金分文件夹）
├── research/                      ← 两条研究线（各有 GUIDE.md）
│   ├── funds/                     ← 基金研究（筛选 → 详情 → 研究）
│   │   ├── analyze/ · core/ · ingest/ · orchestrate/
│   │   └── test/                  ← node:test + fixtures/mock-fund-innertext.json
│   └── managers/                  ← 经理研究（4 步工作流）
│       ├── raw-snapshots/         ← 第 1 步：innerText 原始快照
│       └── scripts/               ← parse-manager + validate-manager + manager-schema.json
└── web/                           ← 本地 HTML web app（独立前端）
    ├── server.js
    ├── public/
    └── mockups/                   ← 设计迭代截图（.gitignore 排除）
```

---

## 📊 当前状态

- ✅ 经理工具链：Manager JSON Schema v1.5 + parse-manager v1.5 + validate-manager v1.5
- ✅ 基金工具链（research/funds/ v2）：fund-dossier schema v2.0.0 + parse-fund（8 段 extractor + orchestrator）+ ajv 校验 + 对抗审计 Workflow
- ✅ 工作流：4 步（抓取 → parse → validate → 保存/审计）— 见 `CLAUDE.md`
- ✅ 项目结构：基金分析生产系统（research/funds/）、经理子模块（research/managers/）、数据按模块分类（data/{manager,fund}/）
