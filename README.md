# China Public Fund Manager 10Y Alpha Hunt

**研究目标**：在过去约 10 年的中国市场里，找出持续创造 **风险调整后超额收益（alpha）** 的公募基金经理，分析他们的策略与所属基金公司。

> 📜 **请先读 [`RESEARCH-ROADMAP.md`](./RESEARCH-ROADMAP.md)** ——整个项目的方法论、范围、评价口径、迭代节奏。
>
> 🛠️ **经理批量提取读 [`data/EXTRACT-MANAGER-GUIDE.md`](./data/EXTRACT-MANAGER-GUIDE.md)** ——v1.4 提取脚本 + 9 bug 修复记录。
>
> 🤖 **Claude 工作流约束读 [`CLAUDE.md`](./CLAUDE.md)** ——4 步工作流（抓取 → parse → validate → 保存）+ 反例。
>
> ## 🎯 单源原则（iter-003 修订）
>
> **本项目只用 1 个定量数据源**：`https://www.morningstar.cn/fund/<6位代码>.html` + `https://www.morningstar.cn/#/fund-manager/<id>`
>
> - 单只基金页：50+ 字段（晨星评级 / 风险调整后指标 / 业绩归因 / 重仓股 / 经理自持等）
> - 经理详情页：画像标签 / 历年回报 / 行业变化 / 持仓 / 持有期
> - 避免多源数据冲突导致的"伪矛盾"
> - 详见 [`data/SEARCH-GUIDE.md`](./data/SEARCH-GUIDE.md) 和 [`data/manager-schema.json`](./data/manager-schema.json)

---

## 📁 目录结构

```
funds-research/
├── README.md                      ← 你正在读的（项目入口）
├── RESEARCH-ROADMAP.md            ← ⭐ 主指引（方法论与宪法）
├── CLAUDE.md                      ← 🤖 Claude 工作流约束
├── process/                       ← 每次 loop 迭代的记录
├── docs/                          ← 过程文档（iteration-log / 协议等）
├── reports/                       ← 研究产出（原 output/）
│   └── INDEX.md                   ← 候选池主表（持续维护）
├── data/                          ← 数据 schema + 原始数据
│   ├── EXTRACT-MANAGER-GUIDE.md   ← 经理详情页提取 SOP（v1.4）
│   ├── manager-schema.json        ← 经理 JSON Schema 定义
│   ├── sources.md                 ← 引用链接合集
│   └── raw/morningstar/           ← 🎯 唯一数据源
│       └── manager-<id>-<name>.json
├── research/                      ← 4 步工作流中间产物
│   ├── raw-snapshots/             ← 第 1 步：innerText 原始快照
│   └── scripts/                   ← 第 2-3 步：通用 extractor + validator
│       ├── parse-manager.js
│       └── validate-manager.js
└── playground/                    ← 本地 HTML playground（独立 web app）
    ├── server.js
    └── public/
```

---

## 🔁 Loop 怎么用

**单次迭代最小流程**：

1. 阅读 `RESEARCH-ROADMAP.md`，确认当前要推进哪个阶段
2. 阅读 `data/EXTRACT-MANAGER-GUIDE.md`（v1.4 状态表）→ 选场景
3. 复制 `docs/iteration-log.md` → `process/iter-NNN-YYYY-MM-DD.md`
4. 执行（navigate → 限速 → evaluate → 立即落盘 `data/raw/morningstar/`）
5. 在 log 中写"本轮关键发现 / 未决问题 / 下一步"
6. 同步 `reports/INDEX.md`
7. 触发下一轮 loop

**在 Claude Code 中**：直接说 `loop` 或 `请按 RESEARCH-ROADMAP 继续推进下一轮研究` 即可。

---

## 📊 当前状态

- ✅ 规范搭建：路线图、模板、索引、数据源
- ✅ 策略修订：单源原则确定（iter-003）
- ✅ 提取工具：Manager JSON Schema v1.0 + parse-manager v1.5（iter-004）
- ✅ 项目结构整理：output→reports、scripts 移到 research/scripts/、innerText 快照统一路径
- ⏳ 阶段 2：候选池扩张（已 8 个经理，含 1 个 QDII）
- ⏳ 阶段 3-5：策略归因 / 持续性测试 / 公司层洞察
- ⏳ 阶段 6：终稿

最近一次更新：2026-06-19（iter-005 — 项目结构整理）
