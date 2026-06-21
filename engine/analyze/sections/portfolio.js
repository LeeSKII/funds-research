// engine/analyze/sections/portfolio.js — 投资组合 tab.
//
// Extracts: assetAllocation (股票/债券/现金/商品/其他 each {fund,peer}),
//   topHoldings (max 10, multi-market tickers: A-share 6-digit / HK 5-digit / US letters),
//   top10Concentration (sum of the 10 weights), sectorAllocation (rows: sector + fund/benchmark/excess),
//   regionAllocation (rows: region + fund, optionally benchmark/excess — region tables are often 1-col
//   with NO 基准% column; benchmark/excess then null, which is CORRECT not a miss), and turnover (换手率 %).
//
// Layout gotchas (see engine/docs/fund-detail-layouts.md):
//   - asset allocation rows are TWO physical lines: `<label>\n\t<fund>%\t<peer>%` (name alone, values next).
//   - holdings rows are `<ticker>\t<name>\t<industry>\t` then `\t<weight>%` on the FOLLOWING line; weight
//     is the first `N%` within the next 1-2 lines (skips the empty 风格箱 tab stop).
//   - sector rows: name on its OWN line then `\t<fund>\t<bench>\t<excess>` next (layout c). Fallback: tab-joined.
//   - region rows: tab-joined `<name>\t<fund>` is the common case; name-alone-then-next-line is the fallback.
//     Region tables have no 基准% column on most funds — accept nums.length >= 1.
//   - turnover: anchored on 换手率, first occurrence is the top-strip `换手率\n31%` (numAfter from 0).
//
// Ported from parse-fund.js v1.1.1 extractPortfolio + added `turnover` (home-tab rule: turnover lives in
// portfolio, not description). Generic anchors only; no fund-specific literals.

const {
  lineIdx, lineIdxAny, parseNum,
  SECTOR_HEADERS, REGION_HEADERS, REGION_NAMES, SECTOR_NAMES,
} = require('../shared');

function extractPortfolio(lines, ctx) {
  // ctx = {code} (unused here, but kept for section-signature uniformity).
  // ---- asset allocation (资产类型 block): name on its OWN line, `\\t<fund>%\\t<peer>%` next ----
  const assetIdx = lineIdx(lines, '资产类型');
  const asset = {};
  if (assetIdx >= 0) {
    for (const [key, label] of [['stock', '股票'], ['bond', '债券'], ['cash', '现金'], ['commodity', '商品'], ['other', '其他']]) {
      const li = lineIdx(lines, label, assetIdx);
      if (li >= 0 && li < assetIdx + 40) {
        const nums = lines.slice(li + 1, li + 4).join(' ').match(/-?[\d,]+\.?\d*/g);
        if (nums) {
          asset[key] = {
            fund: parseFloat(nums[0].replace(/,/g, '')),
            peer: nums[1] ? parseFloat(nums[1].replace(/,/g, '')) : null,
          };
        }
      }
    }
  }

  // ---- top holdings (multi-market tickers) ----
  const hdr = lineIdx(lines, '股票代码');
  const holdings = [];
  const tickerFormats = new Set();
  if (hdr >= 0) {
    for (let k = hdr + 1; k < Math.min(hdr + 80, lines.length) && holdings.length < 10; k++) {
      // ticker = 6-digit (A-share) | 5-digit (HK) | 1-6 letters (US); followed by \t<name>\t<industry>.
      const cm = lines[k].match(/^(\d{6}|\d{5}|[A-Z]{1,6})\t([^\t]+)\t([^\t]*)/);
      if (!cm) continue;
      const ticker = cm[1];
      if (/^\d{6}$/.test(ticker)) tickerFormats.add('asha6');
      else if (/^\d{5}$/.test(ticker)) tickerFormats.add('hk5');
      else tickerFormats.add('letter');
      let weight = null;
      for (let m = k + 1; m < k + 4; m++) {
        const wm = (lines[m] || '').match(/(-?\d+\.?\d*)%/);
        if (wm) { weight = parseFloat(wm[1]); break; }
      }
      holdings.push({ code: ticker, name: cm[2].trim(), industry: cm[3].trim() || null, weightPct: weight });
    }
  }
  const concentration = holdings.length
    ? Math.round(holdings.reduce((s, h) => s + (h.weightPct || 0), 0) * 100) / 100
    : null;

  // ---- sector allocation vs benchmark (行业配置 | 股票行业分布): name OWN line, values next (layout c) ----
  const sectorIdx = lineIdxAny(lines, SECTOR_HEADERS);
  const sectorNameOwn = new RegExp('^(' + SECTOR_NAMES.join('|') + ')$');      // primary: name alone
  const sectorNameTab = new RegExp('^(' + SECTOR_NAMES.join('|') + ')\\t');    // fallback: tab-joined
  const sector = [];
  if (sectorIdx >= 0) {
    for (let k = sectorIdx + 1; k < Math.min(sectorIdx + 80, lines.length); k++) {
      const t = lines[k];
      let name = null, nums = null;
      if (sectorNameOwn.test(t.trim())) {
        name = t.trim();
        nums = lines.slice(k + 1, k + 4).join(' ').match(/-?[\d,]+\.?\d*/g);
      } else {
        const m = t.match(sectorNameTab);
        if (m) {
          name = m[1];
          nums = t.split('\t').slice(1).join(' ').match(/-?[\d,]+\.?\d*/g);
        }
      }
      if (name && nums && nums.length >= 1) {
        sector.push({
          sector: name,
          fund: parseFloat(nums[0].replace(/,/g, '')),
          benchmark: nums[1] ? parseFloat(nums[1].replace(/,/g, '')) : null,
          excess: nums[2] ? parseFloat(nums[2].replace(/,/g, '')) : null,
        });
      }
    }
  }

  // ---- region allocation (地区配置 | 股票地区分布 | 区域配置): tab-joined OR name-alone ----
  const regionIdx = lineIdxAny(lines, REGION_HEADERS);
  const regionNameTab = new RegExp('^(' + REGION_NAMES.join('|') + ')\\t(.*)');  // primary: tab-joined
  const regionNameOwn = new RegExp('^(' + REGION_NAMES.join('|') + ')$');        // fallback: name alone
  const region = [];
  if (regionIdx >= 0) {
    for (let k = regionIdx + 1; k < Math.min(regionIdx + 80, lines.length); k++) {
      const t = lines[k];
      let name = null, nums = null;
      const mTab = t.match(regionNameTab);
      if (mTab) {
        name = mTab[1];
        nums = mTab[2].split('\t').map(s => s.trim()).join(' ').match(/-?[\d,]+\.?\d*/g);
      } else if (regionNameOwn.test(t.trim())) {
        name = t.trim();
        nums = lines.slice(k + 1, k + 4).join(' ').match(/-?[\d,]+\.?\d*/g);
      }
      if (name && nums && nums.length >= 1) {
        region.push({
          region: name,
          fund: parseFloat(nums[0].replace(/,/g, '')),
          // region tables often have NO 基准% column — null is correct, not a miss.
          benchmark: nums[1] ? parseFloat(nums[1].replace(/,/g, '')) : null,
          excess: nums[2] ? parseFloat(nums[2].replace(/,/g, '')) : null,
        });
      }
    }
  }

  // ---- turnover (换手率 %): first occurrence = top-strip `换手率\\n31%` ----
  let turnover = null;
  {
    const i = lineIdx(lines, '换手率');
    if (i >= 0) {
      // the value follows the label within 1-2 non-empty lines (top strip or the 投资组合 tab block).
      for (let k = i + 1; k < Math.min(i + 1 + 4, lines.length); k++) {
        const t = lines[k].trim();
        if (!t) continue;
        const n = parseNum(t);
        if (n != null) { turnover = n; break; }
      }
    }
  }

  return {
    assetAllocation: asset,
    topHoldings: holdings,
    top10Concentration: concentration,
    sectorAllocation: sector,
    regionAllocation: region,
    turnover,
    _tickerFormats: [...tickerFormats],  // diagnostics aid (not in schema strict fields; additionalProperties:true)
  };
}

module.exports = { extractPortfolio };
