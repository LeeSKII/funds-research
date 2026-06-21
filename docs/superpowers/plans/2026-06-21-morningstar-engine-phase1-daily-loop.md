# Morningstar Engine · Phase 1 (Daily Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engine's foundation + minimum-viable daily loop: ingest the full market snapshot → diff vs yesterday → screen to candidates → write to store → maintain governance state.

**Architecture:** Hybrid funnel (spec §3.1). Phase 1 = the **API wide/shallow hot path** only: Node calls Layer1 `search/es` with a harvested JWT (CORS is browser-only; Node bypasses it). No browser/MCP in the daily loop except `harvest-token` (run only when the ~14-day JWT nears expiry). 8 modules, single-direction dependency `ingest → store ← analyze`, `core` shared. `analyze/*` are pure functions (zero network). Governance = 4 declarative Markdown artifacts driven by a fire ceremony.

**Tech Stack:** Node v24 (CommonJS, matching the existing prototype scripts), built-in `node:test` (zero-dep testing), global `fetch` (Node 18+, no `node-fetch`), `ajv@8` (only runtime dep — JSON Schema validation of store contracts). JSON config (not YAML — zero-dep; revisit if config grows).

**Scope of THIS plan = spec Phases 1–3.** Phases 4–6 (nav-pull / deep-scrape / attribution / reports / ops-hardening) are separate plans. Phase 1 leaves a working daily loop and a go/no-go gate on the Node→Layer1 feasibility (Task 12).

**Conventions (lock these names — every task uses them):**
- `validate(schemaName, data)` → `{ valid: boolean, errors: string[] }` (`core/validate.js`)
- `loadToken(tokenPath?)` → `{ token, exp, source }` (`core/auth.js`); `isTokenExpired(bundle, skewMs?, now?)` → boolean
- `searchFunds({ token, filter?, fetchImpl?, date? })` → `{ date, source, count, rows[] }` (`core/client.js`); `normalizeRow(raw)` exported
- `loadConfig()` → `{ thresholds, universe }` (`core/config.js`)
- `marketSweep({ offline?, date?, fetchImpl? })` → `{ path, count }` (`ingest/market-sweep.js`)
- `diffSnapshots(prev, curr, date?)` → `{ date, events[] }` (`analyze/diff.js`)
- `screen(snapshot, thresholds)` → `{ rows[] }` (`analyze/screen.js`)
- `runDaily({ offline?, date? })` → `{ date, swept, changes, candidates }` (`orchestrate/run.js`)
- Snapshot row field names come straight from the live API: `id, fundName, rating3Y, rating5Y, return1Year_M, return3Year_M, return5Year_M, alphaToInd_3Y, alphaToIndRankP_3Y, sharpeRatio_3Y, sharpeRatioRankP_3Y, maximumDrawdown_3Y, fundSize, managerName, longestTenure, ter, inceptionDate` (full list in `core/client.js` `normalizeRow`).
- Dates everywhere: `YYYY-MM-DD` (UTC slice of ISO string).

---

## File Structure (locked decomposition)

```
engine/
├── package.json                    # ajv dep + test script
├── .gitignore                      # secrets/ + node_modules/ + regeneratable store outputs
├── README.md                       # 1-paragraph engine overview + how to run daily loop
├── core/
│   ├── client.js                   # Layer1 searchFunds + normalizeRow
│   ├── auth.js                     # loadToken + isTokenExpired
│   ├── validate.js                 # ajv wrapper: validate(name, data)
│   ├── config.js                   # loadConfig (JSON + defaults)
│   ├── schemas/
│   │   ├── snapshot.schema.json
│   │   └── change-event.schema.json
│   └── config/
│       ├── thresholds.json
│       └── universe.json
├── ingest/
│   ├── harvest-token.md            # MCP playbook (authored, not unit-tested)
│   └── market-sweep.js             # searchFunds → store/snapshots/<date>.json
├── store/                          # NOTE: no manifest.json in Phase 1 — run.js derives the snapshot list by readdir; an explicit manifest + funds/<code>/ arrive in Plan 4.
│   ├── snapshots/.gitkeep          # YYYY-MM-DD.json (regeneratable, gitignored)
│   ├── changes/.gitkeep            # YYYY-MM-DD.json
│   └── derived/.gitkeep            # candidates-<date>.json
├── analyze/
│   ├── diff.js                     # pure: prev↔curr → change events
│   └── screen.js                   # pure: snapshot × thresholds → candidates
├── governance/
│   ├── INVARIANTS.md               # static guardrails + research north star
│   ├── LOOP-GUIDE.md               # fire-ceremony protocol
│   ├── MEMORY.md                   # rolling "what we did"
│   └── PLAN.md                     # rolling "what's next"
├── orchestrate/
│   ├── run.js                      # chains market-sweep → diff → screen
│   └── daily.md                    # daily runbook (fire ceremony for daily freq)
└── test/
    ├── fixtures/
    │   └── search-es.sample.json   # real captured search/es body (190 rows, no secrets)
    ├── validate.test.js
    ├── auth.test.js
    ├── client.test.js
    ├── market-sweep.test.js
    ├── diff.test.js
    └── screen.test.js
```

**Responsibility boundaries:** `core` = shared (client/auth/schemas/config/validate). `ingest` = writes store, owns I/O. `analyze` = pure, zero network/IO (reads only what's passed in). `store` = dumb filesystem, no code. `governance` = declarative Markdown. `orchestrate` = the only module allowed to call across layers.

---

## Task 1: Scaffold engine/ structure + package.json

**Files:**
- Create: `engine/package.json`
- Create: `engine/.gitignore`
- Create: `engine/README.md`
- Create: `engine/store/snapshots/.gitkeep`, `engine/store/changes/.gitkeep`, `engine/store/derived/.gitkeep`
- Create: `engine/secrets/.gitkeep` (dir exists, contents gitignored)

- [ ] **Step 1: Create the directory skeleton**

Run:
```bash
mkdir -p engine/core/schemas engine/core/config engine/ingest engine/store/snapshots engine/store/changes engine/store/derived engine/analyze engine/governance engine/orchestrate engine/test/fixtures engine/secrets
touch engine/store/snapshots/.gitkeep engine/store/changes/.gitkeep engine/store/derived/.gitkeep engine/secrets/.gitkeep
```

- [ ] **Step 2: Write `engine/package.json`**

```json
{
  "name": "funds-research-engine",
  "version": "0.1.0",
  "private": true,
  "description": "Morningstar fund research automation engine (daily loop)",
  "scripts": {
    "test": "node --test test/",
    "daily": "node orchestrate/run.js",
    "daily:offline": "node orchestrate/run.js --offline"
  },
  "dependencies": {
    "ajv": "^8.17.1"
  }
}
```

- [ ] **Step 3: Write `engine/.gitignore`**

```gitignore
# 🔴 secrets — harvested JWT tokens. NEVER commit.
secrets/*
!secrets/.gitkeep

node_modules/

# store outputs are regeneratable machine data (persisted on disk = 落库; not git-tracked).
# If long-term archival in git is later required, revisit (spec §15).
store/snapshots/*
store/changes/*
store/derived/*
!store/snapshots/.gitkeep
!store/changes/.gitkeep
!store/derived/.gitkeep
```

- [ ] **Step 4: Write `engine/README.md`**

````markdown
# engine/ — Morningstar fund research automation

Phase 1 = daily loop. See `docs/superpowers/specs/2026-06-20-morningstar-engine-design.md` for design.

## Run the daily loop (offline, no token needed)
```bash
cd engine
npm install
npm run daily:offline
```

## Run live (needs a harvested token)
1. Follow `ingest/harvest-token.md` to populate `secrets/token.json`.
2. `npm run daily`
````

- [ ] **Step 5: Install deps + verify Node test runner works**

Run:
```bash
cd engine && npm install && node --test 2>&1 | head -5
```
Expected: `npm install` pulls `ajv`; `node --test` reports `tests 0` / `pass 0` (no tests yet) with no error.

- [ ] **Step 6: Commit**

```bash
git add engine/package.json engine/.gitignore engine/README.md engine/store engine/secrets/.gitkeep
git add engine/package-lock.json 2>/dev/null || true   # only if npm install created it
git commit -m "feat(engine): scaffold Phase 1 structure + ajv dep"
```

---

## Task 2: snapshot schema + change-event schema + validate.js

**Files:**
- Create: `engine/core/validate.js`
- Create: `engine/core/schemas/snapshot.schema.json`
- Create: `engine/core/schemas/change-event.schema.json`
- Test: `engine/test/validate.test.js`

- [ ] **Step 1: Write the failing test**

`engine/test/validate.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../core/validate');

test('snapshot schema accepts a valid snapshot', () => {
  const snap = {
    date: '2026-06-21', source: 'morningstar:search/es', count: 1,
    rows: [{ id: '005161', fundName: '华商上游产业股票A', rating3Y: 5, rating5Y: 5, managerName: '某经理' }],
  };
  const r = validate('snapshot', snap);
  assert.equal(r.valid, true, r.errors.join('; '));
});

test('snapshot schema rejects a 5-digit id and out-of-range rating', () => {
  const snap = {
    date: '2026-06-21', source: 'x', count: 1,
    rows: [{ id: '12345', fundName: 'bad', rating3Y: 9, managerName: 'm' }],
  };
  const r = validate('snapshot', snap);
  assert.equal(r.valid, false);
  assert.ok(r.errors.length >= 1);
});

test('change-event schema accepts new_fund + rating_change', () => {
  const ce = { date: '2026-06-21', events: [
    { code: '005161', fundName: 'x', type: 'new_fund', field: null, before: null, after: null },
    { code: '006502', fundName: 'y', type: 'rating_change', field: 'rating3Y', before: 5, after: 4 },
  ] };
  assert.equal(validate('change-event', ce).valid, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && node --test test/validate.test.js`
Expected: FAIL — `Cannot find module '../core/validate'`.

- [ ] **Step 3: Write `engine/core/schemas/snapshot.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DailyMarketSnapshot",
  "type": "object",
  "required": ["date", "source", "count", "rows"],
  "properties": {
    "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "source": { "type": "string", "minLength": 1 },
    "count": { "type": "integer", "minimum": 0 },
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "fundName", "rating3Y", "managerName"],
        "properties": {
          "id": { "type": "string", "pattern": "^\\d{6}$" },
          "fundName": { "type": ["string", "null"] },
          "categoryName": { "type": ["string", "null"] },
          "broadCategoryNameCN": { "type": ["string", "null"] },
          "styleBox": { "type": ["string", "null"] },
          "rating3Y": { "type": ["integer", "null"], "minimum": 1, "maximum": 5 },
          "rating5Y": { "type": ["integer", "null"], "minimum": 1, "maximum": 5 },
          "returnYTD_M": { "type": ["number", "null"] },
          "return1Year_M": { "type": ["number", "null"] },
          "return3Year_M": { "type": ["number", "null"] },
          "return5Year_M": { "type": ["number", "null"] },
          "return10Year_M": { "type": ["number", "null"] },
          "alphaToIndRankP_1Y": { "type": ["number", "null"] },
          "alphaToIndRankP_3Y": { "type": ["number", "null"] },
          "alphaToInd_3Y": { "type": ["number", "null"] },
          "sharpeRatio_3Y": { "type": ["number", "null"] },
          "sharpeRatioRankP_3Y": { "type": ["number", "null"] },
          "maximumDrawdown_3Y": { "type": ["number", "null"] },
          "fundSize": { "type": ["number", "null"], "minimum": 0 },
          "top10Holding": { "type": ["number", "null"] },
          "longestTenure": { "type": ["number", "null"], "minimum": 0 },
          "ter": { "type": ["number", "null"] },
          "managementFee": { "type": ["number", "null"] },
          "managerName": { "type": ["string", "null"] },
          "inceptionDate": { "type": ["string", "null"] }
        },
        "additionalProperties": true
      }
    }
  }
}
```

- [ ] **Step 4: Write `engine/core/schemas/change-event.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ChangeEvents",
  "type": "object",
  "required": ["date", "events"],
  "properties": {
    "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "type"],
        "properties": {
          "code": { "type": "string", "pattern": "^\\d{6}$" },
          "fundName": { "type": ["string", "null"] },
          "type": { "enum": ["rating_change", "manager_change", "new_fund", "removed"] },
          "field": { "type": ["string", "null"] },
          "before": {},
          "after": {}
        }
      }
    }
  }
}
```

- [ ] **Step 5: Write `engine/core/validate.js`**

```js
// core/validate.js — JSON Schema validation wrapper (ajv)
// Single entry point so every store write is contract-checked.
const path = require('path');
const fs = require('fs');
const Ajv = require('ajv');

const SCHEMA_DIR = path.join(__dirname, 'schemas');
const _cache = new Map();

function _compile(schemaName) {
  if (_cache.has(schemaName)) return _cache.get(schemaName);
  const file = path.join(SCHEMA_DIR, `${schemaName}.schema.json`);
  if (!fs.existsSync(file)) throw new Error(`[validate] unknown schema: ${schemaName}`);
  const schema = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const fn = ajv.compile(schema);
  _cache.set(schemaName, fn);
  return fn;
}

/**
 * Validate data against a named schema in core/schemas/.
 * @param {string} schemaName  e.g. 'snapshot', 'change-event'
 * @param {*} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(schemaName, data) {
  const fn = _compile(schemaName);
  const valid = fn(data);
  return { valid, errors: valid ? [] : fn.errors.map(e => `${e.instancePath || '/'} ${e.message}`) };
}

module.exports = { validate };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd engine && node --test test/validate.test.js`
Expected: PASS — `tests 3` / `pass 3`.

- [ ] **Step 7: Commit**

```bash
git add engine/core/validate.js engine/core/schemas engine/test/validate.test.js
git commit -m "feat(engine): snapshot + change-event schemas + ajv validate wrapper"
```

---

## Task 3: auth.js (token load + expiry)

**Files:**
- Create: `engine/core/auth.js`
- Test: `engine/test/auth.test.js`

- [ ] **Step 1: Write the failing test**

`engine/test/auth.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadToken, isTokenExpired } = require('../core/auth');

function tmpBundle(obj) {
  const p = path.join(os.tmpdir(), `tok-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('loadToken throws when file missing', () => {
  assert.throws(() => loadToken('/nope/missing.json'), /token file not found/);
});

test('loadToken reads token + exp', () => {
  const p = tmpBundle({ token: 'abc.def.ghi', exp: 1800000000, source: 'localStorage' });
  const t = loadToken(p);
  assert.equal(t.token, 'abc.def.ghi');
  assert.equal(t.exp, 1800000000);
  fs.unlinkSync(p);
});

test('isTokenExpired true when now past exp', () => {
  const bundle = { token: 'x', exp: 1000 }; // exp=1000s (epoch seconds)
  assert.equal(isTokenExpired(bundle, 0, 2_000_000), true); // now(ms) well past 1000s
});

test('isTokenExpired false when token fresh', () => {
  const bundle = { token: 'x', exp: 9999999999 }; // far future (seconds)
  assert.equal(isTokenExpired(bundle, 0, Date.now()), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && node --test test/auth.test.js`
Expected: FAIL — `Cannot find module '../core/auth'`.

- [ ] **Step 3: Write `engine/core/auth.js`**

```js
// core/auth.js — load harvested JWT + check expiry.
// Layer1 token is a stateless RS256 JWT (~14d). Node uses it directly (no session).
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '..', 'secrets', 'token.json');

/**
 * Load token bundle from secrets/token.json.
 * @param {string} [tokenPath]
 * @returns {{ token: string, exp: number|null, source: string }}
 * @throws if file missing or no .token field
 */
function loadToken(tokenPath = TOKEN_PATH) {
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`[auth] token file not found: ${tokenPath} — run ingest/harvest-token.md first`);
  }
  const bundle = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  if (!bundle || !bundle.token) throw new Error('[auth] token.json has no .token field');
  return { token: bundle.token, exp: bundle.exp ?? null, source: bundle.source ?? 'unknown' };
}

function _decodeExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf-8'));
    return payload.exp ? payload.exp * 1000 : null; // → ms
  } catch { return null; }
}

/**
 * @param {{ token: string, exp?: number|null }} bundle
 * @param {number} [skewMs=60000] treat as expired this far before true expiry
 * @param {number} [now=Date.now()]
 */
function isTokenExpired(bundle, skewMs = 60_000, now = Date.now()) {
  // bundle.exp may be epoch-seconds (raw JWT) or ms; normalize
  const raw = bundle.exp ?? _decodeExp(bundle.token);
  if (!raw) return false; // unknown exp → assume valid, let the API reject if stale
  const expMs = raw > 1e12 ? raw : raw * 1000;
  return now >= (expMs - skewMs);
}

module.exports = { loadToken, isTokenExpired, TOKEN_PATH };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && node --test test/auth.test.js`
Expected: PASS — `tests 4` / `pass 4`.

- [ ] **Step 5: Commit**

```bash
git add engine/core/auth.js engine/test/auth.test.js
git commit -m "feat(engine): auth.js — token load + JWT expiry check"
```

---

## Task 4: client.js (Layer1 searchFunds, injectable fetch)

**Files:**
- Create: `engine/core/client.js`
- Create: `engine/test/fixtures/search-es.sample.json` (real captured body)
- Test: `engine/test/client.test.js`

- [ ] **Step 1: Build the fixture from the live capture**

**Run from the repo root (`C:/Lee/Projects/funds-research`), NOT from `engine/`** — both paths below are repo-root-relative. Copies the real captured search/es response into the fixture; it is pure fund data, no tokens. NOTE: this fixture is a **filtered 3y-5★ sample** — all 190 rows have `rating3Y===5` and it omits the defensive ETFs (518880/512890); fine for plumbing tests, NOT representative of the full market (see Task 12 probe).
```bash
# (source was the prototype api-harvest, since removed; the fixture is already committed at:)
#    engine/test/fixtures/search-es.sample.json
node -e 'const j=require("./engine/test/fixtures/search-es.sample.json"); console.log("rows:", j.data.rows.length, "| first id:", j.data.rows[0].id)'
```
Expected: `rows: 190 | first id: 004320`.

- [ ] **Step 2: Write the failing test**

`engine/test/client.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { searchFunds, normalizeRow } = require('../core/client');

const captured = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'search-es.sample.json'), 'utf-8'));

function fakeFetchOk(capturedBody) {
  return async () => ({ ok: true, status: 200, json: async () => capturedBody });
}

test('normalizeRow coerces numeric strings and keeps nulls', () => {
  const r = normalizeRow({ id: '005161', fundName: 'X', rating3Y: '5', return1Year_M: '12.5', managerName: 'm', missing: undefined });
  assert.equal(r.id, '005161');
  assert.equal(r.rating3Y, 5);
  assert.equal(r.return1Year_M, 12.5);
});

test('searchFunds returns normalized snapshot from injected fetch', async () => {
  // NOTE: the real fixture carries response_status as a STRING "200011" — this test
  // locks the String()-based guard in client.js (regression guard for the blocker).
  const snap = await searchFunds({ token: 'fake.jwt.token', fetchImpl: fakeFetchOk(captured), date: '2026-06-21' });
  assert.equal(snap.date, '2026-06-21');
  assert.equal(snap.count, 190);
  assert.equal(snap.rows[0].id.length, 6);
  assert.equal(typeof snap.rows[0].rating3Y === 'number' || snap.rows[0].rating3Y === null, true);
});

test('searchFunds throws on bad response_status', async () => {
  const bad = { _meta: { response_status: '401', response_hint: 'no token' }, data: { rows: [] } };
  await assert.rejects(() => searchFunds({ token: 'x', fetchImpl: fakeFetchOk(bad) }), /bad status/);
});

test('searchFunds throws on HTTP error', async () => {
  const fail = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => searchFunds({ token: 'x', fetchImpl: fail }), /HTTP 500/);
});

test('searchFunds retries once on HTTP 429 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return calls === 1
      ? { ok: false, status: 429, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => captured };
  };
  const snap = await searchFunds({ token: 'x', fetchImpl, date: '2026-06-21' });
  assert.equal(calls, 2);       // retried exactly once
  assert.equal(snap.count, 190); // waits ~500ms for backoff; acceptable for one test
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd engine && node --test test/client.test.js`
Expected: FAIL — `Cannot find module '../core/client'`.

- [ ] **Step 4: Write `engine/core/client.js`**

```js
// core/client.js — morningstar Layer1 API client.
// Layer1 = /cn-api/v2/* (token-only RS256 JWT). Node-side calls bypass browser CORS.
const BASE = 'https://www.morningstar.cn';

const NUM_FIELDS = [
  'rating3Y', 'rating5Y', 'returnYTD_M', 'return1Year_M', 'return3Year_M', 'return5Year_M', 'return10Year_M',
  'alphaToIndRankP_1Y', 'alphaToIndRankP_3Y', 'alphaToInd_3Y', 'sharpeRatio_3Y', 'sharpeRatioRankP_3Y',
  'maximumDrawdown_3Y', 'fundSize', 'top10Holding', 'longestTenure', 'ter', 'managementFee',
];
const STR_FIELDS = ['fundName', 'categoryName', 'broadCategoryNameCN', 'styleBox', 'managerName', 'inceptionDate'];

/** Coerce a raw API row (object keyed by column name) into a typed snapshot row. */
function normalizeRow(raw) {
  const num = v => (v === null || v === undefined || v === '') ? null : (typeof v === 'number' ? v : Number(v));
  const out = { id: String(raw.id) };
  for (const f of NUM_FIELDS) out[f] = num(raw[f]);
  for (const f of STR_FIELDS) out[f] = raw[f] ?? null;
  return out;
}

/**
 * POST /cn-api/v2/search/es → normalized snapshot.
 * @param {object} opts
 * @param {string} opts.token
 * @param {object} [opts.filter] request body (default { sign:'1' } = broad market)
 * @param {typeof fetch} [opts.fetchImpl] injectable; defaults to globalThis.fetch
 * @param {string} [opts.date] YYYY-MM-DD (default: today UTC)
 * @returns {Promise<{ date: string, source: string, count: number, rows: object[] }>}
 */
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function _doSearchEs(fetcher, url, token, filter) {
  return fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': token, 'Accept': 'application/json' },
    body: JSON.stringify(filter),
  });
}

/**
 * POST /cn-api/v2/search/es → normalized snapshot.
 * - Retries once on HTTP 429 (rate limit, spec §11) with a short backoff.
 * - `response_status` arrives as a STRING ("200011") — compare as string, NOT `!== 200011`.
 * @param {object} opts
 * @param {string} opts.token
 * @param {object} [opts.filter] request body (default { sign:'1' } = broad market — VERIFY in Task 12)
 * @param {typeof fetch} [opts.fetchImpl] injectable; defaults to globalThis.fetch
 * @param {string} [opts.date] YYYY-MM-DD (default: today UTC)
 * @returns {Promise<{ date: string, source: string, count: number, rows: object[] }>}
 */
async function searchFunds({ token, filter = { sign: '1' }, fetchImpl, date }) {
  const fetcher = fetchImpl || globalThis.fetch;
  if (!fetcher) throw new Error('[client] no fetch available (Node < 18?)');
  const url = `${BASE}/cn-api/v2/search/es?source=local`;

  let res = await _doSearchEs(fetcher, url, token, filter);
  if (res.status === 429) { // rate limit: back off once and retry
    await _sleep(500);
    res = await _doSearchEs(fetcher, url, token, filter);
  }
  if (!res.ok) throw new Error(`[client] search/es HTTP ${res.status}`);
  const json = await res.json();
  if (String(json?._meta?.response_status) !== '200011') { // API returns status as a STRING
    throw new Error(`[client] search/es bad status: ${json?._meta?.response_status} (${json?._meta?.response_hint})`);
  }
  const rows = (json.data?.rows || []).map(normalizeRow);
  return { date: date || new Date().toISOString().slice(0, 10), source: 'morningstar:search/es', count: rows.length, rows };
}

module.exports = { searchFunds, normalizeRow };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd engine && node --test test/client.test.js`
Expected: PASS — `tests 5` / `pass 5` (incl. the string-status success guard + 429 retry).

- [ ] **Step 6: Commit**

```bash
git add engine/core/client.js engine/test/client.test.js engine/test/fixtures/search-es.sample.json
git commit -m "feat(engine): client.js — Layer1 searchFunds + normalizeRow"
```

---

## Task 5: config.js + config JSONs

**Files:**
- Create: `engine/core/config.js`
- Create: `engine/core/config/thresholds.json`
- Create: `engine/core/config/universe.json`
- Test: `engine/test/config.test.js`

- [ ] **Step 1: Write the failing test**

`engine/test/config.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, DEFAULT_THRESHOLDS } = require('../core/config');

test('loadConfig returns thresholds merged with defaults', () => {
  const { thresholds } = loadConfig();
  assert.equal(thresholds.rating3Y_min, 4);
  assert.equal(typeof thresholds.fundSize_max_yi, 'number');
});

test('loadConfig returns universe with a search_filter', () => {
  const { universe } = loadConfig();
  assert.ok(universe.search_filter);
  assert.ok(Array.isArray(universe.watchlist));
});

test('DEFAULT_THRESHOLDS has all screen keys', () => {
  for (const k of ['rating3Y_min', 'rating5Y_min', 'longestTenure_min_years', 'fundSize_min_yi', 'fundSize_max_yi', 'alphaToIndRankP_3Y_max', 'sharpeRatioRankP_3Y_max']) {
    assert.ok(k in DEFAULT_THRESHOLDS, `missing ${k}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../core/config'`.

- [ ] **Step 3: Write config JSONs**

`engine/core/config/thresholds.json`:
```json
{
  "rating3Y_min": 4,
  "rating5Y_min": 4,
  "longestTenure_min_years": 3,
  "fundSize_min_yi": 2,
  "fundSize_max_yi": 200,
  "alphaToIndRankP_3Y_max": 0.5,
  "sharpeRatioRankP_3Y_max": 0.5
}
```

`engine/core/config/universe.json`:
```json
{
  "search_filter": { "sign": "1" },
  "watchlist": ["005161", "006502", "001048", "518880", "512890"]
}
```

- [ ] **Step 4: Write `engine/core/config.js`**

```js
// core/config.js — load JSON configs, merged over defaults.
// JSON (not YAML) to stay zero-dep; revisit if config grows (spec §15).
const fs = require('fs');
const path = require('path');
const CONFIG_DIR = path.join(__dirname, 'config');

const DEFAULT_THRESHOLDS = {
  rating3Y_min: 4,
  rating5Y_min: 4,
  longestTenure_min_years: 3,
  fundSize_min_yi: 2,
  fundSize_max_yi: 200,
  alphaToIndRankP_3Y_max: 0.5,
  sharpeRatioRankP_3Y_max: 0.5,
};
const DEFAULT_UNIVERSE = { search_filter: { sign: '1' }, watchlist: [] };

function _read(name, fallback) {
  const file = path.join(CONFIG_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return { ...fallback };
  return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf-8')) };
}

function loadConfig() {
  return { thresholds: _read('thresholds', DEFAULT_THRESHOLDS), universe: _read('universe', DEFAULT_UNIVERSE) };
}

module.exports = { loadConfig, DEFAULT_THRESHOLDS, DEFAULT_UNIVERSE };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd engine && node --test test/config.test.js`
Expected: PASS — `tests 3` / `pass 3`.

- [ ] **Step 6: Commit**

```bash
git add engine/core/config.js engine/core/config engine/test/config.test.js
git commit -m "feat(engine): config.js + thresholds/universe JSON"
```

---

## Task 6: ingest/market-sweep.js (offline-capable)

**Files:**
- Create: `engine/ingest/market-sweep.js`
- Test: `engine/test/market-sweep.test.js`

- [ ] **Step 1: Write the failing test**

`engine/test/market-sweep.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { marketSweep } = require('../ingest/market-sweep');

test('offline marketSweep writes a schema-valid snapshot', async () => {
  const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  // point the module's SNAP_DIR at the temp dir via env override
  process.env.ENGINE_STORE_DIR = tmpStore;
  const { count, path: outPath } = await marketSweep({ offline: true, date: '2026-06-21' });
  assert.ok(count > 0);
  assert.match(outPath, /2026-06-21\.json$/);
  const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  assert.equal(written.date, '2026-06-21');
  assert.equal(written.count, count);
  delete process.env.ENGINE_STORE_DIR;
  fs.rmSync(tmpStore, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && node --test test/market-sweep.test.js`
Expected: FAIL — `Cannot find module '../ingest/market-sweep'`.

- [ ] **Step 3: Write `engine/ingest/market-sweep.js`**

```js
// ingest/market-sweep.js — search/es full market → store/snapshots/<date>.json
const fs = require('fs');
const path = require('path');
const { searchFunds, normalizeRow } = require('../core/client');
const { loadToken } = require('../core/auth');
const { loadConfig } = require('../core/config');
const { validate } = require('../core/validate');

function _storeDir() {
  return process.env.ENGINE_STORE_DIR || path.join(__dirname, '..', 'store');
}
const FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'search-es.sample.json');

/**
 * @param {object} [opts]
 * @param {boolean} [opts.offline=false]  read fixture instead of hitting the API
 * @param {string} [opts.date]            YYYY-MM-DD (default today UTC)
 * @param {typeof fetch} [opts.fetchImpl] injected into searchFunds (tests)
 * @returns {Promise<{ path: string, count: number }>}
 */
async function marketSweep(opts = {}) {
  const { offline = false, date, fetchImpl } = opts;
  const day = date || new Date().toISOString().slice(0, 10);

  let snapshot;
  if (offline) {
    const captured = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
    const rows = (captured.data?.rows || []).map(normalizeRow);
    snapshot = { date: day, source: 'fixture:search-es', count: rows.length, rows };
  } else {
    const { token } = loadToken();
    const { universe } = loadConfig();
    snapshot = await searchFunds({ token, filter: universe.search_filter, fetchImpl, date: day });
  }

  const v = validate('snapshot', snapshot);
  if (!v.valid) throw new Error(`[market-sweep] snapshot failed schema:\n  - ${v.errors.join('\n  - ')}`);
  if (snapshot.count === 0) {
    // spec §11: a 0-row response is never "no funds today" — it's a rate limit or 改版.
    // Refuse to write an empty snapshot so diff/screen don't silently run on a void market.
    throw new Error('[market-sweep] search/es returned 0 rows — suspected rate limit or API change; refusing empty snapshot');
  }

  const snapDir = path.join(_storeDir(), 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  const outPath = path.join(snapDir, `${day}.json`);
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmp, outPath); // atomic write
  return { path: outPath, count: snapshot.count };
}

module.exports = { marketSweep };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && node --test test/market-sweep.test.js`
Expected: PASS — `tests 1` / `pass 1`.

- [ ] **Step 5: Commit**

```bash
git add engine/ingest/market-sweep.js engine/test/market-sweep.test.js
git commit -m "feat(engine): market-sweep.js — offline-capable ingest → snapshot"
```

---

## Task 7: analyze/diff.js (pure)

**Files:**
- Create: `engine/analyze/diff.js`
- Test: `engine/test/diff.test.js`

- [ ] **Step 1: Write the failing test**

`engine/test/diff.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffSnapshots } = require('../analyze/diff');

const mk = rows => ({ rows });
const fund = (id, over = {}) => ({ id, fundName: `F${id}`, rating3Y: 5, rating5Y: 5, managerName: 'M1', ...over });

test('detects new fund', () => {
  const e = diffSnapshots(mk([]), mk([fund('005161')]), '2026-06-21').events;
  assert.equal(e.find(x => x.type === 'new_fund').code, '005161');
});

test('detects removed fund', () => {
  const e = diffSnapshots(mk([fund('005161')]), mk([]), '2026-06-21').events;
  assert.equal(e.find(x => x.type === 'removed').code, '005161');
});

test('detects rating drop 5→4', () => {
  const e = diffSnapshots(mk([fund('006502')]), mk([fund('006502', { rating3Y: 4 })]), '2026-06-21').events;
  const rc = e.find(x => x.type === 'rating_change');
  assert.equal(rc.field, 'rating3Y');
  assert.equal(rc.before, 5);
  assert.equal(rc.after, 4);
});

test('detects manager change', () => {
  const e = diffSnapshots(mk([fund('001048')]), mk([fund('001048', { managerName: 'M2' })]), '2026-06-21').events;
  assert.equal(e.find(x => x.type === 'manager_change').after, 'M2');
});

test('unchanged funds produce no events', () => {
  const e = diffSnapshots(mk([fund('005161')]), mk([fund('005161')]), '2026-06-21').events;
  assert.equal(e.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && node --test test/diff.test.js`
Expected: FAIL — `Cannot find module '../analyze/diff'`.

- [ ] **Step 3: Write `engine/analyze/diff.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && node --test test/diff.test.js`
Expected: PASS — `tests 5` / `pass 5`.

- [ ] **Step 5: Commit**

```bash
git add engine/analyze/diff.js engine/test/diff.test.js
git commit -m "feat(engine): diff.js — pure snapshot diff → change events"
```

---

## Task 8: analyze/screen.js (pure)

**Files:**
- Create: `engine/analyze/screen.js`
- Test: `engine/test/screen.test.js`

- [ ] **Step 1: Write the failing test**

`engine/test/screen.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { screen } = require('../analyze/screen');
const { DEFAULT_THRESHOLDS } = require('../core/config');

const fund = (id, over = {}) => ({ id, fundName: `F${id}`, rating3Y: 5, rating5Y: 5, longestTenure: 5, fundSize: 50, alphaToIndRankP_3Y: 0.1, sharpeRatioRankP_3Y: 0.1, ...over });
const snap = rows => ({ rows });

test('passes a fund meeting all thresholds', () => {
  const out = screen(snap([fund('005161')]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 1);
});

test('rejects low rating3Y', () => {
  const out = screen(snap([fund('005161', { rating3Y: 3 })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 0);
});

test('rejects short tenure', () => {
  const out = screen(snap([fund('005161', { longestTenure: 1 })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 0);
});

test('rejects too-small fund size', () => {
  const out = screen(snap([fund('005161', { fundSize: 0.5 })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 0);
});

test('null rating5Y does not disqualify (data not yet available)', () => {
  const out = screen(snap([fund('005161', { rating5Y: null })]), DEFAULT_THRESHOLDS);
  assert.equal(out.rows.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && node --test test/screen.test.js`
Expected: FAIL — `Cannot find module '../analyze/screen'`.

- [ ] **Step 3: Write `engine/analyze/screen.js`**

```js
// analyze/screen.js — pure: snapshot × thresholds → candidate rows.
// A null in a percentile/rank field is treated as "unknown → don't disqualify"
// (data may not yet exist for newer funds). Required fields (rating3Y, tenure, size) are hard gates.
const BETWEEN = (v, lo, hi) => v !== null && v !== undefined && v >= lo && v <= hi;

/**
 * @param {{ rows: object[] }} snapshot
 * @param {object} t thresholds (see config/thresholds.json)
 * @returns {{ rows: object[] }}
 */
function screen(snapshot, t) {
  const pass = r =>
    r.rating3Y !== null && r.rating3Y >= t.rating3Y_min &&
    (r.rating5Y === null || r.rating5Y >= t.rating5Y_min) &&
    r.longestTenure !== null && r.longestTenure >= t.longestTenure_min_years &&
    BETWEEN(r.fundSize, t.fundSize_min_yi, t.fundSize_max_yi) &&
    (r.alphaToIndRankP_3Y === null || r.alphaToIndRankP_3Y <= t.alphaToIndRankP_3Y_max) &&
    (r.sharpeRatioRankP_3Y === null || r.sharpeRatioRankP_3Y <= t.sharpeRatioRankP_3Y_max);
  return { rows: snapshot.rows.filter(pass) };
}

module.exports = { screen };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && node --test test/screen.test.js`
Expected: PASS — `tests 5` / `pass 5`.

- [ ] **Step 5: Commit**

```bash
git add engine/analyze/screen.js engine/test/screen.test.js
git commit -m "feat(engine): screen.js — pure threshold screen → candidates"
```

---

## Task 9: governance artifacts (4 declarative Markdown files)

**Files:**
- Create: `engine/governance/INVARIANTS.md`
- Create: `engine/governance/LOOP-GUIDE.md`
- Create: `engine/governance/MEMORY.md`
- Create: `engine/governance/PLAN.md`

(No unit tests — these are declarative. Verification = content review + that later tasks reference them.)

- [ ] **Step 1: Write `engine/governance/INVARIANTS.md`**

```markdown
# INVARIANTS — what must never change (static, rarely edited)

> Read at the START of every fire. If any invariant is violated, STOP and surface to the user.

## (a) Machine guardrails — enforced, non-negotiable
- **No hallucinated data.** Missing field → `null` + warning. Never invent a number.
- **Every store write is schema-validated.** `validate(name, data).valid === false` ⇒ reject the write.
- **Atomic writes.** Temp file + rename. No half-written store artifacts.
- **Idempotent fires.** Same date re-run yields identical output (snapshot keyed by date; diff is deterministic).
- **Tokens never enter git.** `secrets/` is gitignored. Never echo a token value in logs/output.
- **BOUND-1: research only, no trades.** This system produces analysis + reports. It never emits trade orders.
- **Diff guard.** If today's snapshot is byte-identical to yesterday's (suspicious SPA cache or API hiccup), flag and do not silently treat as "no changes" — re-sweep.

## (b) Research north star — what "good" looks like
- Target long-run portfolio Sharpe ≈ 0.40–0.47 (per 8y/10y backtest; NOT the Markowitz arithmetic 0.55).
- Prefer **true alpha** (high stock-selection share in Brinson) over industry-beta pseudo-alpha.
- Defensive layer = smart-beta ETFs (gold 518880 / dividend-low-vol 512890 / quant-multi-factor), because 5y-5★ set has ~0 defensive funds.
- Rebalance every ~3 years (backtest optimum; not annual).
- Manager tenure > 3y preferred (manager-change risk).

## Scope of Phase 1
Daily loop only: snapshot → diff → screen → store → governance. No nav-pull, deep-scrape, attribution, or reports yet (Plans 2–4).
```

- [ ] **Step 2: Write `engine/governance/LOOP-GUIDE.md`**

```markdown
# LOOP-GUIDE — how to execute one fire (static protocol)

> This is the procedure for every fire (daily/weekly/monthly). Follow in order.

## Fire ceremony
1. **Orient.** Read `INVARIANTS.md` → `LOOP-GUIDE.md` (this file) → `MEMORY.md` → `PLAN.md`.
2. **Pick work.** Take the top item(s) of `PLAN.md`. If running a scheduled fire (daily), execute the matching runbook (`orchestrate/daily.md`).
3. **Execute, checking invariants at each step.** After each store write, confirm schema validity. After each sweep, confirm the diff is not byte-identical to the prior day.
4. **Finish.**
   - Append a dated entry to `MEMORY.md` (what ran, counts, any warnings/anomalies).
   - Update `PLAN.md` (mark done, surface new work — e.g. "new candidate 00XXXX appeared, needs deep-scrape in Plan 2").
   - Log run to `store/logs/` (or stdout in Phase 1).

## Failure handling (do not silently swallow)
- Token 401/expired → run `harvest-token.md`; if re-login impossible → postpone fire + warn user.
- search/es empty or status ≠ 200011 → retry once; persistent → warn, do NOT write a garbage snapshot.
- Schema validation fails → reject write + **abort the fire** (hard stop; CLI exits 1). Prior good artifacts stay intact. A 0-row response is treated the same way.

## What a fire does NOT do
- Does not edit a generated store artifact by hand (regenerate from source instead).
- Does not skip validation to "get it working."
- Does not commit `secrets/`.
```

- [ ] **Step 3: Write `engine/governance/MEMORY.md` (seed)**

```markdown
# MEMORY — rolling "what we've done" (append at end of each fire)

> Newest at the bottom. One block per fire.

## 2026-06-21 — Phase 1 bootstrap
- Engine scaffolded (8 modules, ajv, node:test). Daily loop not yet run live.
- Pending: Task 12 live gate (verify Node→Layer1 works with harvested JWT).
```

- [ ] **Step 4: Write `engine/governance/PLAN.md` (seed)**

```markdown
# PLAN — rolling "what's next" (update at end of each fire)

> Top item = next to do.

- [ ] **Task 12 (this plan):** live gate — harvest token, run daily loop live, confirm real snapshot lands. Go/no-go on Node→Layer1.
- [ ] **Plan 2 (Phase 4):** nav-pull (growth-data) + deep-scrape (browser) + attribution (Brinson). Blocked on Plan 1 done.
- [ ] **Plan 3 (Phase 5):** research-report.js (Markdown + PDF).
- [ ] **Plan 4 (Phase 6):** ops hardening (retry-queue, state, error coverage, live smoke harness).
```

- [ ] **Step 5: Commit**

```bash
git add engine/governance
git commit -m "feat(engine): governance — INVARIANTS + LOOP-GUIDE + MEMORY + PLAN"
```

---

## Task 10: ingest/harvest-token.md (MCP playbook)

**Files:**
- Create: `engine/ingest/harvest-token.md`

(No unit test — MCP/browser component. Verification = Task 12 live gate actually uses it.)

- [ ] **Step 1: Write `engine/ingest/harvest-token.md`**

````markdown
# harvest-token — chrome-devtools MCP playbook

> **These are chrome-devtools MCP tool invocations executed by Claude** (the IDs below are the literal tool names), NOT Node calls or CLI commands. Run only when `core/auth.js` reports the token missing/expired (~14-day JWT). This is the **only** MCP step in the daily path.

> 🔴 **SPA hash pitfall (from CLAUDE.md):** morningstar.cn uses hash routing; the browser can serve a cached SPA state. Before loading a morningstar page, call `__navigate_page` to `about:blank` FIRST, then to the target URL, so Vue/React re-mounts and fetches fresh data (otherwise you read the previous page's state).

## Why MCP, not Node
The token lives in the browser session (localStorage or a request header). chrome-devtools MCP drives the real logged-in Chrome; Node cannot read browser state.

## Steps

1. **Open a logged-in session.**
   - `mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page` → `{type:"url", url:"https://www.morningstar.cn/#/screener"}`.
   - Confirm login via `mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot` (private data renders). If logged out → STOP, ask the user to log in.

2. **Read the token from localStorage.**
   - `mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script` with `function` = an arrow-function declaration (NOT arbitrary JS — the tool compiles the function body):
     ```js
     () => ({
       lsToken: localStorage.getItem('token'),
       lsKeys: Object.keys(localStorage).filter(k => /token|auth|jwt/i.test(k)),
     })
     ```
   - If `lsToken` is a 3-dot JWT (`xxx.yyy.zzz`) → `source = "localStorage"`, capture it.

3. **Fallback — read the token from a request header** (if localStorage has none).
   - Trigger a search in the page (or `__navigate_page` reload), then `mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_network_requests` with `resourceTypes:["fetch","xhr"]`.
   - Find the `POST /cn-api/v2/search/es` request; note its `reqid`.
   - `mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_network_request` with that `reqid` → read the `token` request header from the returned request object. `source = "header"`.

4. **Decode expiry** (to know when to re-harvest). `__evaluate_script`:
   ```js
   () => { try { const p = JSON.parse(atob(localStorage.getItem('token').split('.')[1])); return { exp: p.exp, iat: p.iat }; } catch (e) { return { error: String(e) }; } }
   ```
   (`exp`/`iat` are epoch-seconds if present.)

5. **Write `engine/secrets/token.json`** atomically (temp + rename). Shape:
   ```json
   { "token": "<jwt>", "exp": <epoch-seconds|null>, "source": "localStorage|header", "harvestedAt": "<ISO 8601>" }
   ```

6. **Verify** (Node, from `engine/`): `node -e "const {loadToken,isTokenExpired}=require('./core/auth'); const t=loadToken(); console.log('expired?', isTokenExpired(t))"` → expect `expired? false`.

7. **SECURITY.** Never print the token value in any output/log. Confirm `engine/.gitignore` excludes `secrets/*` (it does). `secrets/token.json` is local-only.

## When it fails
- No JWT anywhere + not logged in → ask the user to log in, then retry.
- Token present but every Node API call 401s → token may be IP/session-bound; record in MEMORY and escalate (Layer1-via-Node assumption violated — see Task 12 go/no-go).
````

- [ ] **Step 2: Commit**

```bash
git add engine/ingest/harvest-token.md
git commit -m "feat(engine): harvest-token MCP playbook"
```

---

## Task 11: orchestrate/run.js + daily.md runbook

**Files:**
- Create: `engine/orchestrate/run.js`
- Create: `engine/orchestrate/daily.md`
- Test: `engine/test/run.test.js`

- [ ] **Step 1: Write the failing integration test (offline end-to-end)**

`engine/test/run.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDaily } = require('../orchestrate/run');

test('offline runDaily chains sweep→diff→screen and writes all three artifacts', async () => {
  const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  process.env.ENGINE_STORE_DIR = tmpStore;

  // first run: no prior snapshot → diff skipped, suspiciousIdentical false
  const r1 = await runDaily({ offline: true, date: '2026-06-20' });
  assert.ok(r1.swept > 0);
  assert.equal(r1.changes, 0); // no prior day
  assert.equal(r1.suspiciousIdentical, false);
  assert.ok(r1.candidates >= 0);

  // second run (next day) → same fixture both days = byte-identical → guard fires (changes still 0, idempotent)
  const r2 = await runDaily({ offline: true, date: '2026-06-21' });
  assert.equal(r2.changes, 0);
  assert.equal(r2.suspiciousIdentical, true); // correctly flags the artificial identical fixture
  assert.ok(fs.existsSync(path.join(tmpStore, 'snapshots', '2026-06-21.json')));
  assert.ok(fs.existsSync(path.join(tmpStore, 'changes', '2026-06-21.json')));
  assert.ok(fs.existsSync(path.join(tmpStore, 'derived', 'candidates-2026-06-21.json')));

  delete process.env.ENGINE_STORE_DIR;
  fs.rmSync(tmpStore, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && node --test test/run.test.js`
Expected: FAIL — `Cannot find module '../orchestrate/run'`.

- [ ] **Step 3: Write `engine/orchestrate/run.js`**

```js
// orchestrate/run.js — chain Node stages for a daily fire.
// The ONLY module allowed to call across layers (ingest → analyze → store).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { marketSweep } = require('../ingest/market-sweep');
const { diffSnapshots } = require('../analyze/diff');
const { screen } = require('../analyze/screen');
const { loadConfig } = require('../core/config');
const { validate } = require('../core/validate');

function _storeDir() { return process.env.ENGINE_STORE_DIR || path.join(__dirname, '..', 'store'); }

function _latestSnapshots(dir, n = 2) {
  if (!fs.existsSync(dir)) return [];
  // NOTE: relies on filenames being zero-padded YYYY-MM-DD so lexicographic sort == chronological.
  // If a snapshot is ever named otherwise, prev/curr pairing silently breaks.
  return fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .slice(-n)
    .map(f => path.join(dir, f));
}

function _atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function _hashRows(rows) {
  // Hash the fund DATA, not the timestamped file — the date field always differs day-over-day,
  // so a whole-file hash would never detect stale data.
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.offline=false]
 * @param {string} [opts.date]  YYYY-MM-DD (default today UTC)
 * @returns {Promise<{ date: string, swept: number, changes: number, candidates: number, suspiciousIdentical: boolean }>}
 */
async function runDaily(opts = {}) {
  const { offline = false, date } = opts;
  const day = date || new Date().toISOString().slice(0, 10);
  const store = _storeDir();

  // 1. sweep → today's snapshot.
  //    A schema-fail / empty-response in marketSweep throws here = HARD STOP (spec §11):
  //    the fire aborts, the CLI wrapper exits 1, and yesterday's good artifacts stay intact.
  //    (No partial/void snapshot is ever written.)
  await marketSweep({ offline, date: day });

  // 2. diff vs previous snapshot (if any) + byte-identical guard
  const snaps = _latestSnapshots(path.join(store, 'snapshots'));
  let changeResult = { date: day, events: [] };
  let suspiciousIdentical = false;
  if (snaps.length >= 2) {
    const prevFile = snaps[snaps.length - 2];
    const currFile = snaps[snaps.length - 1];
    const prev = JSON.parse(fs.readFileSync(prevFile, 'utf-8'));
    const curr = JSON.parse(fs.readFileSync(currFile, 'utf-8'));
    if (_hashRows(prev.rows) === _hashRows(curr.rows)) {
      // spec §11 / INVARIANTS: identical fund rows day-over-day = stale data (SPA cache / API hiccup).
      // Flag + warn, but keep the loop idempotent (changes still computed = 0).
      suspiciousIdentical = true;
      console.warn(`[run] ⚠ snapshot rows identical to prior day (${path.basename(currFile)}) — suspected stale data`);
    }
    changeResult = diffSnapshots(prev, curr, day);
  }
  const cv = validate('change-event', changeResult);
  if (!cv.valid) throw new Error(`[run] change-event schema failed:\n  - ${cv.errors.join('\n  - ')}`);
  _atomicWrite(path.join(store, 'changes', `${day}.json`), changeResult);

  // 3. screen today's snapshot → candidates
  const { thresholds } = loadConfig();
  const latestSnap = JSON.parse(fs.readFileSync(snaps[snaps.length - 1], 'utf-8'));
  const candidates = screen(latestSnap, thresholds);
  _atomicWrite(path.join(store, 'derived', `candidates-${day}.json`), { date: day, count: candidates.rows.length, rows: candidates.rows });

  return { date: day, swept: latestSnap.count, changes: changeResult.events.length, candidates: candidates.rows.length, suspiciousIdentical };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : undefined;
  runDaily({ offline, date: dateArg })
    .then(r => { console.log('[daily] done', JSON.stringify(r)); process.exit(0); })
    .catch(e => { console.error('[daily] FAIL:', e.message); process.exit(1); });
}

module.exports = { runDaily };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && node --test test/run.test.js`
Expected: PASS — `tests 1` / `pass 1`.

- [ ] **Step 5: Run the FULL offline test suite**

Run: `cd engine && npm test`
Expected: all test files pass (`validate`, `auth`, `client`, `config`, `market-sweep`, `diff`, `screen`, `run`).

- [ ] **Step 6: Write `engine/orchestrate/daily.md` (the daily runbook)**

````markdown
# daily.md — daily fire runbook

> Executes the Phase 1 daily loop. Follow LOOP-GUIDE ceremony.

## Prerequisites
- `engine/secrets/token.json` exists and `core/auth.js` reports not-expired. If not, run `ingest/harvest-token.md` first.

## Steps
1. **Orient:** read `governance/INVARIANTS.md` → `LOOP-GUIDE.md` → `MEMORY.md` → `PLAN.md`.
2. **Run the loop:**
   ```bash
   cd engine
   node orchestrate/run.js            # live
   # or: node orchestrate/run.js --offline   # fixture, no token
   ```
3. **Sanity-check output.** `run.js` now auto-enforces the byte-identical invariant: if today's snapshot SHA-256 === yesterday's, it prints `⚠ byte-identical snapshot …` and sets `suspiciousIdentical:true`. If that fires, do NOT silently trust "0 changes" — re-sweep (suspected SPA cache / API hiccup) per INVARIANTS. Otherwise confirm artifacts landed:
   ```bash
   ls -la store/snapshots store/changes store/derived
   ```
4. **Inspect changes:** open `store/changes/<date>.json`. Any `rating_change` (esp. 5→4) or `manager_change` is high-signal — note in PLAN for deep-scrape (Plan 2).
5. **Inspect candidates:** `store/derived/candidates-<date>.json` count vs prior days. Sudden spike/drop = investigate.
6. **Finish:** append `MEMORY.md`, update `PLAN.md`.

## What this does NOT do (Phase 1 boundary)
No nav-pull, no deep-scrape, no attribution, no report. Those are Plans 2–4.
````

- [ ] **Step 7: Commit**

```bash
git add engine/orchestrate/run.js engine/orchestrate/daily.md engine/test/run.test.js
git commit -m "feat(engine): orchestrate run.js + daily runbook (offline e2e passing)"
```

---

## Task 12: Live gate — verify Node→Layer1 works with a harvested JWT

> **This is the go/no-go for the core architecture assumption.** The whole "API hot path" depends on Node being able to call `search/es` with the harvested JWT. RS256 JWTs are stateless so this *should* work, but morningstar could bind the token to session/IP. We must confirm before building Plans 2–4 on top of it. No code changes expected — this is a verification + documentation task.

**Files:**
- Modify: `engine/governance/MEMORY.md` (record the result)
- Modify: `engine/governance/PLAN.md` (set the go/no-go next step)

- [ ] **Step 1: Harvest the token (MCP)**

Follow `engine/ingest/harvest-token.md` end-to-end. Confirm:
```bash
cd engine && node -e "const {loadToken,isTokenExpired}=require('./core/auth'); const t=loadToken(); console.log('source:',t.source,'| expired?',isTokenExpired(t))"
```
Expected: `source: localStorage | expired? false` (source may differ).

- [ ] **Step 2: Probe the full-market assumption (resolve BLOCKER before trusting any snapshot)**

The daily loop assumes `{sign:'1'}` returns the whole fund universe in one call. This was **never verified** — the only captured fixture came from a heavily filtered request, and the response has no pagination/cursor fields. Probe it now with the token from Step 1:
```bash
cd engine && node -e "
const {loadToken}=require('./core/auth'); const {searchFunds}=require('./core/client');
const t=loadToken();
searchFunds({token:t.token, filter:{sign:'1'}, date:'2026-06-21'})
  .then(s=>console.log('PROBE count:',s.count,'| first:',s.rows[0]&&s.rows[0].id,s.rows[0]&&s.rows[0].fundName))
  .catch(e=>{console.error('PROBE FAIL:',e.message);process.exit(1)});
"
```
Three outcomes — handle each explicitly:
- **(a) count ≈ thousands (~10k+, ≈ morningstar's full universe):** full market in one call → proceed. (`universe.search_filter` already defaults to `{sign:'1'}`.)
- **(b) count capped/small or repeats one page:** API paginates/caps with NO cursor field → **STOP**. A partial market silently corrupts every snapshot/diff/screen. Pagination is mandatory before any live run and cannot be inferred from this plan (no cursor contract) — re-capture a paginated request in the browser to discover the page param, add a loop in `client.js`. Record in MEMORY; block until resolved.
- **(c) `{sign:'1'}` errors or returns a different default filter:** re-capture an *unfiltered* search/es request in the browser (the real "all funds" body), update `universe.search_filter`, re-probe.

Do NOT proceed to Step 3 until the probe shows a full-market (or knowingly-bounded) result.

- [ ] **Step 3: Run the daily loop LIVE**

```bash
cd engine && node orchestrate/run.js
```
Expected (success path, AFTER probe outcome (a)):
```
[daily] done {"date":"2026-06-21","swept":<N thousands>,"changes":0,"candidates":<M>,"suspiciousIdentical":false}
```
And `engine/store/snapshots/2026-06-21.json` exists with `count` >> 1 and real fund names.

- [ ] **Step 4: Verify the snapshot is real, not a cache artifact**

```bash
node -e "const s=require('./store/snapshots/2026-06-21.json'); console.log('count:',s.count,'| sample:',s.rows[0].id, s.rows[0].fundName, s.rows[0].rating3Y+'★')"
```
Expected: a real 6-digit code, a real fund name, a 1–5 rating. If `count` is 0 or names are blank → token rejected (401 path); see Step 6.

- [ ] **Step 5 (GO): Record success in MEMORY.md**

Append:
```markdown
## 2026-06-21 — LIVE GATE PASSED ✅
- Harvested token via <localStorage|header>; Node→Layer1 search/es works (count=<N>, sample=<code> <name>).
- Daily loop ran live end-to-end. Architecture assumption CONFIRMED.
- Next: Plan 2 (nav-pull + deep-scrape + attribution).
```
Commit:
```bash
git add engine/governance/MEMORY.md engine/governance/PLAN.md
git commit -m "chore(engine): live gate PASSED — Node→Layer1 confirmed"
```

- [ ] **Step 6 (NO-GO, if it fails): Record + escalate**

If Step 3/4 fails (401, empty rows, or token-bound error), do NOT force it. Append to MEMORY.md:
```markdown
## 2026-06-21 — LIVE GATE FAILED ⚠️
- Node→Layer1 call returned <HTTP/status>. Token appears <state>.
- Implication: the "API hot path via Node" assumption is violated. Options:
  (a) token is IP/UA-bound → harvest from same machine Node runs on (re-test);
  (b) fall back to browser/MCP for Layer1 too (slower; revisit spec §3.2);
  (c) the `token` header name is wrong → re-capture the real header from network panel.
- BLOCKED on user decision before Plan 2.
```
Commit the same way and surface to the user.

---

## Done criteria for Plan 1
- [ ] All 8 unit/integration test files pass (`npm test` green).
- [ ] `node orchestrate/run.js --offline` writes snapshot + changes + candidates.
- [ ] Governance artifacts exist and are internally consistent (INVARIANTS ↔ LOOP-GUIDE ↔ runbook).
- [ ] Task 12 live gate resolved (GO or documented NO-GO with a decision needed).
- [ ] `secrets/` is gitignored and contains no committed token.

## Out of scope (deferred to later plans)
- nav-pull (growth-data), deep-scrape (browser), Brinson attribution → **Plan 2**
- research-report.js (Markdown/PDF) → **Plan 3**
- retry-queue, ops/state, full error coverage, live-smoke harness, explicit `store/manifest.json` → **Plan 4**
- change-event `data_quality` type (字段错位 detection) — Phase 1 surfaces anomalies via MEMORY warnings + the `suspiciousIdentical` flag, not the schema; add the enum value in Plan 4 if needed.
