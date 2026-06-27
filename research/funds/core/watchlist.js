// core/watchlist.js — 逐只纵向追踪（ops 硬化 + PLAN「watchlist per-code tracking」）。
//
// 互补于 analyze/diff.js（池级快照 diff）。这里跟踪 curated 码集（universe.watchlist）跨 dossier 版本，
// 发码级事件：评级变化 / 经理变更 / 规模档越线（>100亿容量侵蚀、<2亿清盘）/ 风格漂移。
// 用途：长跑期间对重点基金发增量告警，而非每次重看全量快照。
//
// 🔴 单源：规模阈值默认从 config.sizeRisk 派生（与 score.js sizeRiskOf 同源），不再手写镜像——
//    避免评分卡与 watchlist 判定漂移。可经 opts 覆盖（依赖注入）。

const _sizeRisk = require('./config/analysis.json').sizeRisk;
const CAPACITY_YI = _sizeRisk.capacityErosionYi;     // 单源：从 config 读（默认 100）
const LIQUIDATION_YI = _sizeRisk.liquidationRiskYi;  // 单源：从 config 读（默认 2）

/** 把 dossier 压成可比较的稳定摘要（只留慢变字段，剔除日期/净值类高频噪声）。 */
function summarize(dossier) {
  const d = dossier || {};
  const desc = d.description || {};
  const ratings = (d.performance && d.performance.ratings) || {};
  const team = (d.manager && Array.isArray(d.manager.team)) ? d.manager.team : [];
  return {
    code: desc.code || null,
    name: desc.name || null,
    rating3Y: ratings.rating3Y != null ? ratings.rating3Y : null,
    rating5Y: ratings.rating5Y != null ? ratings.rating5Y : null,
    managerName: team.map(m => m && m.name).filter(Boolean).join('、') || null,
    aumYi: desc.aumYi != null ? desc.aumYi : null,
    styleBox: desc.styleBox || null,
    asOfDate: desc.asOfDate || null,
  };
}

function aumBracket(aumYi, opts = {}) {
  const capacityYi = opts.capacityYi != null ? opts.capacityYi : CAPACITY_YI;
  const liquidationYi = opts.liquidationYi != null ? opts.liquidationYi : LIQUIDATION_YI;
  if (aumYi == null) return 'unknown';
  if (aumYi > capacityYi) return 'mega';      // 容量侵蚀区
  if (aumYi < liquidationYi) return 'tiny';   // 清盘风险区
  return 'normal';
}

function createWatchlist(codes) {
  return { codes: [...(codes || [])], last: {} };
}

/** 用新 dossier 更新某码的追踪态，返回相对上次的事件列表（首次=first_seen）。 */
function trackDossier(state, dossier, opts = {}) {
  const cur = summarize(dossier);
  const code = cur.code;
  if (!code) return [];
  const prev = state.last[code];
  state.last[code] = cur;
  if (!prev) return [{ code, name: cur.name, type: 'first_seen', field: null, before: null, after: cur }];
  const events = [];
  // 显式逐字段：type 用语义名，field 标具体字段（rating3Y/rating5Y/managerName/styleBox）
  if (prev.rating3Y !== cur.rating3Y) events.push({ code, name: cur.name, type: 'rating_change', field: 'rating3Y', before: prev.rating3Y, after: cur.rating3Y });
  if (prev.rating5Y !== cur.rating5Y) events.push({ code, name: cur.name, type: 'rating_change', field: 'rating5Y', before: prev.rating5Y, after: cur.rating5Y });
  if (prev.managerName !== cur.managerName) events.push({ code, name: cur.name, type: 'manager_change', field: 'managerName', before: prev.managerName, after: cur.managerName });
  if (prev.styleBox !== cur.styleBox) events.push({ code, name: cur.name, type: 'style_drift', field: 'styleBox', before: prev.styleBox, after: cur.styleBox });
  // 规模档越线（不报微小变动，只报跨过 capacity / liquidation 边界）
  const pb = aumBracket(prev.aumYi, opts), cb = aumBracket(cur.aumYi, opts);
  if (pb !== cb) events.push({ code, name: cur.name, type: 'size_bracket_change', field: 'aumYi', before: prev.aumYi, after: cur.aumYi });
  return events;
}

module.exports = { summarize, aumBracket, createWatchlist, trackDossier, CAPACITY_YI, LIQUIDATION_YI };
