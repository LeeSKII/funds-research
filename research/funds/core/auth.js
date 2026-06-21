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
