// server.js — fund-eval web: /api/bundle + static + SSE hot-reload. 0 deps.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8766;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DERIVED = path.join(ROOT, 'research/funds/store/derived');
const SNAPSHOTS = path.join(ROOT, 'research/funds/store/snapshots');
const CHANGES = path.join(ROOT, 'research/funds/store/changes');
const CONFIG = path.join(ROOT, 'research/funds/core/config');
const FUND_DATA = path.join(ROOT, 'data/fund');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function latest(dir, re) {
  const f = fs.readdirSync(dir).filter((x) => re.test(x)).sort().pop();
  return f ? path.join(dir, f) : null;
}
function loadDossier(code) {
  const dir = path.join(FUND_DATA, code);
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => /^fund-.*\.json$/.test(x)).sort().pop();
  return f ? readJSON(path.join(dir, f)) : null;
}

// 🔴 Keep the bundle LEAN: dossier fields needed for live recompute + detail card only (spec §3.2).
function slimDossier(d) {
  if (!d) return null;
  return {
    description: { code: d.description?.code, name: d.description?.name, category: d.description?.category,
      fundType: d.description?.fundType, styleBox: d.description?.styleBox, aumYi: d.description?.aumYi,
      nav: d.description?.nav, asOfDate: d.description?.asOfDate, riskLevel: d.description?.riskLevel },
    performance: { trailing: d.performance?.trailing, annual: d.performance?.annual, annualPeer: d.performance?.annualPeer,
      ratings: d.performance?.ratings, attribution: d.performance?.attribution },
    risk: d.risk, fees: d.fees,
    portfolio: { topHoldings: d.portfolio?.topHoldings?.slice(0, 5), sectorAllocation: d.portfolio?.sectorAllocation, assetAllocation: d.portfolio?.assetAllocation },
    holders: d.holders, manager: d.manager,
  };
}

export function buildBundle() {
  const score = readJSON(latest(DERIVED, /^score-.*\.json$/));
  const shortlist = readJSON(latest(DERIVED, /^shortlist-.*\.json$/));
  const analysis = readJSON(path.join(CONFIG, 'analysis.json'));
  const thresholds = readJSON(path.join(CONFIG, 'thresholds.json'));
  const snapshot = readJSON(latest(SNAPSHOTS, /^\d{4}-.*\.json$/) || latest(SNAPSHOTS, /.*/));
  const changesFile = latest(CHANGES, /^\d{4}-.*\.json$/);
  const changes = changesFile ? readJSON(changesFile).events : [];
  const resolutionsFile = latest(DERIVED, /^resolutions-.*\.json$/);
  const resolutions = resolutionsFile ? readJSON(resolutionsFile) : { date: score.date, resolved: [], unresolved: [] };

  const dossiers = {};
  for (const card of score.cards) {
    const d = loadDossier(card.code);
    if (d) dossiers[card.code] = slimDossier(d);
  }

  return {
    asOfDate: score.date, fundCount: score.fundCount, heatmap: score.sectorFlowHeatmap, ranked: score.ranked,
    cards: score.cards, shortlist: shortlist.shortlist, widePool: shortlist.stage1?.widePool,
    snapshot: { count: snapshot.count, date: snapshot.date, rows: snapshot.rows },
    changes,
    resolutions,
    defaults: { fineWeights: analysis.shortlist.fine.weights, downside: analysis.shortlist.fine.downside,
      alphaSub: analysis.alphaQuality.weights, alphaThresholds: analysis.alphaQuality.tierThresholds,
      alphaDivisor: analysis.alphaQuality.alpha5yNormalizeDivisor,
      endorsementWeights: analysis.endorsement.weights, endorsementRatingMax: analysis.endorsement.ratingMax,
      riskFloor: analysis.riskAdjusted.rSquaredTrustFloor, sizeRisk: analysis.sizeRisk, bearYear: analysis.band.bearYear },
    screenThresholds: thresholds,
    dossiers,
  };
}

let bundleCache = null;
function getBundle() { if (!bundleCache) bundleCache = buildBundle(); return bundleCache; }

// SSE
const sseClients = new Set();
function broadcast(reason) {
  const payload = JSON.stringify({ reason });
  for (const c of sseClients) { try { c.write(`event: reload\ndata: ${payload}\n\n`); } catch (_) {} }
}
let reloadTimer = null;
function scheduleReload(reason) {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { reloadTimer = null; broadcast(reason); }, 200);
}
// 🔴 fs.watch installs a PERSISTENT handle that keeps node --test alive forever if it runs at
// module-load (server.test.js imports this file). Wrap it + only start when the server actually runs.
function startWatcher() {
  try {
    fs.watch(PUBLIC_DIR, { recursive: true }, (_e, f) => { if (f && !/mockups|\.git/.test(f)) scheduleReload(`public/${f}`); });
  } catch (_) {}
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/bundle') {
    res.setHeader('Content-Type', MIME['.json']);
    res.end(JSON.stringify(getBundle()));
    return;
  }
  if (url.pathname === '/api/health') { res.setHeader('Content-Type', MIME['.json']); res.end(JSON.stringify({ ok: true })); return; }
  if (url.pathname === '/sse') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({})}\n\n`);
    sseClients.add(res);
    const hb = setInterval(() => { try { res.write(`: ping\n\n`); } catch (_) { clearInterval(hb); } }, 25000);
    req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
    return;
  }
  const m = url.pathname.match(/^\/api\/report\/(\d{6})$/);
  if (m) {
    const dir = path.join(DERIVED, 'reports');
    const f = latest(dir, new RegExp(`^report-${m[1]}-.*\\.md$`));
    if (!f) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end('no report'); return; }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.end(fs.readFileSync(f, 'utf-8'));
    return;
  }
  let fp = url.pathname === '/' ? '/index.html' : url.pathname;
  fp = path.join(PUBLIC_DIR, fp);
  if (!fp.startsWith(PUBLIC_DIR)) { res.statusCode = 403; res.end('Forbidden'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end(`404: ${url.pathname}`); return; }
    res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
    res.end(data);
  });
});
server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.error(`[error] port ${PORT} in use`); process.exit(1); } throw e; });
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWatcher();
  server.listen(PORT, () => console.log(`\n📊 fund-eval-web on http://localhost:${PORT}\n   bundle: ${getBundle().fundCount} funds, ${getBundle().snapshot.count} server rows\n   SSE hot-reload at /sse\n`));
}
export { server };
