// server.js — Manager Playground HTTP 服务
// 启动时扫描 ../data/raw/manager/*.json，提供 REST API + 静态文件
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, '..', 'data', 'raw', 'manager');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// 内存缓存：启动时一次性扫描
let managersCache = [];
let loadErrors = [];

function scanManagers() {
  managersCache = [];
  loadErrors = [];

  if (!fs.existsSync(DATA_DIR)) {
    console.warn(`[warn] Data dir not found: ${DATA_DIR}`);
    return;
  }

  const files = fs.readdirSync(DATA_DIR).filter(f => /^manager-.*\.json$/.test(f));
  for (const file of files) {
    try {
      const filePath = path.join(DATA_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      managersCache.push(data);
    } catch (err) {
      loadErrors.push({ file, error: err.message });
      console.error(`[error] Failed to load ${file}: ${err.message}`);
    }
  }

  // 按年化收益降序排序
  managersCache.sort((a, b) => {
    const aRet = a.basic?.annualReturnEquity ?? -Infinity;
    const bRet = b.basic?.annualReturnEquity ?? -Infinity;
    return bRet - aRet;
  });

  console.log(`[info] Loaded ${managersCache.length} managers from ${DATA_DIR}`);
  if (loadErrors.length > 0) {
    console.warn(`[warn] ${loadErrors.length} file(s) failed to load`);
  }
}

// ============ 热重载：SSE 客户端集合 + 文件监听 ============
// 每个浏览器连一次 /sse 就会注册一个 SSE 客户端。文件变化时广播 'reload' 事件。
const sseClients = new Set();

function broadcastReload(reason) {
  const payload = JSON.stringify({ reason, at: Date.now() });
  for (const client of sseClients) {
    try {
      client.write(`event: reload\ndata: ${payload}\n\n`);
    } catch (_) {
      // 客户端已断连，下次心跳清理
    }
  }
  console.log(`[reload] broadcast to ${sseClients.size} client(s): ${reason}`);
}

// 去抖：保存文件时 fs.watch 会在毫秒内触发多次，200ms 节流只触发一次刷新
let reloadTimer = null;
function scheduleReload(reason) {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    broadcastReload(reason);
  }, 200);
}

// 监听 public/ — 任意文件变化都触发前端刷新
// 忽略截图、临时文件、编辑器备份
const IGNORE_RE = /\/(mockups-|\.git|\.vscode|\.DS_Store|~$|\.swp$|\.tmp$)/i;
function watchPublic() {
  try {
    const watcher = fs.watch(PUBLIC_DIR, { recursive: true }, (event, filename) => {
      if (!filename) return;
      if (IGNORE_RE.test(filename)) return;
      scheduleReload(`public/${filename}`);
    });
    watcher.on('error', (err) => console.warn(`[warn] public/ watch error: ${err.message}`));
    console.log(`[watch] public/ → ${PUBLIC_DIR}`);
  } catch (err) {
    console.warn(`[warn] fs.watch recursive unavailable: ${err.message}`);
  }
}

// 监听 data/raw/manager/ — 文件变化时刷新 in-memory cache + 通知前端
function watchData() {
  if (!fs.existsSync(DATA_DIR)) return;
  try {
    const watcher = fs.watch(DATA_DIR, { recursive: false }, (event, filename) => {
      if (!filename || !/^manager-.*\.json$/.test(filename)) return;
      scheduleReload(`data/${filename}`);
      // 顺便重扫内存缓存（debounce 后统一执行）
      setTimeout(() => {
        const before = managersCache.length;
        scanManagers();
        if (managersCache.length !== before) {
          console.log(`[info] cache reloaded: ${before} → ${managersCache.length} managers`);
        }
      }, 250);
    });
    watcher.on('error', (err) => console.warn(`[warn] data/ watch error: ${err.message}`));
    console.log(`[watch] data/ → ${DATA_DIR}`);
  } catch (err) {
    console.warn(`[warn] fs.watch data/ failed: ${err.message}`);
  }
}

// HTTP 路由处理
const server = http.createServer((req, res) => {
  // CORS（防止跨域问题，未来扩展用）
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: 获取所有经理
  if (url.pathname === '/api/managers') {
    res.setHeader('Content-Type', MIME_TYPES['.json']);
    res.end(JSON.stringify({
      count: managersCache.length,
      errors: loadErrors,
      managers: managersCache
    }));
    return;
  }

  // API: 健康检查
  if (url.pathname === '/api/health') {
    res.setHeader('Content-Type', MIME_TYPES['.json']);
    res.end(JSON.stringify({ status: 'ok', managers: managersCache.length }));
    return;
  }

  // SSE: 热重载信号
  if (url.pathname === '/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'  // 禁用 nginx 缓冲
    });
    // 立刻推一条 hello 让前端确认连接成功
    res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    sseClients.add(res);
    console.log(`[sse] client connected (total: ${sseClients.size})`);

    // 25s 心跳：注释帧（以 : 开头），浏览器忽略但能保活
    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch (_) {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
      console.log(`[sse] client disconnected (total: ${sseClients.size})`);
    });
    return;
  }

  // 静态文件
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  // 安全检查：防止路径穿越
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`404 Not Found: ${url.pathname}`);
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.end(data);
  });
});

// 启动
scanManagers();
watchPublic();
watchData();
server.listen(PORT, () => {
  console.log(`\n📊 Manager Playground running on http://localhost:${PORT}`);
  console.log(`   ${managersCache.length} managers loaded`);
  console.log(`   Hot reload: SSE at /sse (edits in public/ auto-refresh)`);
  console.log(`   Press Ctrl+C to stop\n`);
});

// 端口占用处理
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[error] Port ${PORT} is already in use.`);
    console.error(`        Kill the process or change PORT in server.js.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});