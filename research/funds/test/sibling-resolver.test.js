// test/sibling-resolver.test.js — pure, offline. searchByFundName is mocked.
//
// Covers the USD sibling-resolver fix (approach B): when oldestShareId collapses a fund to its
// USD-denominated share, the resolver replaces that row with its 人民币 sibling (instead of letting
// screen.js drop the whole fund). The resolver is pure + DI — the real morningstar adapter is a
// separate live task and is NOT exercised here.

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFundName, pickRmbSibling, resolveUsdSiblings } = require('../orchestrate/sibling-resolver');

// ---- fixtures: the 4 shares of 易方达全球成长精选 (A/C × 美元现汇/人民币) ----
// ids are 6-digit morningstar fund codes; the resolver treats rows as opaque beyond
// { id, fundName } so we keep them minimal but realistic.
const YFD_GLOBAL = {
  // USD victims (what oldestShareId collapsed the fund TO)
  usdA: { id: '012921', fundName: '易方达全球成长精选混合（QDII）A(美元现汇份额)', rating3Y: 5 },
  // 人民币 siblings
  rmbA: { id: '012920', fundName: '易方达全球成长精选混合（QDII）A(人民币份额)', rating3Y: 5 },
  rmbC: { id: '012922', fundName: '易方达全球成长精选混合（QDII）C(人民币份额)', rating3Y: 5 },
  // 美元 C share (also a USD victim candidate)
  usdC: { id: '012923', fundName: '易方达全球成长精选混合（QDII）C(美元现汇份额)', rating3Y: 5 },
};

// ============================================================================
// normalizeFundName
// ============================================================================
test('normalizeFundName: strips 美元现汇份额 share-class suffix → base QDII name', () => {
  assert.equal(
    normalizeFundName('易方达全球成长精选混合（QDII）A(美元现汇份额)'),
    '易方达全球成长精选混合（QDII）'
  );
});

test('normalizeFundName: strips 人民币份额 suffix too (idempotent on non-victims)', () => {
  assert.equal(
    normalizeFundName('易方达全球成长精选混合（QDII）A(人民币份额)'),
    '易方达全球成长精选混合（QDII）'
  );
});

test('normalizeFundName: strips 美元份额 / USD / 美金 variants', () => {
  assert.equal(normalizeFundName('某QDII基金A(美元份额)'), '某QDII基金');
  assert.equal(normalizeFundName('某QDII基金A(USD)'), '某QDII基金');
  assert.equal(normalizeFundName('某QDII基金A(美金)'), '某QDII基金');
});

test('normalizeFundName: strips trailing share-class letter adjacent to (…份额)', () => {
  // C share variant — the letter is INSIDE/adjacent to the paren, must still strip
  assert.equal(
    normalizeFundName('易方达全球成长精选混合（QDII）C(美元现汇份额)'),
    '易方达全球成长精选混合（QDII）'
  );
  // E share
  assert.equal(normalizeFundName('XX优选E(美元份额)'), 'XX优选');
});

test('normalizeFundName: does NOT over-strip a name that genuinely ends in A outside parens', () => {
  // No (…份额) suffix → leave the A alone (e.g. "中证500A" is a real ETF name)
  assert.equal(normalizeFundName('中证500A'), '中证500A');
  assert.equal(normalizeFundName('沪深300'), '沪深300');
});

test('normalizeFundName: full-width 人民币 not present as (…份额) → leaves the name alone', () => {
  // A non-share-class-suffixed name must pass through untouched (no regex false-positives)
  assert.equal(normalizeFundName('易方达蓝筹精选混合'), '易方达蓝筹精选混合');
});

// ============================================================================
// pickRmbSibling
// ============================================================================
test('pickRmbSibling: among 4 shares (A/C × 美元/人民币) → returns a 人民币 row', () => {
  const rows = [YFD_GLOBAL.usdA, YFD_GLOBAL.usdC, YFD_GLOBAL.rmbA, YFD_GLOBAL.rmbC];
  const picked = pickRmbSibling(rows);
  assert.ok(picked, 'must return a row');
  assert.ok(/人民币/.test(picked.fundName), 'picked row must be the 人民币 share');
});

test('pickRmbSibling: returns null when only USD shares exist (no 人民币 sibling)', () => {
  const rows = [YFD_GLOBAL.usdA, YFD_GLOBAL.usdC];
  assert.equal(pickRmbSibling(rows), null);
});

test('pickRmbSibling: returns null on empty list', () => {
  assert.equal(pickRmbSibling([]), null);
});

test('pickRmbSibling: when multiple 人民币 shares (A + C), picks deterministically — A-share preferred', () => {
  // Decision: prefer A over C (lower share-class letter) for a stable, auditable choice.
  // Rationale: A shares are the canonical long-hold retail class (no soft-tail fee), matching
  // the north-star holding horizon. The auditor (出局审计) needs a deterministic pick.
  const rows = [YFD_GLOBAL.rmbC, YFD_GLOBAL.rmbA];
  const picked = pickRmbSibling(rows);
  assert.equal(picked.id, YFD_GLOBAL.rmbA.id, 'prefer A-share when both A and C 人民币 exist');
});

test('pickRmbSibling: hasDossier predicate prefers dossier-backed 人民币 (even C over A without dossier)', () => {
  // Real production case: 012920 (A 人民币, NO dossier) + 012922 (C 人民币, HAS dossier) → pick 012922,
  // so the replacement is immediately scorable without re-scraping the A-share.
  const rows = [YFD_GLOBAL.rmbA, YFD_GLOBAL.rmbC];
  const hasDossier = (id) => id === YFD_GLOBAL.rmbC.id;
  const picked = pickRmbSibling(rows, { hasDossier });
  assert.equal(picked.id, YFD_GLOBAL.rmbC.id, 'dossier-backed C preferred over non-dossier A');
});

test('pickRmbSibling: hasDossier absent OR none dossier-backed → falls back to A-prefer', () => {
  const rows = [YFD_GLOBAL.rmbC, YFD_GLOBAL.rmbA];
  assert.equal(pickRmbSibling(rows).id, YFD_GLOBAL.rmbA.id, 'no predicate → A preferred');
  assert.equal(pickRmbSibling(rows, { hasDossier: () => false }).id, YFD_GLOBAL.rmbA.id, 'predicate matches none → A preferred');
});

// ============================================================================
// resolveUsdSiblings — the main entry
// ============================================================================
test('resolveUsdSiblings: USD victim 012921 → REPLACED by 人民币 sibling; other rows unchanged', async () => {
  const otherRow = { id: '000001', fundName: '华夏成长混合', rating3Y: 4 };
  const snapshot = { date: '2026-06-27', count: 2, rows: [otherRow, YFD_GLOBAL.usdA] };

  const searchByFundName = async (baseName) => {
    assert.equal(baseName, '易方达全球成长精选混合（QDII）', 'query uses normalized base name');
    return [YFD_GLOBAL.usdA, YFD_GLOBAL.usdC, YFD_GLOBAL.rmbA, YFD_GLOBAL.rmbC];
  };

  const r = await resolveUsdSiblings(snapshot, { searchByFundName });
  assert.equal(r.rows.length, 2, 'row count preserved');
  // victim replaced
  const replaced = r.rows.find(x => x.id !== otherRow.id);
  assert.ok(/人民币/.test(replaced.fundName), 'replaced row is a 人民币 share');
  assert.notEqual(replaced.id, YFD_GLOBAL.usdA.id, 'replaced id != USD victim id');
  // other row untouched
  assert.deepEqual(r.rows.find(x => x.id === otherRow.id), otherRow);
  // observability
  assert.equal(r.resolved.length, 1);
  assert.equal(r.unresolved.length, 0);
  assert.equal(r.resolved[0].victimId, YFD_GLOBAL.usdA.id);
  assert.equal(r.resolved[0].replacedWithId, replaced.id);
});

test('resolveUsdSiblings: victim with NO 人民币 sibling → LEFT AS-IS (non-regressing fallback)', async () => {
  const snapshot = { date: '2026-06-27', count: 1, rows: [YFD_GLOBAL.usdA] };
  const searchByFundName = async () => [YFD_GLOBAL.usdA, YFD_GLOBAL.usdC]; // only USD shares
  const r = await resolveUsdSiblings(snapshot, { searchByFundName });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, YFD_GLOBAL.usdA.id, 'victim row untouched');
  assert.deepEqual(r.rows[0], YFD_GLOBAL.usdA);
  assert.equal(r.resolved.length, 0);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].victimId, YFD_GLOBAL.usdA.id);
  assert.equal(r.unresolved[0].replacedWithId, undefined);
});

test('resolveUsdSiblings: non-USD rows are NEVER queried', async () => {
  const rmb = { id: '000001', fundName: '华夏成长混合', rating3Y: 4 };
  const usd = YFD_GLOBAL.usdA;
  const snapshot = { date: '2026-06-27', count: 2, rows: [rmb, usd] };
  const queried = [];
  const searchByFundName = async (name) => { queried.push(name); return [YFD_GLOBAL.rmbA]; };
  await resolveUsdSiblings(snapshot, { searchByFundName });
  assert.deepEqual(queried, ['易方达全球成长精选混合（QDII）'], 'only the USD victim is queried');
});

test('resolveUsdSiblings: empty snapshot / no USD rows → unchanged, searchByFundName never called', async () => {
  let calls = 0;
  const searchByFundName = async () => { calls++; return []; };

  // empty
  const e = await resolveUsdSiblings({ date: '2026-06-27', count: 0, rows: [] }, { searchByFundName });
  assert.equal(e.rows.length, 0);
  assert.equal(e.resolved.length, 0);
  assert.equal(e.unresolved.length, 0);

  // no USD
  const rmb = { id: '000001', fundName: '华夏成长混合', rating3Y: 4 };
  const n = await resolveUsdSiblings({ date: '2026-06-27', count: 1, rows: [rmb] }, { searchByFundName });
  assert.deepEqual(n.rows, [rmb]);
  assert.equal(calls, 0, 'searchByFundName never called when no USD rows');
});

test('resolveUsdSiblings: rows array order preserved (replacement is in-place, not appended)', async () => {
  const a = { id: '000001', fundName: 'A基金', rating3Y: 4 };
  const b = YFD_GLOBAL.usdA;
  const c = { id: '000003', fundName: 'C基金', rating3Y: 4 };
  const snapshot = { date: '2026-06-27', count: 3, rows: [a, b, c] };
  const searchByFundName = async () => [YFD_GLOBAL.rmbA, YFD_GLOBAL.rmbC];
  const r = await resolveUsdSiblings(snapshot, { searchByFundName });
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].id, a.id, 'first row preserved');
  assert.equal(r.rows[2].id, c.id, 'last row preserved');
  assert.ok(/人民币/.test(r.rows[1].fundName), 'middle (victim slot) now holds 人民币 sibling');
});

test('resolveUsdSiblings: default USD regex matches 美元 / USD / 美金 variants', async () => {
  const variants = [
    { id: '1', fundName: 'X(美元现汇份额)' },
    { id: '2', fundName: 'Y(USD)' },
    { id: '3', fundName: 'Z(美金)' },
  ];
  let calls = 0;
  const searchByFundName = async () => { calls++; return [{ id: 'r', fundName: 'R(人民币份额)' }]; };
  const r = await resolveUsdSiblings({ date: 'd', count: 3, rows: variants }, { searchByFundName });
  assert.equal(calls, 3, 'all three USD-variant victims queried');
  assert.equal(r.resolved.length, 3);
  assert.equal(r.rows.every(x => /人民币/.test(x.fundName)), true);
});
