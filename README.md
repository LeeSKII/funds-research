# China Public Fund Manager 10Y Alpha Hunt

**研究目标**：在过去约 10 年的中国市场里，找出持续创造 **风险调整后超额收益（alpha）** 的公募基金经理，分析他们的策略与所属基金公司。

> 🤖 **Claude 工作流约束读 [`CLAUDE.md`](./CLAUDE.md)** ——manager 子模块 4 步工作流（抓取 → parse → validate → 保存）+ 反例。
>
> ## 🎯 单源原则（iter-003 修订）
>
> **本项目只用 1 个定量数据源**：`https://www.morningstar.cn/fund/<6位代码>.html` + `https://www.morningstar.cn/#/fund-manager/<id>`
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
├── CLAUDE.md                      ← 🤖 Claude 工作流约束（manager 子模块）
├── data/                          ← 经理数据（结构化）
│   ├── manager-schema.json        ← 经理 JSON Schema 定义
│   ├── sources.md                 ← 引用链接合集
│   └── manager/                   ← 经理数据（v1.5 — 8 个 manager）
│       └── manager-<id>-<name>.json
├── research/                      ← 研究子模块（每模块独立 4 步工作流）
│   └── managers/                  ← 基金经理子模块
│       ├── raw-snapshots/         ← 第 1 步：innerText 原始快照
│       └── scripts/               ← 第 2-3 步：通用 extractor + validator
│           ├── parse-manager.js
│           └── validate-manager.js
│   # research/funds/              ← 基金分析子模块（未来 — 同 4 步结构）
└── playground/                    ← 本地 HTML playground（独立 web app）
    ├── server.js
    ├── public/
    └── mockups/                   ← 设计迭代截图（.gitignore 排除）
```

---

## 🔁 Loop 怎么用

**单次迭代最小流程**：

1. 阅读 `CLAUDE.md`（4 步工作流）→ 确认要走哪一步
2. 执行（navigate → 限速 → evaluate → 立即落盘 `data/manager/`）
3. 触发下一轮 loop

**在 Claude Code 中**：直接说 `请按 CLAUDE.md 的 4 步工作流抓下一个经理` 即可。

---

## 📊 当前状态

- ✅ 工具链：Manager JSON Schema v1.5 + parse-manager v1.5 + validate-manager v1.5
- ✅ 工作流：4 步（抓取 → parse → validate → 保存）— 见 `CLAUDE.md`
- ✅ 项目结构：研究子模块化（research/managers/）、数据按模块分类（data/manager/）
- ⏳ 阶段 2：候选池扩张（已 8 个经理，含 1 个 QDII）

最近一次更新：2026-06-19（iter-005 — 项目结构整理）
