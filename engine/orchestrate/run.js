// orchestrate/run.js — chain Node stages for a daily fire.
// The ONLY module allowed to call across layers (ingest → analyze → store).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { marketSweep } = require('../ingest/market-sweep');
const { diffSnapshots } = require('../analyze/diff');
const { screen } = require('../analyze/screen');
const { loadConfig } = require('../core/config');
const { validate } = require('../core/validate');

function _storeDir() { return process.env.ENGINE_STORE_DIR || path.join(__dirname, '..', 'store'); }

function _latestSnapshots(dir, n = 2) {
  if (!fs.existsSync(dir)) return [];
  // NOTE: relies on filenames being zero-padded YYYY-MM-DD so lexicographic sort == chronological.
  // If a snapshot is ever named otherwise, prev/curr pairing silently breaks.
  return fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .slice(-n)
    .map(f => path.join(dir, f));
}

function _atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function _hashRows(rows) {
  // Hash the fund DATA, not the timestamped file — the date field always differs day-over-day,
  // so a whole-file hash would never detect stale data.
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.offline=false]
 * @param {string} [opts.date]  YYYY-MM-DD (default today UTC)
 * @returns {Promise<{ date: string, swept: number, changes: number, candidates: number, suspiciousIdentical: boolean }>}
 */
async function runDaily(opts = {}) {
  const { offline = false, date } = opts;
  const day = date || new Date().toISOString().slice(0, 10);
  const store = _storeDir();

  // 1. sweep → today's snapshot.
  //    A schema-fail / empty-response in marketSweep throws here = HARD STOP (spec §11):
  //    the fire aborts, the CLI wrapper exits 1, and yesterday's good artifacts stay intact.
  //    (No partial/void snapshot is ever written.)
  await marketSweep({ offline, date: day });

  // 2. diff vs previous snapshot (if any) + byte-identical guard
  const snaps = _latestSnapshots(path.join(store, 'snapshots'));
  let changeResult = { date: day, events: [] };
  let suspiciousIdentical = false;
  if (snaps.length >= 2) {
    const prevFile = snaps[snaps.length - 2];
    const currFile = snaps[snaps.length - 1];
    const prev = JSON.parse(fs.readFileSync(prevFile, 'utf-8'));
    const curr = JSON.parse(fs.readFileSync(currFile, 'utf-8'));
    if (_hashRows(prev.rows) === _hashRows(curr.rows)) {
      // spec §11 / INVARIANTS: identical fund rows day-over-day = stale data (SPA cache / API hiccup).
      // Flag + warn, but keep the loop idempotent (changes still computed = 0).
      suspiciousIdentical = true;
      console.warn(`[run] ⚠ snapshot rows identical to prior day (${path.basename(currFile)}) — suspected stale data`);
    }
    changeResult = diffSnapshots(prev, curr, day);
  }
  const cv = validate('change-event', changeResult);
  if (!cv.valid) throw new Error(`[run] change-event schema failed:\n  - ${cv.errors.join('\n  - ')}`);
  _atomicWrite(path.join(store, 'changes', `${day}.json`), changeResult);

  // 3. screen today's snapshot → candidates
  const { thresholds } = loadConfig();
  const latestSnap = JSON.parse(fs.readFileSync(snaps[snaps.length - 1], 'utf-8'));
  const candidates = screen(latestSnap, thresholds);
  _atomicWrite(path.join(store, 'derived', `candidates-${day}.json`), { date: day, count: candidates.rows.length, rows: candidates.rows });

  return { date: day, swept: latestSnap.count, changes: changeResult.events.length, candidates: candidates.rows.length, suspiciousIdentical };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : undefined;
  runDaily({ offline, date: dateArg })
    .then(r => { console.log('[daily] done', JSON.stringify(r)); process.exit(0); })
    .catch(e => { console.error('[daily] FAIL:', e.message); process.exit(1); });
}

module.exports = { runDaily };
