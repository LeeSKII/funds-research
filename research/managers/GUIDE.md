# 基金经理研究 · 工作流指引

> 隔离目录：`research/managers/`　|　产物：`data/manager/manager-<id>-<name>.json`
> 全局规则（SPA hash 陷阱 / diff 新鲜度 / 单源 / 安全）见根 [`CLAUDE.md`](../../CLAUDE.md)。

当用户说"搜集/抓取/查询某个基金经理的资料"（来源 morningstar.cn `/#/fund-manager/<id>`），按以下 **4 步**走，**不要跳步**。

## 1. 抓取 innerText 到本地

chrome-devtools MCP 打开目标 URL，等 JS 渲染完成调 `evaluate_script` 把 `document.body.innerText` 完整 dump 到本地。

- **路径**：`research/managers/raw-snapshots/<source>-<id>-<YYYYMMDD>.json`
- **dump 格式**：纯 innerText 字符串（parse-manager 直接消费）
- **必查项**：title / url / 抓取时间 / dump 行数（≥200 行基本是完整页面）
- **额外建议**：同时存一份带行号 prefix 的版本（`=== LINE N ===`）方便 debug 按行号定位
- **🔴 SPA/diff**：见根 CLAUDE.md 全局规则。教训：2026-06-19 抓 213232 时未 about:blank，取到的是 209221 的旧数据；dump 完不 diff 就 parse 会生成"干净但全是上个经理数据"的 JSON。

> 原始 innerText 是唯一可信源。直接调结构化脚本会丢失反常字段，保留原始数据后可重复解析。
>
> 为什么 about:blank 中转：hash-only 变化在浏览器里是 in-place 替换，不触发 Vue/React 组件 `mounted` / 数据 fetch，DOM 完全不更新。

## 2. 用 `parse-manager.js` 提取 JSON

不用内联一次性的 `evaluate_script` 提结构。直接调用通用 extractor：

```bash
node research/managers/scripts/parse-manager.js \
  research/managers/raw-snapshots/morningstar-<id>-<date>.json \
  <id> <name>
# 例：node research/managers/scripts/parse-manager.js research/managers/raw-snapshots/morningstar-191993-20260619.json 191993 狄星华
```

- **输入**：第 1 步的 `raw-snapshots/*.json`
- **输出**：`data/manager/manager-<id>-<name>.json`（符合同目录 `manager-schema.json`）
- **实现**：v1.5 通用 extractor，正则 + 行号定位，支持 A 股 / QDII 经理

> 用通用脚本：DOM 结构变了只改一处；同一 extractor 在 N 个 manager 上复用；提取可 diff / 可 review。

## 3. 用 `validate-manager.js` 校验

跑完 parse **必须**校验，发现问题回头修 extractor 或报告：

```bash
node research/managers/scripts/validate-manager.js                              # 全量
node research/managers/scripts/validate-manager.js data/manager/<file>  # 单个
```

| 检查项 | 方法 |
|---|---|
| 必填字段齐全 | 对照 `scripts/manager-schema.json` 的 required 列表 |
| 跨表一致性 | 历年回报合计 ≈ 任职以来；前十大持仓合计 < 100%；风险回报区间与历年方向一致 |
| 反常检测 | 数字与名称配对（ticker=AAPL 名称"苹果"正常；ticker=GOOG 名称"苹果"=抓取错位，必须报告）|
| 同类 vs 主基金任职回报 | 应在 ±2% 内（A/C 份额差异）|
| 年化波动 vs 最大回撤 | 高波动经理回撤应 ≥ 30% |
| 写入后再读一遍 | 确认 JSON 合法 + 排序方向与 schema 一致 |

校验失败写到控制台 `[validate] WARN: ...`，不阻塞但**必须报告给用户**。

## 4. 保存到指定位置

parse-manager 自动写到 `data/manager/manager-<id>-<name>.json`。用户没指定路径用默认；指定则 `... -o <path>`。

**保存后必须**：用 validate-manager 再校验一次；若 >100KB 或异常字段，备份到 `data/manager/_archive/` 并标 `partial: true`。

## 错误恢复

- 抓取中途断网 → 重试 + 顶层标 `partial: true`
- 字段缺失 → 不臆测，留 `null` + warning
- 跨源冲突 → 列出两个值让用户决定
- parse-manager 写错 → 不手动改生成的 JSON，回头改脚本重跑

## 反例（不要这样做）

- ❌ 拿到 URL 直接 `navigate_page` → 读完就忘，下次抓同站又得重来
- ❌ `evaluate_script` 一把抓所有字段 → DOM 顺序变了整个崩
- ❌ 字段缺失编默认值 → 数据错了排查极痛苦
- ❌ 抓完不校验 → 用户发现"为什么英伟达持仓 25%"再回来 debug
- ❌ 手动改生成的 JSON → 下次重跑 parse-manager 就被覆盖
- ❌ 在 morningstar 上已打开一个 manager 又改 hash 抓下一个 → 取到旧数据（见全局 SPA 规则）
- ❌ dump 完不 diff 就 parse → 错的 innerText 也会生成"干净"JSON，里面全是上个经理的数据

## 模块布局

```
research/managers/
├── GUIDE.md                # 本文件
├── raw-snapshots/          # 第 1 步：innerText 原始快照（唯一可信源）
└── scripts/
    ├── parse-manager.js    # 第 2 步：通用 extractor（v1.5）
    ├── validate-manager.js # 第 3 步：44 项硬校验（内联 CHECKS，不读 schema）
    └── manager-schema.json # 经理 JSON schema（必填字段定义，与脚本同目录）
```
