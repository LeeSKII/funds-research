// engine/analyze/parse-fund.js — v2.0.0 ORCHESTRATOR (page-structure-aligned).
//
// The dossier top-level now mirrors the morningstar.cn /fund/<id>.html page TABS. Each tab is its
// own extractor in engine/analyze/sections/<name>.js (built/tested in isolation), and THIS file is
// the single function that assembles them. A bug localizes to one section file; the assembly is
// stable because every section takes the same (lines, ctx) and returns one block.
//
//   description   performance   risk   fees   portfolio   holders   manager   strategy
//                                                                                    + _diagnostics
//
// Field-ownership rule: the top strip is a MIRROR — each field lives in exactly ONE block, its
// semantic home tab (ter→fees, turnover→portfolio, ratings→performance, manager names→manager).
// 基金公司 / 基金公告 are intentionally NOT extracted.
//
// Shared helpers live in ./shared; per-section logic lives in ./sections/*.

const fs = require('fs');
const path = require('path');

const VERSION = '2.0.0';

const { extractDescription } = require('./sections/description');
const { extractPerformance } = require('./sections/performance');
const { extractRisk } = require('./sections/risk');
const { extractFees } = require('./sections/fees');
const { extractPortfolio } = require('./sections/portfolio');
const { extractHolders } = require('./sections/holders');
const { extractManager } = require('./sections/manager');
const { extractStrategy } = require('./sections/strategy');
const { lineIdx, lineIdxAny } = require('./shared');

/** Cross-cutting telemetry + provenance. NOT page content (underscore-prefixed). Computed here. */
function computeDiagnostics(lines, dossier, code, snapshotFile) {
  const tickerFormats = new Set();
  for (const h of (dossier.portfolio && dossier.portfolio.topHoldings) || []) {
    if (!h || !h.code) continue;
    if (/^\d{6}$/.test(h.code)) tickerFormats.add('asha6');
    else if (/^\d{5}$/.test(h.code)) tickerFormats.add('hk5');
    else if (/[A-Za-z]/.test(h.code)) tickerFormats.add('letter');
  }
  return {
    scriptVersion: VERSION,
    parsedAt: new Date().toISOString(),
    snapshotFile: snapshotFile || null,
    sourceUrl: code ? `https://www.morningstar.cn/fund/${code}.html` : null,
    layout: {
      trailingCols: Object.keys((dossier.performance && dossier.performance.trailing) || {}).length,
      annualYears: Object.keys((dossier.performance && dossier.performance.annual) || {}),
      sections: {
        trailing_return: lineIdx(lines, '过往回报') >= 0,
        annual_return: lineIdx(lines, '年度回报') >= 0,
        ratings: lineIdx(lines, '最新三年评级') >= 0,
        attribution: lineIdx(lines, '业绩归因') >= 0,
        risk: lineIdx(lines, '风险和波动') >= 0,
        fees: lineIdx(lines, '购买费用') >= 0,
        asset_type: lineIdx(lines, '资产类型') >= 0,
        sector: lineIdxAny(lines, ['行业配置', '股票行业分布']) >= 0,
        region: lineIdxAny(lines, ['地区配置', '股票地区分布', '区域配置']) >= 0,
        top_holdings: lineIdx(lines, '股票代码') >= 0,
        holders: lineIdx(lines, '持有人结构') >= 0,
        manager: lineIdx(lines, '管理团队') >= 0,
        strategy: lineIdx(lines, '投资目标') >= 0,
      },
      tickerFormats: [...tickerFormats],
      lineCount: lines.length,
    },
  };
}

/**
 * Parse a fund-detail innerText string into a page-structure-aligned dossier.
 * @param {string} text  innerText (newlines literal)
 * @param {{ code?: string, snapshotFile?: string }} opts
 */
function parseFund(text, opts = {}) {
  const lines = (text || '').split('\n');
  const ctx = { code: opts.code || '000000' };
  const dossier = {
    description: extractDescription(lines, ctx),
    performance: extractPerformance(lines, ctx),
    risk: extractRisk(lines, ctx),
    fees: extractFees(lines, ctx),
    portfolio: extractPortfolio(lines, ctx),
    holders: extractHolders(lines, ctx),
    manager: extractManager(lines, ctx),
    strategy: extractStrategy(lines, ctx),
  };
  dossier._diagnostics = computeDiagnostics(lines, dossier, ctx.code, opts.snapshotFile);
  return dossier;
}

function loadText(snapshotPath) {
  const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  return typeof raw === 'string' ? raw : (raw.innerText || raw.text || raw.body || '');
}

function atomicWrite(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function main(argv) {
  const args = argv.slice(2);
  if (!args[0]) {
    console.error('Usage: node engine/analyze/parse-fund.js <snapshot.json> [code] [-o <out.json>]');
    process.exit(1);
  }
  const snapshotPath = path.resolve(args[0]);
  const codeArg = args.find(a => /^\d{6}$/.test(a));
  const outIdx = args.indexOf('-o');
  const outOverride = outIdx >= 0 ? args[outIdx + 1] : null;
  const text = loadText(snapshotPath);
  const code = codeArg || path.basename(snapshotPath).match(/fund-(\d{6})/)?.[1] || '000000';
  const snapshotFile = path.basename(snapshotPath);
  const dossier = parseFund(text, { code, snapshotFile });
  const dateMatch = snapshotFile.match(/(\d{8})/);
  const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10).replace(/-/g, '');
  // Dossiers nest by fund code: data/fund/<code>/fund-<code>-<date>.json — one folder per fund
  // holds its time-series of dated snapshots (latest = max date). atomicWrite mkdirs the folder.
  const outPath = path.resolve(outOverride || `data/fund/${code}/fund-${code}-${date}.json`);
  atomicWrite(outPath, dossier);
  const d = dossier;
  console.log(`✓ parsed ${code} ${d.description.name} → ${outPath}`);
  console.log(`  performance: trailingCols=${d._diagnostics.layout.trailingCols} annualYears=[${d._diagnostics.layout.annualYears.join(',')}] attribution.real=${d.performance.attribution.real}`);
  console.log(`  risk: sharpe=${JSON.stringify(d.risk.sharpe)} calmar=${JSON.stringify(d.risk.calmar)} sortino=${JSON.stringify(d.risk.sortino)} downsideCapture=${d.risk.downsideCapture}`);
  console.log(`  fees: ter=${d.fees.ter} mgmt=${d.fees.managementFee} cust=${d.fees.custodianFee} sales=${d.fees.salesServiceFee}`);
  console.log(`  portfolio: holdings=${d.portfolio.topHoldings.length} concentration=${d.portfolio.top10Concentration}% turnover=${d.portfolio.turnover} sector=${d.portfolio.sectorAllocation.length} region=${d.portfolio.regionAllocation.length}`);
  console.log(`  manager: team=${d.manager.team.length} maxTenure=${d.manager.maxTenureYears}y lead.returnSince=${d.manager.lead.returnSinceInception} lead.aum=${d.manager.lead.aumYi}亿`);
  console.log(`  holders: inst=${d.holders.institutional}% retail=${d.holders.retail}%`);
  console.log(`  strategy: benchmark=${d.strategy.benchmark ? '✓' : '✗'} commentary=${d.strategy.latestCommentary && d.strategy.latestCommentary.text ? (d.strategy.latestCommentary.text.length + ' chars') : '✗'} outlook=${d.strategy.outlook && d.strategy.outlook.text ? (d.strategy.outlook.text.length + ' chars') : '✗'}`);
  if (d.performance.attribution.real && d.performance.attribution._identityCheck) {
    const c = d.performance.attribution._identityCheck;
    console.log(`  attribution identity: ${d.performance.attribution.excess} vs ${c.reconstructed} (Δ${c.delta}) ${c.ok ? '✓' : '⚠ MISMATCH'}`);
  }
  return dossier;
}

module.exports = { parseFund, loadText, VERSION };
if (require.main === module) main(process.argv);
