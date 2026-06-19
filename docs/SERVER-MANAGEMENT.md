# Server 进程管理规则（iter-007 修订 · 2026-06-19 · v1.1 更正）

> **本文件是 funds-research 项目所有 server/服务的进程管理规范**。所有需要长期运行的进程（playground、未来的 API、watcher 等）都必须遵循本规则。

---

## 🎯 核心原则

**Claude 启动一个独立的 shell 进程（background task）来管理 server**，**不**让 user 自己启动。生命周期由 Claude 通过 TaskCreate + TaskStop 显式管理。

### 为什么不让 user 自己启动

- user terminal 与 Claude 异步，user 关闭 terminal 会杀 server
- user 不知道 server 何时跑、端口何时被占
- Claude 跑验证时需要 server 跑着，user 启动会让 Claude 进入"等待 user 操作"的循环
- 调试时需要 Claude 实时看 server 日志

### 为什么不让 Claude 在主流程 task 里跑 server

- 主流程 task 结束后会自动清理，导致 server 被意外 kill
- 主流程 task 不能"等待 server 状态"
- 后台任务混在主流程里容易变成"未受控的孤儿进程"

### 正确做法

Claude 用 **`Bash({ run_in_background: true })`** 启动 server，并立即：

1. **记录 task ID**：用 `TaskCreate` 建一个"server-manager"任务跟踪 server 状态
2. **记录 PID**：从 server 输出日志中获取 PID
3. **验证**：用 curl/chrome-devtools 确认 server 正常
4. **显式停止**：验证后用 `TaskStop` 结束 task + `taskkill //F //PID` 兜底
5. **清理 TaskList**：标记 server-manager 任务为 completed

---

## 🚀 启动流程（Claude 视角）

### Step 1: 检查端口空闲

```bash
netstat -ano | grep :8765 | grep LISTENING || echo "✓ 8765 端口空闲"
```

如果有进程占用：
```bash
# 1. 找 PID
PID=$(netstat -ano | grep :8765 | grep LISTENING | awk '{print $NF}' | head -1)
# 2. 强制 kill
taskkill //F //PID $PID
# 3. 验证
sleep 2 && netstat -ano | grep :8765 | grep LISTENING || echo "✓ 已释放"
```

### Step 2: 启动 server（独立 background task）

```python
Bash({
  command: 'cd "C:/Lee/Projects/funds-research/playground" && node server.js',
  run_in_background: True,
  description: 'Start manager playground server'
})
```

返回的 task ID 形如 `bi1cpr5w2` — **保存这个 ID**。

### Step 3: 记录到 TaskList

```python
TaskCreate({
  subject: '运行 manager-playground server (PID 待填)',
  description: 'Background server task ID: <task_id> | PID: <pid> | URL: http://localhost:8765'
})
```

把 task_id 和 PID 关联起来，方便后续清理。

### Step 4: 等待 server 就绪

```bash
sleep 3
curl -s http://localhost:8765/api/health
# 期望: {"status":"ok","managers":3}
```

### Step 5: 验证 + 使用

用 chrome-devtools MCP 验证页面、截图、跑流程。

### Step 6: 停止 server（验证完成后必做）

```bash
# 1. taskkill 兜底
taskkill //F //IM node.exe //FI "WINDOWTITLE eq Manager*Server*" 2>&1 || true
# 或按 PID：
# taskkill //F //PID <pid>

# 2. 结束 background task
TaskStop({ task_id: '<task_id>' })

# 3. 验证端口已释放
sleep 2
netstat -ano | grep :8765 | grep LISTENING || echo "✓ 已清理"
```

---

## 🧹 完整示例（一次启动-验证-清理循环）

### 启动

```python
# 1. 清场
Bash(command: 'netstat -ano | grep :8765 | grep LISTENING && taskkill //F //PID $(netstat -ano | grep :8765 | grep LISTENING | awk "{print $NF}" | head -1) || echo "8765 空闲"')

# 2. 启动 server
result = Bash({
  command: 'cd "C:/Lee/Projects/funds-research/playground" && node server.js',
  run_in_background: True,
  description: 'Start playground server'
})
SERVER_TASK_ID = result  # 比如 'bi1cpr5w2'

# 3. 等待 + 健康检查
Bash(command: 'sleep 3 && curl -s http://localhost:8765/api/health')

# 4. 创建跟踪任务
TaskCreate({
  subject: 'playground server 跟踪',
  description: f'task_id={SERVER_TASK_ID}, URL=http://localhost:8765'
})
```

### 验证

```python
mcp__chrome-devtools__navigate_page({ url: 'http://localhost:8765/' })
mcp__chrome-devtools__take_screenshot({ filePath: 'verify.png' })
```

### 清理

```python
# 1. taskkill by PID（从 server 日志获取）
Bash(command: 'taskkill //F //IM node.exe //FI "PID ne 0" 2>&1 || true')  # 兜底

# 2. 结束 background task
TaskStop({ task_id: SERVER_TASK_ID })

# 3. 验证清理
Bash(command: 'netstat -ano | grep :8765 | grep LISTENING || echo "✓ 已清理"')

# 4. 更新 TaskList
TaskUpdate({ task_id: <跟踪任务id>, status: 'completed' })
```

---

## 🔧 故障排查

### 端口被占用（EADDRINUSE）

**症状**：
```
[error] Port 8765 is already in use.
```

**诊断**：
```bash
netstat -ano | grep :8765 | grep LISTENING
```

**修复**：
```bash
# 取第一个 LISTENING 行的 PID
PID=$(netstat -ano | grep :8765 | grep LISTENING | head -1 | awk '{print $NF}')
taskkill //F //PID $PID
```

### Server 启动但 fetch 失败

**症状**：浏览器显示 "❌ fetch 失败"

**诊断**：
```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 http://localhost:8765/api/health
```

**修复**：
- 返回 000 → server 没跑（重启）
- 返回 500 → server 内部错误，读 background task 的输出日志

### 读 server 日志

```python
# TaskOutput 读 background task 的输出
TaskOutput({ task_id: SERVER_TASK_ID, block: false })
```

### 端口冲突多源

**症状**：多次迭代后端口被多次占用

**修复**：找出所有占 8765 的进程，逐一 kill：
```bash
netstat -ano | grep :8765 | grep LISTENING | awk '{print $NF}' | sort -u | while read pid; do
  echo "Killing PID $pid"
  taskkill //F //PID $pid 2>&1
done
```

---

## 📋 规则检查清单

### 启动前

- [ ] 检查 8765 端口空闲
- [ ] 如占用 → taskkill 清理 → 重新检查

### 启动中

- [ ] 用 `run_in_background: true` 启动
- [ ] 保存返回的 task_id
- [ ] sleep 3 + curl /api/health 验证
- [ ] TaskCreate 跟踪任务

### 验证后（必须）

- [ ] TaskStop background task
- [ ] taskkill 兜底（可选但推荐）
- [ ] 验证端口已释放
- [ ] TaskUpdate 跟踪任务为 completed

---

## 🚫 反模式（禁止）

### ❌ 反模式 1：用 `&` 后台符号启动

```python
# ❌ 错误
Bash(command: 'node server.js &')
```

**问题**：`&` 让进程脱离 Claude 控制，PID 在新会话中不可见 → 僵尸进程。

### ❌ 反模式 2：让 user 自己启动

```python
# ❌ 错误
# 写规则让 user 跑 `npm start`
```

**问题**：user terminal 异步、关闭会杀 server、Claude 无法看日志。

### ❌ 反模式 3：主流程 task 里跑 server

```python
# ❌ 错误：在主任务中
TaskCreate(subject='实现并验证 server')
# → 在这个任务里 node server.js & → 任务完成时 server 被清理
```

**问题**：主任务结束自动清理，导致 server 提前终止。

### ❌ 反模式 4：忽略 EADDRINUSE 错误

```python
# ❌ 错误
PORT = 8766  # 掩盖问题
```

**问题**：根因没解决，下次还会冲突。

### ❌ 反模式 5：不清理就退出

```python
# ❌ 错误：跑完验证就 TaskOutput 关闭
```

**问题**：server 进程仍在跑，变僵尸。

---

## 📚 相关文档

- `playground/README.md` — 启动命令 + 添加新经理流程
- `docs/superpowers/specs/2026-06-19-manager-playground-design.md` — 设计
- `docs/superpowers/plans/2026-06-19-manager-playground.md` — 实施计划

---

## 📝 变更日志

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0 | 2026-06-19 | 初版：写"Claude 不启动 server，user 启动" |
| **1.1** | **2026-06-19** | **更正：Claude 用 background task + TaskCreate 显式管理 server 生命周期，user 不介入** |