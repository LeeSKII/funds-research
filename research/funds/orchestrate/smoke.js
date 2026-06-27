// orchestrate/smoke.js — 自检 harness（ops 硬化）。
//
// 在隔离的 temp store 跑全链路：runDaily(offline) → runAnalysis → buildShortlist → buildReports，
// 断言每个产物 schema 合法 + 非空。任一失败 → ok:false。代码改动后跑一次确认链路没断（CI / 本地）。
// 用 ENGINE_STORE_DIR 把 runDaily/market-sweep 的 store 重定向到 temp，不污染真实 store/。
//
// 运行：node orchestrate/smoke.js   （offline，不需 token）

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDaily } = require('./run');
const { runAnalysis } = require('../analyze/run-analysis');
const { buildShortlist } = require('../analyze/shortlist');
const { buildReports } = require('../analyze/report');
const { validate } = require('../core/validate');
const config = require('../core/config/analysis.json');

async function runSmoke({ storeDir, dataDir, date, offline = true } = {}) {
  const store = storeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-store-'));
  const fundData = dataDir || path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const day = date || new Date().toISOString().slice(0, 10);
  const prevStore = process.env.ENGINE_STORE_DIR;
  process.env.ENGINE_STORE_DIR = store;
  const steps = [];
  // 🔴 step 必须 await async fn（runDaily 是 async）；不 await 会 race：snapshot 在同步段写完，
  // 但 candidates 在后续微任务才落盘，读时还没写 → 假失败。
  const step = async (name, fn) => { try { const r = await fn(); steps.push({ name, ok: true, detail: r }); return r; } catch (e) { steps.push({ name, ok: false, detail: e.message }); throw e; } };

  try {
    // 1. daily loop (offline sweep → diff → screen)
    const daily = await step('daily:runDaily', () => runDaily({ offline, date: day }));
    // 2. snapshot schema-valid + non-empty
    await step('daily:snapshot-valid', () => {
      const snap = JSON.parse(fs.readFileSync(path.join(store, 'snapshots', `${day}.json`), 'utf-8'));
      const v = validate('snapshot', snap); if (!v.valid) throw new Error('snapshot schema: ' + v.errors.join('; '));
      if (!snap.count || snap.count <= 0) throw new Error(`snapshot empty (count=${snap.count})`);
      return `count=${snap.count}`;
    });
    // 3. candidates written
    await step('daily:candidates', () => {
      const c = JSON.parse(fs.readFileSync(path.join(store, 'derived', `candidates-${day}.json`), 'utf-8'));
      if (!c.rows || !c.rows.length) throw new Error('no candidate rows');
      return `rows=${c.rows.length}`;
    });
    // 4. analysis → score
    await step('analysis:runAnalysis', () => runAnalysis({ dataDir: fundData, outDir: path.join(store, 'derived'), date: day, computedAt: day }));
    await step('analysis:score-valid', () => {
      const s = JSON.parse(fs.readFileSync(path.join(store, 'derived', `score-${day}.json`), 'utf-8'));
      let bad = 0; for (const card of s.cards) { const v = validate('analysis-score', card); if (!v.valid) bad++; }
      if (bad) throw new Error(`${bad} cards failed schema`);
      return `cards=${s.cards.length}`;
    });
    // 5. shortlist
    await step('shortlist:build', () => {
      const c = JSON.parse(fs.readFileSync(path.join(store, 'derived', `candidates-${day}.json`), 'utf-8'));
      return buildShortlist({ rows: c.rows, dataDir: fundData, outDir: path.join(store, 'derived'), date: day, config, topN: 10 });
    });
    // 6. reports
    await step('report:build', () => {
      const s = JSON.parse(fs.readFileSync(path.join(store, 'derived', `score-${day}.json`), 'utf-8'));
      return buildReports({ dataDir: fundData, outDir: path.join(store, 'derived', 'reports'), date: day, config, scoreObj: s });
    });
    return { ok: true, store, date: day, steps };
  } catch (e) {
    return { ok: false, store, date: day, steps, failed: e.message };
  } finally {
    process.env.ENGINE_STORE_DIR = prevStore;
  }
}

if (require.main === module) {
  const offline = !process.argv.includes('--live');
  runSmoke({ offline }).then(r => {
    for (const s of r.steps) console.log(`${s.ok ? '✓' : '✗'} ${s.name}: ${typeof s.detail === 'object' ? JSON.stringify(s.detail) : s.detail}`);
    console.log(r.ok ? `\n[smoke] PASS (${r.steps.length} steps)` : `\n[smoke] FAIL: ${r.failed}`);
    process.exit(r.ok ? 0 : 1);
  });
}

module.exports = { runSmoke };
