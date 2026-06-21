// research/funds/analyze/shared.js — shared line-parsing helpers for the v2 page-structure-aligned
// fund-detail extractors. Each section extractor in research/funds/analyze/sections/<name>.js requires
// these, so the assembly is stable and a bug localizes to ONE section file.
//
// Extracted verbatim from parse-fund.js v1.1.1 (battle-tested on the 18-fund corpus + 005827).
// Three intra-section value-layouts (see research/funds/docs/fund-detail-layouts.md §8):
//   (c) value AFTER label   → numAfter     (table rows: `最大回撤\n-11.90%`)
//   (b) value ON anchor line → numOnLine   (`任职回报327.11%`, `管理费(每年)\t1.20%`)
//   (a) value BEFORE label  → numBefore    (KPI strips / cost waterfall: `118.48亿\n在管规模`)
// pairAfter reads caveat rows for [fund, peer] pairs (性价比 / 风险和波动) and accepts the FULL
// caveat set (优于X%同类 | 负值/正值暂不排名 | 暂不排名), not just 优于 — so calmar/sortino survive
// on funds whose ratio went negative.

const lineIdx = (lines, anchor, from = 0) => { for (let i = from; i < lines.length; i++) if (lines[i].includes(anchor)) return i; return -1; };
const lineIdxAny = (lines, anchors, from = 0) => { for (let i = from; i < lines.length; i++) if (anchors.some(a => lines[i].includes(a))) return i; return -1; };

/** Parse the first number out of a token string; null for em-dash / empty / non-numeric. Preserves sign. */
const parseNum = t => {
  if (t == null) return null;
  const s = String(t).replace(/优于\d+%同类/g, '').trim();
  if (!s || s === '—' || s === '-') return null;
  const m = s.match(/-?[\d,]+\.?\d*/);
  return m ? parseFloat(m[0].replace(/,/g, '')) : null;
};

/** (c) First numeric value on a non-empty line AFTER the anchor line. */
const numAfter = (lines, anchor, { from = 0, maxScan = 4 } = {}) => {
  const i = lineIdx(lines, anchor, from);
  if (i < 0) return null;
  for (let k = i + 1; k < Math.min(i + 1 + maxScan, lines.length); k++) {
    const t = lines[k].trim();
    if (!t) continue;
    const n = parseNum(t); if (n != null) return n;
  }
  return null;
};

/** (b) Numeric value on the anchor line ITSELF, after the anchor substring (label-tab-value). */
const numOnLine = (lines, anchor, { from = 0 } = {}) => {
  const i = lineIdx(lines, anchor, from);
  if (i < 0) return null;
  const after = lines[i].slice(lines[i].indexOf(anchor) + anchor.length);
  return parseNum(after);
};

/** (a) Numeric value on the line BEFORE the anchor (value-then-label KPI strips). */
const numBefore = (lines, anchor, { from = 0 } = {}) => {
  const i = lineIdx(lines, anchor, from);
  if (i < 1) return null;
  return parseNum(lines[i - 1]);
};

/** Caveat forms on a 性价比/风险和波动 value line (ranked or unranked-but-shown). */
const CAVEAT_RE = /优于\d+%同类|负值暂不排名|正值暂不排名|暂不排名/;

/** [fund, peer] pair from the caveat line after the anchor (性价比 / 风险和波动 rows). */
const pairAfter = (lines, anchor, { from = 0, maxScan = 4 } = {}) => {
  const i = lineIdx(lines, anchor, from);
  if (i < 0) return null;
  for (let k = i + 1; k < Math.min(i + 1 + maxScan, lines.length); k++) {
    const t = lines[k].trim();
    if (!t || !CAVEAT_RE.test(t)) continue;
    const nums = t.replace(CAVEAT_RE, '').match(/-?[\d,]+\.?\d*/g);
    if (nums) return { fund: parseFloat(nums[0].replace(/,/g, '')), peer: nums[1] ? parseFloat(nums[1].replace(/,/g, '')) : null };
  }
  return null;
};

/** Numeric tokens (one per value line) between two anchors — for table rows (trailing/annual returns). */
const tokensBetween = (lines, startAnchor, endAnchor, { from = 0, maxScan = 80 } = {}) => {
  const s = lineIdx(lines, startAnchor, from);
  if (s < 0) return [];
  const e = lineIdx(lines, endAnchor, s + 1);
  const end = e < 0 ? Math.min(s + 1 + maxScan, lines.length) : e;
  const out = [];
  for (let i = s + 1; i < end; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const cleaned = t.replace(/优于\d+%同类/g, '');
    const m = cleaned.match(/-?[\d,]+\.?\d*/);
    if (m) out.push(parseFloat(m[0].replace(/,/g, '')));
    else if (cleaned.includes('—')) out.push(null);
  }
  return out;
};

/** Text labels (matching `re`) between two anchors — for table header rows. */
const labelsBetween = (lines, startAnchor, endAnchor, re, { from = 0, maxScan = 40 } = {}) => {
  const s = lineIdx(lines, startAnchor, from);
  if (s < 0) return [];
  const e = lineIdx(lines, endAnchor, s + 1);
  const end = e < 0 ? Math.min(s + 1 + maxScan, lines.length) : e;
  const out = [];
  for (let i = s + 1; i < end; i++) {
    const t = lines[i].trim();
    if (re.test(t) && !out.includes(t)) out.push(t);
  }
  return out;
};

const PERIOD_RE = /^(近一|近两|近二|近三|近四|近五|近六|近七|近十|今年以|成立)/;  // 近两年 uses 两, not 二

// Section-header display variants (single anchors miss QDII/HK-origin funds).
const SECTOR_HEADERS = ['行业配置', '股票行业分布'];
const REGION_HEADERS = ['股票地区分布', '地区配置', '区域配置'];

// Region/sector name vocabularies (rows may be tab-joined with values OR alone on their line).
const REGION_NAMES = ['大亚洲地区', '美洲', '大欧洲地区', '发达亚洲', '新兴亚洲', '北美', '拉丁美洲', '发达欧洲', '新兴欧洲', '日本', '英国', '大洋洲', '非洲/中东', '非洲', '未分类'];
const SECTOR_NAMES = ['周期性', '敏感性', '防御性', '基础材料', '可选消费', '金融服务', '房地产', '通信服务', '能源', '工业', '科技', '必选消费', '医疗保健', '公用事业'];

module.exports = {
  lineIdx, lineIdxAny, parseNum,
  numAfter, numOnLine, numBefore, pairAfter,
  tokensBetween, labelsBetween,
  PERIOD_RE, CAVEAT_RE,
  SECTOR_HEADERS, REGION_HEADERS, REGION_NAMES, SECTOR_NAMES,
};
