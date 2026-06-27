// views/report.js — full-screen rendered research-report overlay.
// Fetches /api/report/:code (the Markdown report.js produces) → mdToHtml → styled overlay.
// DRY with research/funds/analyze/report.js (same source markdown); 0 deps.
import { mdToHtml } from '../lib/md.mjs';

let _wired = false;

function _wireClose(overlay) {
  if (_wired) return;
  _wired = true;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeReport(); });
  document.getElementById('report-close').addEventListener('click', closeReport);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReport(); });
}

export async function openReport(code) {
  let overlay = document.getElementById('report-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'report-overlay';
    overlay.className = 'report-overlay';
    overlay.innerHTML = `
      <div class="report-card">
        <button class="report-close" id="report-close" title="关闭 (Esc)">✕ 关闭</button>
        <div class="report-body" id="report-body"><p style="color:var(--muted)">加载中…</p></div>
      </div>`;
    document.body.appendChild(overlay);
    _wireClose(overlay);
  }
  overlay.classList.add('open');
  document.body.classList.add('no-scroll');
  const body = document.getElementById('report-body');
  body.innerHTML = '<p style="color:var(--muted)">加载中…</p>';
  try {
    const res = await fetch(`/api/report/${code}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    body.innerHTML = mdToHtml(md);
    // scroll to top on each open
    body.scrollTop = 0;
  } catch (err) {
    body.innerHTML = `<p><strong>报告加载失败：</strong>${err.message}</p>
      <p style="color:var(--muted)">该基金可能尚未生成研究报告。生成：<code>cd research/funds && npm run report:offline</code></p>`;
  }
}

export function closeReport() {
  const overlay = document.getElementById('report-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.classList.remove('no-scroll');
}
