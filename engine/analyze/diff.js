// analyze/diff.js — pure: compare two snapshots → change events.
// Only flags structural + slow-changing fields (ratings, manager). Daily-return fields are NOT diffed.
const RATING_FIELDS = ['rating3Y', 'rating5Y'];

/**
 * @param {{ rows: object[] }} prev
 * @param {{ rows: object[] }} curr
 * @param {string} [date]
 * @returns {{ date: string, events: object[] }}
 */
function diffSnapshots(prev, curr, date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const prevMap = new Map(prev.rows.map(r => [r.id, r]));
  const currMap = new Map(curr.rows.map(r => [r.id, r]));
  const events = [];

  for (const [id, c] of currMap) {
    if (!prevMap.has(id)) events.push({ code: id, fundName: c.fundName, type: 'new_fund', field: null, before: null, after: null });
  }
  for (const [id, p] of prevMap) {
    if (!currMap.has(id)) events.push({ code: id, fundName: p.fundName, type: 'removed', field: null, before: null, after: null });
  }
  for (const [id, c] of currMap) {
    const p = prevMap.get(id);
    if (!p) continue;
    for (const f of RATING_FIELDS) {
      if (p[f] !== c[f]) events.push({ code: id, fundName: c.fundName, type: 'rating_change', field: f, before: p[f], after: c[f] });
    }
    if (p.managerName !== c.managerName) {
      events.push({ code: id, fundName: c.fundName, type: 'manager_change', field: 'managerName', before: p.managerName, after: c.managerName });
    }
  }
  return { date: day, events };
}

module.exports = { diffSnapshots };
