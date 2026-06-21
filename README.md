# China Public Fund Manager 10Y Alpha Hunt

**研究目标**：在过去约 10 年的中国市场里，找出持续创造 **风险调整后超额收益（alpha）** 的公募基金经理，分析他们的策略与所属基金公司。

> 🤖 **Claude 工作流约束读 [`CLAUDE.md`](./CLAUDE.md)** ——manager 子模块 4 步工作流（抓取 → parse → validate → 保存）+ 反例。
>
> ## 🎯 单源原则
>
> **本项目只用唯一morningstar定量数据源**：`https://www.morningstar.cn/fund/<6位代码>.html` + `https://www.morningstar.cn/#/fund-manager/<id>`
>
> - 单只基金页：50+ 字段（晨星评级 / 风险调整后指标 / 业绩归因 / 重仓股 / 经理自持等）
> - 经理详情页：画像标签 / 历年回报 / 行业变化 / 持仓 / 持有期
> - 避免多源数据冲突导致的"伪矛盾"
> - 详见 [`data/manager-schema.json`](./data/manager-schema.json)

---

## 📁 目录结构

```
funds-research/
├── README.md                      ← 你正在读的（项目入口）
├── CLAUDE.md                      ← 🤖 Claude 工作流约束
├── data/                          ← 结构化数据
│   ├── manager-schema.json        ← 经理 JSON Schema 定义
│   ├── manager/                   ← 经理数据（manager-<id>-<name>.json）
│   └── fund/                      ← 基金 dossier（fund-<code>-<date>.json）
├── engine/                        ← 基金分析生产系统（v2 — 4 步工作流：抓取→parse→validate→audit）
│   ├── analyze/                   ← parse-fund.js + sections/（8 段 extractor）+ shared.js
│   ├── core/schemas/              ← fund-dossier.schema.json
│   ├── ingest/ · orchestrate/     ← 拉取 / 编排
│   └── test/                      ← node:test + fixtures/mock-fund-innertext.json
├── research/                      ← 经理研究子模块（4 步工作流）
│   └── managers/
│       ├── raw-snapshots/         ← 第 1 步：innerText 原始快照
│       └── scripts/               ← 第 2-3 步：parse-manager + validate-manager
└── web/                           ← 本地 HTML web app（独立前端）
    ├── server.js
    ├── public/
    └── mockups/                   ← 设计迭代截图（.gitignore 排除）
```

---

## 📊 当前状态

- ✅ 经理工具链：Manager JSON Schema v1.5 + parse-manager v1.5 + validate-manager v1.5
- ✅ 基金工具链（engine/ v2）：fund-dossier schema v2.0.0 + parse-fund（8 段 extractor + orchestrator）+ ajv 校验 + 对抗审计 Workflow
- ✅ 工作流：4 步（抓取 → parse → validate → 保存/审计）— 见 `CLAUDE.md`
- ✅ 项目结构：基金分析生产系统（engine/）、经理子模块（research/managers/）、数据按模块分类（data/{manager,fund}/）
