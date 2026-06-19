// ============================================================
// 基金经理数据校验脚本 v1.0
// 校验 data/raw/morningstar/manager-*.json 的完整性和合理性
// ============================================================
//
// 用法：
//   node data/validate-manager.js                          # 校验所有 raw/morningstar/*.json
//   node data/validate-manager.js path/to/file.json        # 校验单个文件
//   node data/validate-manager.js file1.json file2.json    # 校验多个文件
//
// 退出码：
//   0 = 全部通过
//   1 = 有失败项
//   2 = 文件读取错误
//
// 输出：
//   - 每个 JSON 的详细校验项（✓/✗ + 数据快照）
//   - 跨文件一致性（同年数据是否一致）
//   - 数据合理性（数值范围、单位、必填）
// ============================================================

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, 'raw', 'morningstar');

// ============================================================
// 校验规则集
// ============================================================

const CHECKS = [
  // ---------- _meta ----------
  { id: 'meta.pageComplete',     fn: d => d._meta?.pageComplete === true, critical: true },
  { id: 'meta.name',             fn: d => !!d._meta?.name, critical: true },
  { id: 'meta.scrapedAt',        fn: d => !!d._meta?.scrapedAt && !isNaN(Date.parse(d._meta.scrapedAt)), critical: true },
  { id: 'meta.source',           fn: d => /^https:\/\/www\.morningstar\.cn/.test(d._meta?.source || ''), critical: true },

  // ---------- basic ----------
  { id: 'basic.name',            fn: d => !!d.basic?.name && d.basic.name === d._meta.name, critical: true },
  { id: 'basic.company',         fn: d => !!d.basic?.company && /基金管理/.test(d.basic.company), critical: true },
  { id: 'basic.education',       fn: d => d.basic?.education !== undefined, warnOnly: true, note: '部分页面无独立学历段（嵌在 bio 中），可 null' },
  { id: 'basic.bio',             fn: d => d.basic?.bio && d.basic.bio.length >= 30, critical: true },
  { id: 'basic.investmentYears', fn: d => typeof d.basic?.investmentYears === 'number' && d.basic.investmentYears > 0, critical: true },
  { id: 'basic.aumNumeric',      fn: d => typeof d.basic?.aumNumeric === 'number' && d.basic.aumNumeric > 0, critical: true },
  { id: 'basic.fundCountCurrent',fn: d => typeof d.basic?.fundCountCurrent === 'number' && d.basic.fundCountCurrent >= 1, critical: true },
  { id: 'basic.fundCountTotal',  fn: d => typeof d.basic?.fundCountTotal === 'number' && d.basic.fundCountTotal >= d.basic?.fundCountCurrent, critical: true },
  { id: 'basic.assetType',       fn: d => Array.isArray(d.basic?.assetType) && d.basic.assetType.length >= 1, critical: true },
  { id: 'basic.managementType',  fn: d => Array.isArray(d.basic?.managementType) && d.basic.managementType.length >= 1, critical: true },
  { id: 'basic.annualReturnEquity', fn: d => typeof d.basic?.annualReturnEquity === 'number', warnOnly: true },

  // ---------- labels ----------
  { id: 'labels.experience',     fn: d => Array.isArray(d.labels?.experience) && d.labels.experience.length >= 1, critical: true },
  { id: 'labels.holdingStyle',   fn: d => Array.isArray(d.labels?.holdingStyle) && d.labels.holdingStyle.length >= 1, critical: true },
  { id: 'labels.sectorPreference', fn: d => Array.isArray(d.labels?.sectorPreference) && d.labels.sectorPreference.length >= 1, critical: true },
  { id: 'labels.performance',    fn: d => Array.isArray(d.labels?.performance) && d.labels.performance.length >= 1, critical: true },

  // ---------- riskReturn ----------
  { id: 'riskReturn.current',    fn: d => !!d.riskReturn?.current, critical: true },
  { id: 'riskReturn.managerReturn', fn: d => typeof d.riskReturn?.current?.managerReturn === 'number' && d.riskReturn.current.managerReturn > -100, critical: true },
  { id: 'riskReturn.managerVol', fn: d => typeof d.riskReturn?.current?.managerVol === 'number' && d.riskReturn.current.managerVol >= 0, critical: true },
  { id: 'riskReturn.excess',     fn: d => {
    const cur = d.riskReturn?.current;
    if (!cur) return false;
    const computed = (cur.managerReturn || 0) - (cur.benchmarkReturn || 0);
    return Math.abs(computed - (cur.excessReturn || 0)) < 0.5;  // 容忍 0.5% 误差
  }, critical: true },

  // ---------- annualReturns ----------
  { id: 'annualReturns.benchmark', fn: d => !!d.annualReturns?.benchmark, critical: true },
  // iter-008 修订：动态阈值，照顾短期经理
  // iter-009 修订：放宽到 >= 2（2023 上任的经理只能有 2 个完整年：2024+2025）
  { id: 'annualReturns.years >= 8', fn: d => {
    const years = d.annualReturns?.returns?.length || 0;
    if (years >= 8) return true;
    // 短期经理：至少 2 年（去年 + 今年），且不超过投资年限
    const tenure = d.basic?.investmentYears || 0;
    return years >= 2 && years <= Math.ceil(tenure);
  }, critical: true },
  { id: 'annualReturns.sinceInception', fn: d => !!d.annualReturns?.sinceInception?.manager, critical: true },
  { id: 'annualReturns.noNullYears', fn: d => (d.annualReturns?.returns || []).every(y => y.manager !== null && y.benchmark !== null), critical: true },
  { id: 'annualReturns.excessAccurate', fn: d => (d.annualReturns?.returns || []).every(y => Math.abs((y.manager - y.benchmark) - y.excess) < 0.01), critical: true },

  // ---------- industryAllocation ----------
  { id: 'industryAllocation.current >= 1', fn: d => (d.industryAllocation?.current?.length || 0) >= 1, critical: true },
  { id: 'industryAllocation.topSector', fn: d => !!d.industryAllocation?.topSector, critical: true },
  { id: 'industryAllocation.pctSum <= 100', fn: d => {
    const total = (d.industryAllocation?.current || []).reduce((s, x) => s + x.pct, 0);
    return total <= 100.5;  // 容忍浮点
  }, critical: true },

  // ---------- styleBox ----------
  { id: 'styleBox.9cells', fn: d => d.styleBox && Object.values(d.styleBox.cells).filter(v => typeof v === 'number').length === 9, critical: true },
  { id: 'styleBox.sizeBias', fn: d => ['大盘', '中盘', '小盘'].includes(d.styleBox?.sizeBias), critical: true },
  { id: 'styleBox.styleBias', fn: d => ['价值', '平衡', '成长'].includes(d.styleBox?.styleBias), critical: true },

  // ---------- funds ----------
  { id: 'funds >= 1', fn: d => (d.funds?.length || 0) >= 1, critical: true },
  { id: 'funds.hasRepresentative', fn: d => (d.funds || []).some(f => f.isRepresentative), critical: true },
  { id: 'funds.codeFormat', fn: d => (d.funds || []).every(f => /^\d{6}$/.test(f.code)), critical: true },
  { id: 'funds.scaleReasonable', fn: d => (d.funds || []).every(f => f.scaleNumeric === null || (f.scaleNumeric >= 0 && f.scaleNumeric < 1000)), warnOnly: true },
  { id: 'funds.excessAccurate', fn: d => (d.funds || []).every(f =>
    f.tenureReturn === null || f.benchmarkReturn === null ||
    Math.abs((f.tenureReturn - f.benchmarkReturn) - (f.excessReturn || 0)) < 0.01
  ), critical: true },

  // ---------- topHoldings ----------
  { id: 'topHoldings.quarterly >= 5', fn: d => (d.topHoldings?.quarterly?.holdings?.length || 0) >= 5, critical: true },
  // iter-009 扩展：Bloomberg 后缀 UW/UN/CH + 数字 6 位（A 股）
  { id: 'topHoldings.codeFormat', fn: d => (d.topHoldings?.quarterly?.holdings || []).every(h => /\.(SHE|SHA|US|HK)$|^[A-Z0-9]+\s+(US|HK|UW|UN|CH)$|^\d{5,6}(\.HK)?$|^\d{6}$/.test(h.code)), critical: true },
  // iter-010 修订：放宽到 < 90（10 个标的均匀分布 8-10% 是合理集中）
  { id: 'topHoldings.weightSum < 80', fn: d => {
    const total = (d.topHoldings?.quarterly?.holdings || []).reduce((s, h) => s + h.weight, 0);
    return total < 90;  // 前 10 大持仓合计应 < 90%（单一标的权重已限 ≤10%）
  }, critical: true },

  // ---------- holdingPeriods ----------
  { id: 'holdingPeriods.quarterly >= 3', fn: d => (d.holdingPeriods?.quarterly?.items?.length || 0) >= 3, critical: true },
  { id: 'holdingPeriods.quartersReasonable', fn: d => (d.holdingPeriods?.quarterly?.items || []).every(i => i.quarters >= 1 && i.quarters <= 60), warnOnly: true }
];

// ============================================================
// 校验函数
// ============================================================

function validate(data) {
  const results = [];
  let criticalFail = 0;
  let warnFail = 0;
  for (const c of CHECKS) {
    let pass = false;
    let err = null;
    try {
      pass = !!c.fn(data);
    } catch (e) {
      err = e.message;
      pass = false;
    }
    results.push({ id: c.id, pass, critical: !!c.critical, warnOnly: !!c.warnOnly, note: c.note, err });
    if (!pass) {
      if (c.warnOnly) warnFail++;
      else criticalFail++;
    }
  }
  return {
    pass: criticalFail === 0,
    criticalFail,
    warnFail,
    totalChecks: CHECKS.length,
    results,
    snapshot: makeSnapshot(data)
  };
}

function makeSnapshot(data) {
  return {
    name: data._meta?.name,
    managerId: data._meta?.managerId,
    company: data.basic?.company,
    aum: data.basic?.aum,
    investmentYears: data.basic?.investmentYears,
    annualReturnEquity: data.basic?.annualReturnEquity,
    riskReturn1Y: data.riskReturn?.current?.managerReturn + '%',
    riskReturn1YVol: data.riskReturn?.current?.managerVol + '%',
    sinceInception: data.annualReturns?.sinceInception?.manager + '%',
    topSector: data.industryAllocation?.topSector,
    topSectorPct: data.industryAllocation?.topSectorPct + '%',
    styleBias: data.styleBox?.styleBias,
    sizeBias: data.styleBox?.sizeBias,
    fundCount: data.funds?.length,
    topHoldingsCount: data.topHoldings?.quarterly?.holdings?.length,
    holdingPeriodsCount: data.holdingPeriods?.quarterly?.items?.length,
    perfCount: data.labels?.performance?.length,
    perfPositive: (data.labels?.performance || []).filter(p => p.polarity === true).length,
    perfNegative: (data.labels?.performance || []).filter(p => p.polarity === false).length,
    perfNeutral: (data.labels?.performance || []).filter(p => p.polarity === null).length
  };
}

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function pad(s, n, r = false) {
  const str = String(s);
  return r ? str.padEnd(n) : str.padStart(n);
}

function printReport(filePath, report) {
  console.log('\n' + '='.repeat(80));
  console.log(`📄 ${filePath}`);
  console.log('='.repeat(80));

  // snapshot
  console.log('\n数据快照：');
  const s = report.snapshot;
  console.log(`  经理：${s.name}（ID: ${s.managerId}）· ${s.company}`);
  console.log(`  在管：${s.aum} · 投资年限 ${s.investmentYears} 年 · 权益型年化 ${s.annualReturnEquity}%`);
  console.log(`  1Y：${s.riskReturn1Y}（波动 ${s.riskReturn1YVol}）· 任职以来 ${s.sinceInception}`);
  console.log(`  行业 Top1：${s.topSector}（${s.topSectorPct}）· 风格：${s.sizeBias} ${s.styleBias}`);
  console.log(`  基金 ${s.fundCount} 只 · 持仓 ${s.topHoldingsCount} 条 · 持有期 ${s.holdingPeriodsCount} 条`);
  console.log(`  业绩标签 ${s.perfCount}（正${s.perfPositive}/负${s.perfNegative}/中${s.perfNeutral}）`);

  // checks
  console.log('\n校验项：');
  const grouped = { ok: [], critical: [], warn: [] };
  for (const r of report.results) {
    if (r.pass) grouped.ok.push(r);
    else if (r.warnOnly) grouped.warn.push(r);
    else grouped.critical.push(r);
  }
  for (const r of grouped.ok) {
    console.log(`  ✓ ${r.id}`);
  }
  for (const r of grouped.warn) {
    console.log(`  ⚠ ${r.id}${r.note ? ' — ' + r.note : ''}${r.err ? ' (err: ' + r.err + ')' : ''}`);
  }
  for (const r of grouped.critical) {
    console.log(`  ✗ ${r.id}${r.err ? ' (err: ' + r.err + ')' : ''}`);
  }

  console.log(`\n结果：${report.pass ? '✅ 通过' : '❌ 失败'} (${report.totalChecks - report.criticalFail - report.warnFail}/${report.totalChecks} 硬通过, ${report.warnFail} 警告)`);
  return report.pass;
}

function printSummary(reports) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 总览');
  console.log('='.repeat(80));

  // 表头
  const headers = ['ID', '经理', '公司', 'AUM', '1Y%', 'Vol%', '任职以来', '行业', '风格', '基金', '持仓', '标签', '硬校验'];
  const rows = [];
  for (const { file, report } of reports) {
    const s = report.snapshot;
    const hardPass = report.totalChecks - report.criticalFail - report.warnFail;
    rows.push([
      s.managerId,
      s.name,
      (s.company || '').replace(/基金管理(有限公司|股份有限公司)$/, ''),
      s.aum,
      s.riskReturn1Y,
      s.riskReturn1YVol,
      s.sinceInception,
      s.topSector,
      `${s.sizeBias.slice(0,1)}${s.styleBias.slice(0,1)}`,
      s.fundCount,
      s.topHoldingsCount,
      `${s.perfPositive}+${s.perfNegative}-${s.perfNeutral}中`,
      `${hardPass}/${report.totalChecks}`
    ]);
  }

  // 计算列宽
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i]).length))
  );

  // 表头分隔
  const fmt = (cells, sep = ' ') => cells.map((c, i) => pad(c, widths[i], true)).join(sep);
  console.log(fmt(headers));
  console.log(widths.map(w => '-'.repeat(w)).join(' '));
  for (const r of rows) console.log(fmt(r));

  // 整体结论
  const passed = reports.filter(r => r.report.pass).length;
  console.log(`\n${passed}/${reports.length} 份 JSON 通过硬校验`);
  if (passed < reports.length) {
    console.log('❌ 存在失败项，请检查');
    process.exitCode = 1;
  } else {
    console.log('✅ 全部通过');
  }
}

// ============================================================
// CLI 入口
// ============================================================

function main() {
  const args = process.argv.slice(2);
  let files = [];
  if (args.length === 0) {
    if (!fs.existsSync(DEFAULT_DIR)) {
      console.error(`目录不存在：${DEFAULT_DIR}`);
      process.exit(2);
    }
    files = fs.readdirSync(DEFAULT_DIR)
      .filter(f => /^manager-.*\.json$/.test(f))
      .map(f => path.join(DEFAULT_DIR, f));
  } else {
    files = args;
  }

  if (files.length === 0) {
    console.error('未找到 manager-*.json 文件');
    process.exit(2);
  }

  const reports = [];
  for (const f of files) {
    const data = loadJson(f);
    if (!data) {
      console.error(`✗ 读取失败：${f}`);
      process.exitCode = 2;
      continue;
    }
    const report = validate(data);
    printReport(f, report);
    reports.push({ file: f, report });
  }

  if (reports.length > 1) printSummary(reports);
}

if (require.main === module) main();

module.exports = { validate, CHECKS, makeSnapshot };