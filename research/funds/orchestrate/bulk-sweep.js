// orchestrate/bulk-sweep.js — Plan 2 (Phase 4) detail-scrape 驱动。
//
// 遍历候选宽池逐只深抓详情 dossier（throttle + 小并发 + retry + 断点续跑），把 shortlist stage1 的
// 宽池码灌成 data/fund/<code>/fund-<code>-<date>.json，供 stage2 fine-rank 与报告消费。
//
// 🔴 fetchPage 注入：生产用 chrome-devtools MCP 抓 /fund/<id>.html 的 innerText（Nuxt SSR，项目既有
// 抓取路径，见 GUIDE 第二步 + SPA hash 陷阱）；离线测试注入 mock 返回 fixture innerText。本驱动不绑死
// 抓取后端 → 可单测。
// 🔴 断点续跑：用 core/state.js 持久化 done/failed，中断后从 state 续跑，不重抓已完成的。
// 🔴 大规模外发操作：live 执行需 token + 命中 morningstar.cn N 次，是外发动作——本模块只提供编排，
//    live 触发由人工授权的 documented command 发起（见底部 CLI）。

const fs = require('fs');
const path = require('path');
const { withRetry } = require('../core/retry');
const { loadState, saveState, markDone, markFailed, nextPending, isDone, summary } = require('../core/state');
const { parseFund: defaultParse } = require('../analyze/parse-fund');
const { validate } = require('../core/validate');

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string[]} opts.codes              待抓宽池码（已去重）
 * @param {(code:string)=>Promise<string>} opts.fetchPage  注入：返回 innerText（生产=chrome-devtools）
 * @param {object} [opts.parseFn]            注入 parser（默认 parse-fund.parseFund）
 * @param {string} opts.outDir               data/fund 根目录
 * @param {string} [opts.stateFile]          续跑状态文件路径
 * @param {string} [opts.date]               YYYYMMDD（文件名用，默认今天）
 * @param {number} [opts.throttleMs=800]     每只之间礼貌延迟
 * @param {object} [opts.retry]              透传 withRetry（retries/baseDelay/sleep/random/isRetryable）
 * @param {(ms:number)=>Promise} [opts.sleep]  注入 throttle sleep（测试）
 * @param {boolean} [opts.validateDossier]   写盘前 ajv 校验（默认 true）
 * @returns {Promise<{swept:number,done:number,failed:number,skipped:number,failures:string[]}>}
 */
async function bulkSweep(opts) {
  const {
    codes = [], fetchPage, parseFn = defaultParse, outDir, stateFile, date,
    throttleMs = 800, retry = {}, sleep = defaultSleep, validateDossier = true,
  } = opts;
  if (!fetchPage) throw new Error('[bulk-sweep] fetchPage required (inject live chrome-devtools adapter or mock)');
  if (!outDir) throw new Error('[bulk-sweep] outDir required');
  const day = (date || new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const state = loadState(stateFile);
  const pending = nextPending(state, codes);
  const skipped = codes.length - pending.length;
  const failures = [];
  let done = 0, failed = 0;

  for (const code of pending) {
    try {
      const text = await withRetry(() => fetchPage(code), { retries: 2, baseDelay: 1000, isRetryable: () => true, ...retry });
      if (!text || !String(text).trim()) throw new Error('fetchPage returned empty text (blank page / SPA 未渲染?)');
      const dossier = parseFn(text, { code });
      if (validateDossier) {
        const v = validate('fund-dossier', dossier);
        if (!v.valid) throw new Error(`dossier schema: ${v.errors.slice(0, 3).join('; ')}`);
      }
      const file = path.join(outDir, code, `fund-${code}-${day}.json`);
      atomicWrite(file, dossier);
      markDone(state, code);
      done++;
    } catch (err) {
      markFailed(state, code, err.message);
      failures.push({ code, error: String(err.message).slice(0, 200) });
      failed++;
    }
    if (stateFile) saveState(stateFile, state); // 每只落盘 state，随时可续跑
    if (throttleMs > 0) await sleep(throttleMs);
  }
  return { swept: pending.length, done, failed, skipped, failures };
}

function atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node orchestrate/bulk-sweep.js <candidates.json|shortlist.json> [--state <file>] [--out <data/fund>]');
    console.error('  🔴 LIVE: fetchPage 用 chrome-devtools MCP 抓 innerText — 需 live 会话，不在本 CLI 内自动执行。');
    console.error('  本 CLI 仅在 --dry-fixture 模式用 mock fixture 跑通编排（验证 driver 正确性，不触网）。');
    process.exit(1);
  }
  // dry-fixture 模式：用 mock-fund-innertext 跑通 driver，证明编排正确（不抓真实页）
  const dry = args.includes('--dry-fixture');
  const candidatesFile = args.find(a => a.endsWith('.json'));
  const outDir = (args.indexOf('--out') >= 0) ? args[args.indexOf('--out') + 1] : path.join(__dirname, '..', '..', '..', 'data', 'fund');
  const stateFile = args.indexOf('--state') >= 0 ? args[args.indexOf('--state') + 1] : null;
  const obj = require(path.resolve(candidatesFile));
  const limitIdx = args.indexOf('--limit');
  const limitParsed = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 3;
  const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : 3; // --limit 无值/非法 → 默认 3，不 slice(0,NaN)
  const codes = (obj.rows || obj.shortlist || obj).map(r => r.id || r.code).filter(Boolean).slice(0, limit);
  const fixture = require('../test/fixtures/mock-fund-innertext.json');
  const fetchPage = dry ? async (code) => { const t = JSON.parse(JSON.stringify(fixture.innerText)); return t.replace('005827', code); } : null;
  if (!dry) { console.error('🔴 LIVE bulk-sweep 需 chrome-devtools live 会话（外发操作）。用 --dry-fixture 跑离线编排自检。'); process.exit(2); }
  bulkSweep({ codes, fetchPage, outDir, stateFile, date: new Date().toISOString().slice(0, 10).replace(/-/g, ''), throttleMs: 0, sleep: async () => {} })
    .then(r => { console.log('[bulk-sweep] dry-fixture done', JSON.stringify({ ...r, failures: r.failures.map(f => f.code) })); });
}

module.exports = { bulkSweep };
