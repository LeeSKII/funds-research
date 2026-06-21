// analyze/loader.js — 第三步 dossier 加载层。输入只读 data/fund/<code>/，输出 Map<code, dossier>。
const fs = require('fs');
const path = require('path');

// 取某 code 目录下最新日期的 fund-<code>-<YYYYMMDD>.json（文件名零填充 → 字典序==时间序）
function latestDossierForCode(codeDir, code) {
  if (!fs.existsSync(codeDir)) return null;
  const files = fs.readdirSync(codeDir)
    .filter(f => new RegExp(`^fund-${code}-\\d{8}\\.json$`).test(f))
    .sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  return { file: path.join(codeDir, latest), dossier: JSON.parse(fs.readFileSync(path.join(codeDir, latest), 'utf-8')) };
}

// 扫 data/fund/，每 code 取最新 dossier，聚合为 Map<code, dossier>
function loadDossiers(dataFundDir) {
  const map = new Map();
  if (!fs.existsSync(dataFundDir)) return map;
  for (const code of fs.readdirSync(dataFundDir)) {
    const codeDir = path.join(dataFundDir, code);
    if (!fs.statSync(codeDir).isDirectory()) continue;
    const r = latestDossierForCode(codeDir, code);
    if (r && r.dossier && r.dossier.description) {
      r.dossier.__file = r.file; // provenance 用
      map.set(code, r.dossier);
    }
  }
  return map;
}

module.exports = { loadDossiers, latestDossierForCode };
