// core/config.js — load JSON configs, merged over defaults.
// JSON (not YAML) to stay zero-dep; revisit if config grows (spec §15).
const fs = require('fs');
const path = require('path');
const CONFIG_DIR = path.join(__dirname, 'config');

const DEFAULT_THRESHOLDS = {
  rating3Y_min: 4,
  rating5Y_min: 4,
  rating5Y_null_tolerant: true,
  longestTenure_min_years: 3,
  fundSize_min_yi: 2,
  fundSize_max_yi: 200,
  alphaToIndRankP_3Y_max: 50,
  sharpeRatioRankP_3Y_max: 50,
  exclude_usd_shareclass: true,
  defensive_drawdown_floor: -30,
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
