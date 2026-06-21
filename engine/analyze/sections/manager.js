// engine/analyze/sections/manager.js — 基金经理 tab extractor (v2 page-aligned).
//
// Extracts the WHOLE management team (resolves the v1 multi-manager limitation where only the
// first manager was captured): team[] = every name + tenure pair from the 管理团队 block, plus
// managerCount / maxTenureYears / avgTenureYears strip stats, plus lead = longest-tenure
// manager's KPI block (任职回报 / 在管规模 / 管理数量).
//
// Layout gotchas (morningstar.cn /fund/<id>.html · 基金经理 tab):
//   • 管理团队 block = alternating NAME line then DATE line ("YYYY-MM-DD 至今" = still serving,
//     "YYYY-MM-DD ~ YYYY-MM-DD" = fixed term). Block is bounded above by the 管理团队 header and
//     below by 基金经理时间线 — walk name→date pairs between them.
//   • The lead's KPI strip uses layout (a) value-BEFORE-label (numBefore): "416.72亿\n在管规模",
//     "4\n管理数量". CRITICAL: 管理数量 must read the line BEFORE it (=4, the fund count), NOT the
//     "前71%" percentile that sits BEFORE 收益能力 (the next label) — both are plain numbers, so a
//     blind numBefore on 收益能力 would wrongly yield 71.
//   • 任职回报 is layout (b) value-ON-line ("任职回报56.16%"). Year-guard: the FIRST 任职回报 on
//     the page is the lead's and is a real %, but a bio join-year (1900-2099 bare int) would be a
//     false hit on some funds — reject it and keep scanning.
//   • skin-in-the-game (基金经理自购) is NOT here — it moved to holders.insiders.

const {
  lineIdx, parseNum, numAfter, numOnLine, numBefore,
} = require('../shared');

// Date line in the 管理团队 block: "2018-09-05 至今"  |  "2015-11-07 ~ 2021-02-11".
const TENURE_DATE_RE = /(\d{4}-\d{2}-\d{2})\s*(至今|~\s*\d{4}-\d{2}-\d{2})/;

/**
 * Parse a 管理团队 date line into { start, end }.
 *   "2018-09-05 至今"           → { start: '2018-09-05', end: null }
 *   "2015-11-07 ~ 2021-02-11"   → { start: '2015-11-07', end: '2021-02-11' }
 */
function parseTenureDate(line) {
  if (line == null) return { start: null, end: null };
  const s = line.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})\s*(至今|~\s*(\d{4}-\d{2}-\d{2}))?$/);
  if (!m) return { start: null, end: null };
  return { start: m[1] || null, end: m[3] || null };
}

/**
 * Walk the 管理团队 block (bounded above by the 管理团队 header, below by 基金经理时间线 / next
 * sub-section) collecting [name, date] pairs.
 */
function parseTeam(lines) {
  const team = [];
  const start = lineIdx(lines, '管理团队');
  if (start < 0) return team;
  // Stop at the next known sub-section header (timeline) or after a generous scan.
  const end = lineIdx(lines, '基金经理时间线', start + 1);
  const stop = end < 0 ? Math.min(start + 1 + 30, lines.length) : end;
  for (let i = start + 1; i < stop; i++) {
    const line = (lines[i] || '').trim();
    if (!line) continue;
    if (TENURE_DATE_RE.test(line)) continue;          // date line — consumed with its name below
    // Candidate name line: non-empty, no digits, not a known header.
    if (/\d/.test(line)) continue;                     // names have no digits
    const dateLine = (lines[i + 1] || '').trim();
    if (!TENURE_DATE_RE.test(dateLine)) continue;      // must be followed by a tenure date
    const { start: tenureStart, end: tenureEnd } = parseTenureDate(dateLine);
    team.push({ name: line, tenureStart, tenureEnd });
  }
  return team;
}

/**
 * First 任职回报 on the page that is a real %, skipping a bare bio join-year (1900-2099 integer)
 * which would be a false hit. Layout (b): value on the anchor line itself.
 */
function leadReturnSinceInception(lines) {
  let from = 0;
  for (let guard = 0; guard < 8; guard++) {
    const i = lineIdx(lines, '任职回报', from);
    if (i < 0) return null;
    const v = numOnLine(lines, '任职回报', { from });
    if (v != null) {
      const bareYear = Number.isInteger(v) && v >= 1900 && v <= 2099;
      if (!bareYear) return v;
    }
    from = i + 1;
  }
  return null;
}

/**
 * extractManager — 基金经理 tab.
 * @param {string[]} lines  full innerText split on newline
 * @param {{code?:string}} ctx
 * @returns {{team, managerCount, maxTenureYears, avgTenureYears, lead}}
 */
function extractManager(lines, ctx = {}) {
  try {
    const team = parseTeam(lines);

    // Count / tenure strip lives ABOVE the 管理团队 block. Constrain the search to before the
    // team header so we never pick up the 基金公司 block's own 基金经理人数 row (a second match that
    // appears later in the page for a different fund-company entity).
    const teamHeader = lineIdx(lines, '管理团队');
    const countSearchLimit = teamHeader > 0 ? teamHeader : lines.length;
    let managerCount = null;
    const cntIdx = lineIdx(lines, '基金经理人数');
    if (cntIdx >= 0 && cntIdx < countSearchLimit) {
      managerCount = numAfter(lines, '基金经理人数', { from: cntIdx, maxScan: 2 });
    }

    // Longest / average tenure: value is on the line AFTER the label, e.g. "7.8年".
    let maxTenureYears = null;
    let avgTenureYears = null;
    const maxIdx = lineIdx(lines, '最长任职年限');
    if (maxIdx >= 0 && maxIdx < countSearchLimit) {
      maxTenureYears = numAfter(lines, '最长任职年限', { from: maxIdx, maxScan: 2 });
    }
    const avgIdx = lineIdx(lines, '平均任职年限');
    if (avgIdx >= 0 && avgIdx < countSearchLimit) {
      avgTenureYears = numAfter(lines, '平均任职年限', { from: avgIdx, maxScan: 2 });
    }

    // Lead = longest-tenure manager. Pick the team member whose tenureStart is earliest (== longest
    // served among still-active / mixed teams). Fallback: team[0].
    let leadName = null;
    if (team.length) {
      let best = team[0];
      for (const m of team) {
        if (m.tenureStart && (!best.tenureStart || m.tenureStart < best.tenureStart)) best = m;
      }
      leadName = best.name;
    }

    // Lead KPIs. All three sit in the lead's bio KPI strip using layout (a)/(b).
    const returnSinceInception = leadReturnSinceInception(lines);
    const aumYi = numBefore(lines, '在管规模');     // "416.72亿" before label
    const fundsManaged = numBefore(lines, '管理数量'); // "4" before label (NOT 前71%)

    const lead = {
      name: leadName,
      returnSinceInception,
      aumYi,
      fundsManaged,
    };

    return {
      team,
      managerCount,
      maxTenureYears,
      avgTenureYears,
      lead,
    };
  } catch (_err) {
    // Null-safe contract: never throw. Return a minimally-shaped block so the orchestrator can
    // still assemble the dossier and flag the section via _diagnostics.
    return {
      team: [],
      managerCount: null,
      maxTenureYears: null,
      avgTenureYears: null,
      lead: { name: null, returnSinceInception: null, aumYi: null, fundsManaged: null },
    };
  }
}

module.exports = { extractManager };
