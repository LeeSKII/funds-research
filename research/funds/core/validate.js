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
