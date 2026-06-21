# funds-research · 项目规则（全局索引）

> 项目根：`C:\Lee\Projects\funds-research`
> 本文件 = **全局 describe + 模块索引**。各模块详细工作流在隔离目录的 `GUIDE.md`（不自动加载——做该模块工作前先读）。
> 全局网络搜索 / 抓取工具选择规则在 `~/.claude/CLAUDE.md`。

## 两条独立研究线（morningstar.cn 单源，避免多源伪矛盾）

| 模块 | 隔离目录 | 指引 | 工作流 |
|---|---|---|---|
| **基金经理研究** | `research/managers/` | [`GUIDE.md`](./research/managers/GUIDE.md) | 抓经理详情 innerText → `parse-manager` → `validate-manager` → `data/manager/` |
| **基金研究** | `research/funds/` | [`GUIDE.md`](./research/funds/GUIDE.md) | ① 筛选条件 → 基金列表　② 列表 → 基金详情 dossier → 研究 |

## 全局规则（两模块共用）

- **单源**：只用 `morningstar.cn`（`/fund/<6位代码>.html` + `/#/fund-manager/<id>`）。
- **🔴 SPA hash 陷阱**：morningstar.cn 用 hash 路由，chrome-devtools 改 hash **不触发 SPA 重渲染**。连续抓同站时若浏览器已在 morningstar 上，**必须先 `navigate_page url="about:blank"` 卸载，再 navigate 到新 URL**——否则 `location.href` 是新 ID，但 `document.body.innerText` 仍是上一个对象的数据。
- **🔴 diff 新鲜度校验**：dump 完 innerText **必须** `diff` vs 上一次抓取确认内容变了（字节数/hash 完全一致 = 抓到旧数据，必须 about:blank 重抓）。两个不同对象的 innerText 至少差几百字符。
- **原始 innerText 是唯一可信源**：先存原始、再解析；直接 `evaluate_script` 提结构会丢失反常字段（错位/缺失/半角全角混用）。
- **安全**：`research/funds/secrets/` 含 live JWT（gitignored），永不提交、永不回显；原始网络捕获含 live token。

## 顶层结构

```
funds-research/
├── CLAUDE.md                  # 本文件（全局索引）
├── data/{manager,fund}/       # 结构化产物（manager-<id>.json / fund/<code>/）
├── research/                  # 两条研究线，各有 GUIDE.md
│   ├── funds/      → GUIDE.md # 基金研究（筛选 → 详情）
│   └── managers/   → GUIDE.md # 基金经理研究（4 步）
└── web/                       # 本地 HTML web app（独立前端）
```
