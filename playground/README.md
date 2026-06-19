# Manager Playground

> 本地 HTML 可视化工具，用于查看和对比基金经理数据。
> 数据源：`../data/raw/morningstar/manager-*.json`（funds-research v1.5 schema）。

## 🚀 启动

由 Claude 启动 server（在 background task 中跑），**不**需要用户启动。

```bash
# Claude 端
cd "C:/Lee/Projects/funds-research/playground" && node server.js
# (用 Bash 的 run_in_background: true 跑)
```

预期输出：
```
[info] Loaded 3 managers from C:\Lee\Projects\funds-research\data\raw\morningstar

📊 Manager Playground running on http://localhost:8765
   3 managers loaded
   Press Ctrl+C to stop
```

浏览器打开 [http://localhost:8765](http://localhost:8765)

> **Server 生命周期管理**：参见 [`docs/SERVER-MANAGEMENT.md`](../docs/SERVER-MANAGEMENT.md)。
> Claude 启动后用 TaskCreate 跟踪，验证后用 TaskStop + taskkill 显式清理。

## 📂 文件结构

```
playground/
├── server.js         # Node http 服务（~140 行）
├── public/
│   ├── index.html    # 主页面
│   ├── style.css     # 浅色主题
│   └── app.js        # 前端逻辑（fetch + 渲染 9 section 详情）
├── package.json
└── README.md
```

## ➕ 添加新经理

1. 用 chrome-devtools 抓经理页面（参见 [`data/EXTRACT-MANAGER-GUIDE.md`](../data/EXTRACT-MANAGER-GUIDE.md)）
2. 用 `parse-manager.js` 生成 JSON：
   ```bash
   node data/parse-manager.js data/raw/<name>-innertext.json <id> <name>
   ```
3. **重启 server**（v1 不支持热加载）：
   ```bash
   # Claude 端
   TaskStop + 重新 Bash(run_in_background: true) + node server.js
   ```
4. 刷新浏览器，新经理自动出现在对比表（按年化收益降序）

## 🎨 主题色板（浅色）

- 背景：`#f8f9fa`
- 表面：`#ffffff`
- 文字：`#1a1d21`
- 主色：`#2563eb`（链接/排名）
- 正超额：`#059669`（绿）
- 负超额：`#dc2626`（红）

## 🔧 技术栈

- Node.js ≥ 18（仅用内置 `http`/`fs`/`path`）
- 0 第三方依赖（vanilla JS + 原生 fetch + 原生 DOM）
- Chrome DevTools MCP 验证

## 📚 相关文档

- **设计文档**：[`docs/superpowers/specs/2026-06-19-manager-playground-design.md`](../docs/superpowers/specs/2026-06-19-manager-playground-design.md)
- **实施计划**：[`docs/superpowers/plans/2026-06-19-manager-playground.md`](../docs/superpowers/plans/2026-06-19-manager-playground.md)
- **Server 生命周期**：[`docs/SERVER-MANAGEMENT.md`](../docs/SERVER-MANAGEMENT.md)
- **数据 schema**：[`data/manager-schema.json`](../data/manager-schema.json)
- **数据采集 SOP**：[`data/EXTRACT-MANAGER-GUIDE.md`](../data/EXTRACT-MANAGER-GUIDE.md)

## 🐛 故障排查

| 问题 | 原因 | 解决 |
|---|---|---|
| 端口 8765 占用 | 僵尸进程残留 | `netstat -ano \| grep :8765` → `taskkill //F //PID <PID>` |
| fetch 失败 | server 没启动 | 检查 Claude 的 background task 状态 |
| 表格空 | 没有 manager JSON | 跑 `parse-manager.js` |
| 单经理字段缺失 | 该 JSON 字段未填 | 查原始 innertext，必要时手动补充 |
| 添加新经理没出现 | server 没重启 | TaskStop + 重新 Bash run_in_background |

## 📊 当前验证

iter-007 端到端验证：
- [x] 对比表 3 行（按年化收益降序：郑希 → 刘元海 → 武阳）
- [x] 点击行 → 详情区滚动 + 9 个 section
- [x] 业绩标签三态（正/负/中）
- [x] 风险回报 8 个 metric card
- [x] 历年回报 10 年 + 今年 + 任职以来
- [x] 行业配置条形图
- [x] 风格箱 3x3 网格 + 主导高亮
- [x] 持仓 10 行（含 TSM US/LITE US 等特殊代码）
- [x] 持有期 10 行
- [x] 基金列表 9 行 + 代表产品高亮