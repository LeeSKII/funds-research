// core/state.js — 可恢复的长跑状态（bulk-sweep / 分片检索 用）。
//
// 断点续跑：把「哪些 code 已成功 / 哪些失败」持久化到 JSON，进程中断后从 state 续跑，不重抓已完成的。
// 文件 shape：{ done: {<code>: true}, failed: {<code>: <errMsg>}, updatedAt }。done/failed 用对象(O(1) 查)
// 而非数组，避免大池线性扫描。saveState 原子写。

const fs = require('fs');
const path = require('path');

function emptyState() {
  return { done: Object.create(null), failed: Object.create(null), updatedAt: null };
}

function loadState(file) {
  if (!file || !fs.existsSync(file)) return emptyState();
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return {
      done: (s.done && typeof s.done === 'object') ? s.done : Object.create(null),
      failed: (s.failed && typeof s.failed === 'object') ? s.failed : Object.create(null),
      updatedAt: s.updatedAt || null,
    };
  } catch (e) {
    return emptyState(); // 损坏的 state 文件不致命：从空续跑（最坏重抓）
  }
}

function saveState(file, state, now = Date.now()) {
  state.updatedAt = new Date(now).toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

const isDone = (state, code) => Object.prototype.hasOwnProperty.call(state.done, code);
const isFailed = (state, code) => Object.prototype.hasOwnProperty.call(state.failed, code);

function markDone(state, code) { delete state.failed[code]; state.done[code] = true; }
function markFailed(state, code, errMsg) { state.failed[code] = String(errMsg).slice(0, 200); }

/** 从候选 codes 里剔除已 done 的，返回待办（保留原顺序）。 */
function nextPending(state, codes) {
  return (codes || []).filter(c => !isDone(state, c));
}

function summary(state) {
  return { done: Object.keys(state.done).length, failed: Object.keys(state.failed).length, updatedAt: state.updatedAt };
}

module.exports = { emptyState, loadState, saveState, isDone, isFailed, markDone, markFailed, nextPending, summary };
