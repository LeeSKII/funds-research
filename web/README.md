# Manager Web

> 本地 HTML 可视化工具，用于查看和对比基金经理数据。
> 数据源：`../data/manager/manager-*.json`（funds-research v1.5 schema）。

## 🚀 启动

由 Claude 启动 server（在 background task 中跑），**不**需要用户启动。

```bash
# Claude 端
cd "C:/Lee/Projects/funds-research/web" && node server.js
# (用 Bash 的 run_in_background: true 跑)
```

预期输出：

```
[info] Loaded 3 managers from C:\Lee\Projects\funds-research\data\raw\manager

📊 Manager Web running on http://localhost:8765
   3 managers loaded
   Press Ctrl+C to stop
```

浏览器打开 [http://localhost:8765](http://localhost:8765)

> **Server 生命周期管理**：Claude 启动后用 TaskCreate 跟踪，验证后用 TaskStop + taskkill 显式清理。

## 📂 文件结构

```
web/
├── server.js         # Node http 服务（~250 行，含 SSE 热重载）
├── public/
│   ├── index.html    # 主页面
│   ├── style.css     # editorial 排版（Noto Serif SC + IBM Plex Sans/Mono）
│   └── app.js        # 前端逻辑（fetch + 9 section 详情 + 数字 tick 动画）
├── mockups/          # 设计迭代截图（不入版本控制 — 见下）
│   ├── .gitkeep      # 保留空目录的唯一跟踪文件
│   └── iter-NNN-*    # 截图，git 自动忽略
├── package.json
└── README.md
```

### `mockups/` 目录规则

- **用途**：存设计迭代的截图（不同 layout / 主题 / 状态对比）
- **命名**：`iter-NNN-<描述>.{png,jpeg,jpg}`（NNN = 3 位迭代号）
- **.gitignore 状态**：`web/mockups/*` 被全局 `.gitignore` 排除（除了 `.gitkeep`）
- **优点**：每个迭代可存多张对比图，不污染 git 仓库
- **同步到云端**（可选）：手动 `rsync` 到云盘，不要靠 git

## ➕ 添加新经理

1. 按 `CLAUDE.md` 4 步工作流抓 + parse + validate + 保存
2. 用 `parse-manager.js` 生成 JSON：
   ```bash
   node research/managers/scripts/parse-manager.js \
     research/managers/raw-snapshots/morningstar-<id>-<date>.json <id> <name>
   ```
3. **无需重启 server**（v1.4+ 支持 SSE 热重载）：
   - 修改 `public/*.html|css|js` 或 `data/manager/*.json` → 浏览器自动刷新
   - 修改 `server.js` 本身 → `npm run dev` 用 `node --watch`
4. 刷新浏览器（或自动刷新），新经理自动出现在对比表（按年化收益降序）

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

- **数据 schema**：[`research/managers/scripts/manager-schema.json`](../research/managers/scripts/manager-schema.json)
- **Claude 工作流**：[`CLAUDE.md`](../CLAUDE.md)

## 🐛 故障排查

| 问题             | 原因              | 解决                                                      |
| ---------------- | ----------------- | --------------------------------------------------------- |
| 端口 8765 占用   | 僵尸进程残留      | `netstat -ano \| grep :8765` → `taskkill //F //PID <PID>` |
| fetch 失败       | server 没启动     | 检查 Claude 的 background task 状态                       |
| 表格空           | 没有 manager JSON | 跑 `parse-manager.js`                                     |
| 单经理字段缺失   | 该 JSON 字段未填  | 查原始 innertext，必要时手动补充                          |
| 添加新经理没出现 | server 没重启     | TaskStop + 重新 Bash run_in_background                    |
