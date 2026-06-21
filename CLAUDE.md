# CLAUDE.md · funds-research 项目规则

> 项目根目录：`C:\Lee\Projects\funds-research`
> 本文件只放**项目级工作流规则**。全局网络搜索和网页数据抓取工具选择规则在 `~/.claude/CLAUDE.md`。

## 基金经理资料搜集工作流（manager 子模块 · 必须遵守）

当用户说"搜集/抓取/查询某个基金经理的资料"（来源是 morningstar.cn 基金数据站），按以下 **4 步**走，**不要跳步**。

**注**：这是 `research/managers/` 子模块的工作流。基金分析已在 `engine/` 落地（同样 4 步结构，见本文件末「基金分析子模块」）。

### 1. 抓取 innerText 到本地

用 chrome-devtools MCP 打开目标 URL，等 JS 渲染完成后调 `evaluate_script` 把 `document.body.innerText` 完整 dump 出来，写到本地文件。

- **路径**：`research/managers/raw-snapshots/<source>-<id>-<YYYYMMDD>.json`
- **dump 格式**：纯 innerText 字符串（parse-manager 直接消费）
- **必查项**：title / url / 抓取时间 / dump 行数（≥200 行基本是完整页面）
- **额外建议**：同时存一份带行号 prefix 的版本（`=== LINE N ===`）方便 debug 时按行号定位
- **🔴 防 SPA 缓存（强制 · 不要跳）**：morningstar.cn 用 hash 路由（`#/fund-manager/<id>`），**chrome-devtools 改 hash 不会触发 SPA 重新渲染**。连续抓多个 manager 时如果浏览器已在 morningstar 上，**必须**先 `navigate_page url="about:blank"` 卸载，再 `navigate_page` 到新 URL。否则 `evaluate_script` 看到的 `location.href` 是新 ID，但 `document.body.innerText` 仍是上一个 manager 的数据（2026-06-19 抓 213232 时踩过坑：取到的是 209221 的旧数据）。
- **🔴 抓完立刻 diff 校验（强制）**：dump 完成后**必须**跑 `diff -q <新文件> <上一次抓的 innertext 文件>` 确认内容确实变了。**如果文件字节数完全相同（hash 一致）= 抓到的是旧数据，必须 `about:blank` 重抓**。两个不同 manager 的 innertext 至少差 200+ 字符 / 几十行。

> 为什么要先保存：原始 innerText 是唯一可信源。直接调结构化脚本会丢失反常字段（错位、缺失、半角全角混用等），保留原始数据后可重复解析。
>
> 为什么要 `about:blank` 中转：见上一条。hash-only 变化在浏览器里是 in-place 替换，不会触发 Vue/React 组件的 `mounted` / 数据 fetch，DOM 完全不更新。

### 2. 用 `parse-manager.js` 提取 JSON

**不**用内联一次性的 `evaluate_script` 调结构提取。直接调用现成的通用 extractor：

```bash
node research/managers/scripts/parse-manager.js \
  research/managers/raw-snapshots/morningstar-<id>-<date>.json \
  <id> <name>
# 例：node research/managers/scripts/parse-manager.js research/managers/raw-snapshots/morningstar-191993-20260619.json 191993 狄星华
```

- **输入**：第 1 步的 `raw-snapshots/*.json`
- **输出**：`data/manager/manager-<id>-<name>.json`（符合 `data/manager-schema.json`）
- **实现**：v1.5 通用 extractor，正则 + 行号定位，支持 A 股 / QDII 经理

> 为什么要用通用脚本：DOM 结构变了只改一处；同一个 extractor 可以在 N 个 manager 上复用；提取过程可 diff / 可 review。

### 3. 用 `validate-manager.js` 校验

跑完 parse 之后**必须**做以下检查，发现问题回头修 extractor 或报告：

```bash
node research/managers/scripts/validate-manager.js                              # 全量
node research/managers/scripts/validate-manager.js data/manager/<file>  # 单个
```

| 检查项                             | 方法                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 必填字段齐全                       | 对照 `data/manager-schema.json` 的 required 列表                                                           |
| 跨表一致性                         | 历年回报合计 ≈ 任职以来；前十大持仓合计 < 100%；风险回报区间与历年回报数据方向一致                         |
| 反常检测                           | 数字与名称配对（如 ticker = AAPL 但名称写"苹果"是正常；ticker = GOOG 但名称写"苹果"是抓取错位 — 必须报告） |
| 同类基金任职回报 vs 主基金任职回报 | 应在 ±2% 内（A/C 份额差异）                                                                                |
| 年化波动 vs 最大回撤               | 高波动经理回撤应 ≥ 30%                                                                                     |
| 写入文件后再读一遍                 | 确认 JSON 合法 + 排序方向与 schema 一致                                                                    |

校验失败的项写到控制台 `[validate] WARN: ...`，不阻塞流程但**必须报告给用户**。

### 4. 保存到指定位置

parse-manager 自动写到 `data/manager/manager-<id>-<name>.json`。**用户没指定路径就用默认位置**；用户指定则用 `node research/managers/scripts/parse-manager.js ... -o <path>`（未来扩展）。

**保存后必须做：**

- 用 `node research/managers/scripts/validate-manager.js <file>` 再校验一次
- 如果文件超过 100KB 或发现异常字段，备份到 `data/manager/_archive/` 并标 `partial: true`

### 错误恢复

- 抓取中途断网 → 重试 + 标记 `partial: true` 在 JSON 顶层
- 字段缺失 → 不臆测，留 `null` + warning
- 跨源冲突（morningstar 跟天天基金数字不一致）→ 列出两个值让用户决定
- parse-manager 脚本写错 → 不要手动编辑生成的 JSON，回头改 parse-manager 重跑

### 反例（不要这样做）

- ❌ 拿到 URL 就直接 `navigate_page` → 读完就忘，下次抓同站又得重来
- ❌ `evaluate_script` 一把抓所有字段 → DOM 顺序变了整个崩
- ❌ 看到字段缺失就编个默认值 → 数据错了之后排查极痛苦
- ❌ 抓完不校验 → 用户发现"为什么英伟达持仓 25% 啊"再回来 debug
- ❌ 手动改生成的 manager JSON → 下次重跑 parse-manager 就被覆盖了
- ❌ **在 morningstar 上已打开一个 manager，又 `navigate_page` 改 hash 抓下一个** → 取到旧 manager 的数据，容易误判为 morningstar 数据库重複 ID（实际上是 SPA 没重渲染）。必须 `about:blank` 中转。
- ❌ **dump 完不 diff 就走 parse 流程** → 错的 innerText 经过 parse 也会生成"干净"的 JSON，但里面全是上一个 manager 的数据。

### 基金分析子模块（engine/ · 已落地）

基金分析已从原型 `research/funds/` 迁移到生产 `engine/`（原型已删除；组合优化方法论参考留在 `engine/tmp/funds-prototype/`，gitignored）。工作流同样 4 步：

1. **抓取 innerText** → chrome-devtools MCP（`about:blank` 中转 → navigate → evaluate_script dump `document.body.innerText`）。快照是**临时**的，写到 `engine/tmp/`（gitignored），不长期留存。
2. **解析** → `node engine/analyze/parse-fund.js <snapshot> <code>` → `data/fund/<code>/fund-<code>-<date>.json`（按基金分文件夹，留时间序列；v2 页面结构对齐：8 段 extractor + orchestrator）
3. **校验** → `engine/core/schemas/fund-dossier.schema.json`（ajv）
4. **审计** → Workflow：8 段 sub-agent 各自 vs 原始 innerText 核对提取是否遗漏/错位

测试用**模拟 fixture**（`engine/test/fixtures/mock-fund-innertext.json`，匿名化的真实结构），不依赖实时数据或快照语料。

## 项目结构约定

```
funds-research/
├── data/
│   ├── manager-schema.json          # 经理 JSON schema（必填字段定义）
│   ├── manager/                     # 结构化 manager JSON
│   └── fund/                        # 基金 dossier 产物（fund-<code>-<date>.json）
├── engine/                          # 基金分析生产系统（v2 — 4 步工作流）
│   ├── analyze/                     # parse-fund.js + sections/（8 段 extractor）+ shared.js
│   ├── core/schemas/                # fund-dossier.schema.json（ajv 校验）
│   ├── ingest/ · orchestrate/       # 拉取 / 编排
│   ├── test/                        # node:test + fixtures/mock-fund-innertext.json
│   └── tmp/                         # 临时快照 + funds-prototype/（方法论参考，gitignored）
├── research/
│   └── managers/                    # 基金经理子模块（v1.5 — 4 步工作流）
│       ├── raw-snapshots/           # 第 1 步：innerText 原始快照
│       └── scripts/                 # 第 2-3 步：parse + validate
├── web/                             # 本地 HTML web app（独立前端）
│   ├── server.js
│   ├── public/
│   └── mockups/                     # 设计迭代截图（.gitignore 排除）
└── CLAUDE.md                        # 本文件
```
