// engine/test/sections/holders.test.js — section-localized test for the 持有人 tab extractor.
//
// Reads the real 005827 ground-truth snapshot (易方达蓝筹精选混合, 张坤), runs extractHolders,
// and locks every documented field: 持有人结构 (机构/个人), the 4 内部人员持有 sub-sections
// (经理自持 / 高管投研跟投 / 内部员工 / 基金公司直持) with their shares / estAmount / pct,
// 被FOF持有情况, 分红与拆分. The insider sub-sections mix bin-label values (`>100`) with
// magnitudes (`1,601.5`) — both must surface intact.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractHolders } = require('../../analyze/sections/holders');

const SNAP = path.join(__dirname, '..', '..', '..', 'research', 'funds', 'raw-snapshots', 'morningstar-fund-005827-20260621-innertext.json');

function loadLines() {
  const raw = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const text = typeof raw === 'string' ? raw : (raw.innerText || '');
  return text.split('\n');
}

test('extractHolders — 持有人结构: 机构 0.77 / 个人 99.23', () => {
  const out = extractHolders(loadLines(), { code: '005827' });
  assert.equal(out.institutional, 0.77);
  assert.equal(out.retail, 99.23);
});

test('extractHolders — 基金经理自持: >100万份 + >186 万元', () => {
  const { insiders } = extractHolders(loadLines(), { code: '005827' });
  const m = insiders.managerSelf;
  assert.ok(m, 'managerSelf present');
  assert.ok(typeof m.shares === 'string' && m.shares.includes('>100'), `shares carries >100: ${m.shares}`);
  assert.ok(m.estAmount && m.estAmount.includes('>186'), `estAmount carries >186: ${m.estAmount}`);
  assert.equal(m.pct, null);  // 经理自持 has no 占总份额比例 row
});

test('extractHolders — 高管投研跟投: >100万份 + >186 万元', () => {
  const { insiders } = extractHolders(loadLines(), { code: '005827' });
  const e = insiders.executive;
  assert.ok(e, 'executive present');
  assert.ok(typeof e.shares === 'string' && e.shares.includes('>100'), `shares carries >100: ${e.shares}`);
  assert.ok(e.estAmount && e.estAmount.includes('>186'), `estAmount carries >186: ${e.estAmount}`);
  assert.equal(e.pct, null);
});

test('extractHolders — 内部员工持有: 1,601.5 万份, pct 0.18, 2,982.5 万元', () => {
  const { insiders } = extractHolders(loadLines(), { code: '005827' });
  const emp = insiders.employee;
  assert.ok(emp, 'employee present');
  // magnitude value gets normalised to the number; the leading `1,` becomes part of the number
  assert.ok(emp.shares.includes('1601.5'), `shares carries 1601.5: ${emp.shares}`);
  assert.equal(emp.pct, 0.18);
  assert.ok(emp.estAmount && emp.estAmount.includes('2,982.5'), `estAmount carries 2,982.5: ${emp.estAmount}`);
});

test('extractHolders — 基金公司直接持有: 7,046.2 万份, pct 0.46, 12,443.5 万元', () => {
  const { insiders } = extractHolders(loadLines(), { code: '005827' });
  const cd = insiders.companyDirect;
  assert.ok(cd, 'companyDirect present');
  assert.ok(cd.shares.includes('7046.2'), `shares carries 7046.2: ${cd.shares}`);
  assert.equal(cd.pct, 0.46);
  assert.ok(cd.estAmount && cd.estAmount.includes('12,443.5'), `estAmount carries 12,443.5: ${cd.estAmount}`);
});

test('extractHolders — insider trend (持平/减持 + change%): employee 减持 -7.09%', () => {
  const { insiders } = extractHolders(loadLines(), { code: '005827' });
  // 持平 sub-sections carry direction but no change % (next line is 无 / 占总份额比例).
  assert.deepEqual(insiders.managerSelf.trend, { direction: '持平', changePct: null });
  assert.deepEqual(insiders.executive.trend, { direction: '持平', changePct: null });
  assert.deepEqual(insiders.companyDirect.trend, { direction: '持平', changePct: null });
  // employee reduced skin-in-the-game: 减持 -7.09%.
  assert.deepEqual(insiders.employee.trend, { direction: '减持', changePct: -7.09 });
});

test('extractHolders — sub-sections do not cross-contaminate (4 distinct shares)', () => {
  const { insiders } = extractHolders(loadLines(), { code: '005827' });
  // The 基金公司直接持有 block has a 2026-03-31 date line right after the title — the bounded
  // scan must skip it and still bind 7,046.2 as the shares, not bleed 12,443.5 into employee.
  assert.ok(!insiders.employee.shares.includes('7046.2'), 'employee not polluted by companyDirect');
  assert.ok(!insiders.companyDirect.shares.includes('1601.5'), 'companyDirect not polluted by employee');
});

test('extractHolders — fofHeld truthy and mentions 暂未有被FOF', () => {
  const { fofHeld } = extractHolders(loadLines(), { code: '005827' });
  assert.ok(fofHeld, 'fofHeld truthy');
  assert.ok(String(fofHeld).includes('暂未有被FOF'), `fofHeld text: ${fofHeld}`);
});

test('extractHolders — dividends truthy and mentions 尚未实施过分红', () => {
  const { dividends } = extractHolders(loadLines(), { code: '005827' });
  assert.ok(dividends, 'dividends truthy');
  assert.ok(dividends.includes('尚未实施过分红'), `dividends text: ${dividends}`);
});

test('extractHolders — null-safe on an empty page (never throws)', () => {
  const out = extractHolders([], { code: '000000' });
  assert.equal(out.institutional, null);
  assert.equal(out.retail, null);
  assert.deepEqual(out.insiders, {});
  assert.equal(out.fofHeld, null);
  assert.equal(out.dividends, null);
});
