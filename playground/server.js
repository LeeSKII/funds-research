// server.js — Manager Playground HTTP 服务
// 启动时扫描 ../data/raw/morningstar/*.json，提供 REST API + 静态文件
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, '..', 'data', 'raw', 'morningstar');

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
server.listen(PORT, () => {
  console.log(`\n📊 Manager Playground running on http://localhost:${PORT}`);
  console.log(`   ${managersCache.length} managers loaded`);
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