// orchestrate/sibling-resolver.js — pure USD sibling-resolver (approach B).
//
// PROBLEM: morningstar's `oldestShareId:"true"` (server-side, in universe.search_filter) collapses
// each fund to its OLDEST share. For some QDII funds the oldest share is USD-denominated
// (e.g. 易方达全球成长精选 → 012921 "A(美元现汇份额)"). analyze/screen.js then drops any row whose
// fundName matches USD_SHARECLASS_REGEX, so the ENTIRE fund is lost — including its perfectly good
// 人民币 share (012922 "C(人民币份额)") which never made it into the snapshot because oldestShareId
// collapsed the fund to the USD one.
//
// FIX: keep oldestShareId (it dedups funds correctly elsewhere). When a snapshot row is a USD-victim,
// query morningstar for that fund's shares and REPLACE the USD row with its 人民币 sibling — instead
// of letting screen.js drop the whole fund. This module is the pure, testable, DI'd core of that fix;
// the live morningstar adapter (searchByFundName) is wired in a separate live step.
//
// 🔴 PURE + DI: no fs, no network. searchByFundName is INJECTED. Offline tests pass a mock; the live
//    runDaily passes the real adapter via opts. Non-regressing: when searchByFundName is absent OR a
//    victim has no 人民币 sibling, behavior is UNCHANGED from today (screen.js drops the row as before).
//
// Idioms match bulk-sweep.js / screen.js: CommonJS, node:test, pure functions, no new deps.

// Re-use screen.js's exact USD detection so the resolver and the downstream drop stay in lockstep.
// (screen.js exports the regex for shared use; importing it avoids a second source of truth.)
const { USD_SHARECLASS_REGEX } = require('../analyze/screen');

// Match the trailing share-class suffix that oldestShareId keeps. Captures two parts:
//   (<share-class letter>)? + (currency/份额 parenthetical)
// Examples that MUST match (and strip):
//   "…（QDII）A(美元现汇份额)"  → "…（QDII）"
//   "…（QDII）C(人民币份额)"    → "…（QDII）"
//   "…A(USD)"                  → "…"
//   "…E(美金)"                 → "…"
// Examples that MUST NOT match (no over-strip):
//   "中证500A"                 → untouched (no (…份额)/(USD)/(美金) tail)
//   "易方达蓝筹精选混合"        → untouched
//
// Anchored to end-of-string so a "份额" appearing mid-name (none observed, but defense) is safe.
// The trailing tail is one of: 人民币份额 | 美元现汇份额 | 美元份额 | USD | 美金  (optionally with
// surrounding full/half-width parens). Preceded by an OPTIONAL isolated share-class letter A/C/E/I/O.
const SHARECLASS_SUFFIX_RE = /[ACEIOaceio]?\s*[(（][^()（）]*?(?:人民币份额|美元现汇份额|美元份额|美金|USD)[^()（）]*?[)）]\s*$/;

/**
 * Strip the trailing currency/share-class suffix from a fund name, returning the base name used to
 * query morningstar for siblings.
 *
 * - Strips one trailing `(…份额)` / `(USD)` / `(美金)` parenthetical AND an isolated share-class
 *   letter (A/C/E/...) immediately adjacent to it.
 * - Does NOT over-strip: a name with no such suffix is returned unchanged (e.g. "中证500A" stays).
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeFundName(name) {
  if (!name || typeof name !== 'string') return name;
  return name.replace(SHARECLASS_SUFFIX_RE, '').trim();
}

/**
 * Decide whether a sibling row is a 人民币 share.
 * @param {{fundName:string}} row
 * @returns {boolean}
 */
function _isRmb(row) {
  return !!(row && row.fundName && /人民币/.test(row.fundName));
}

/**
 * From a list of sibling share-rows for one fund, pick the 人民币 one to substitute for the USD
 * victim. Returns null when there is no 人民币 sibling (caller leaves the victim as-is).
 *
 * Decision when multiple 人民币 shares exist (A + C): prefer the A-share.
 * Rationale: A-shares are the canonical long-hold retail class (no 7-day/soft penalty tail), which
 * matches the north-star holding horizon. The pick is deterministic so the 出局审计 view is stable.
 *
 * @param {Array<{id:string, fundName:string}>} siblings
 * @returns {{id:string, fundName:string}|null}
 */
function pickRmbSibling(siblings, opts = {}) {
  if (!Array.isArray(siblings) || siblings.length === 0) return null;
  const rmb = siblings.filter(_isRmb);
  if (rmb.length === 0) return null;
  if (rmb.length === 1) return rmb[0];
  // Preference: dossier-backed 人民币 (already scorable — no re-scrape needed) > A-share > C-share > first.
  // `hasDossier` is an OPTIONAL injected predicate (id => bool); absent → that tier is skipped.
  const { hasDossier } = opts;
  const withDossier = (typeof hasDossier === 'function') ? rmb.filter(r => hasDossier(r.id)) : [];
  const pool = withDossier.length ? withDossier : rmb;
  // The share-class letter sits BEFORE the opening paren: "…A(人民币份额)".
  return pool.find(r => /A\s*[(（].*?份额[)）]\s*$/.test(r.fundName))
    || pool.find(r => /C\s*[(（].*?份额[)）]\s*$/.test(r.fundName))
    || pool[0];
}

/**
 * Pure + async resolver. Iterates a snapshot's rows; for each USD-victim row (fundName matches the
 * USD share-class regex), normalizes the name, queries the injected searchByFundName, picks the
 * 人民币 sibling, and REPLACES the victim row in-place. Non-victim rows are untouched and never
 * queried. Victims with no 人民币 sibling are LEFT AS-IS (screen.js handles them as before).
 *
 * @param {{date?:string, count?:number, rows: Array<{id:string, fundName:string}>}} snapshot
 * @param {object} opts
 * @param {(baseName:string)=>Promise<Array<{id:string,fundName:string}>>} opts.searchByFundName
 *        injected query — returns sibling share-rows for a normalized fund base name.
 * @param {RegExp} [opts.usdRegex]  override USD detection (defaults to screen.js USD_SHARECLASS_REGEX)
 * @returns {Promise<{rows: Array, resolved: Array<{victimId:string,replacedWithId:string}>, unresolved: Array<{victimId:string,replacedWithId?:string}>}>}
 */
async function resolveUsdSiblings(snapshot, opts) {
  const rows = (snapshot && Array.isArray(snapshot.rows)) ? snapshot.rows : [];
  const { searchByFundName, usdRegex = USD_SHARECLASS_REGEX, hasDossier } = opts || {};
  const resolved = [];
  const unresolved = [];

  // No query fn → return rows unchanged (non-regressing; also covers empty snapshot).
  if (typeof searchByFundName !== 'function') {
    return { rows: rows.slice(), resolved, unresolved };
  }

  const out = [];
  for (const row of rows) {
    const isVictim = !!(row && row.fundName && usdRegex.test(row.fundName));
    if (!isVictim) {
      out.push(row);
      continue;
    }
    let replaced = null;
    try {
      const baseName = normalizeFundName(row.fundName);
      const siblings = await searchByFundName(baseName);
      replaced = pickRmbSibling(siblings, { hasDossier });
    } catch (_err) {
      // Query failure is non-fatal: leave victim as-is so screen.js's existing behavior applies.
      // (Auditor sees the unresolved entry; the live adapter does its own retry/error logging.)
      replaced = null;
    }
    if (replaced) {
      out.push(replaced);
      resolved.push({ victimId: row.id, replacedWithId: replaced.id });
    } else {
      out.push(row); // NON-REGRESSING: leave the USD row, screen.js will drop it as it does today.
      unresolved.push({ victimId: row.id });
    }
  }
  return { rows: out, resolved, unresolved };
}

module.exports = { normalizeFundName, pickRmbSibling, resolveUsdSiblings, SHARECLASS_SUFFIX_RE };
