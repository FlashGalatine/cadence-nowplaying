// Verify the Tuna adapter end-to-end with no Tuna/OBS: spawn the mock Tuna server
// (cross-origin, CORS-enabled) + a static server for the widget, then drive the
// real widget in a real browser and assert it pulls the mock track + art.
//
// Requires: npm install --no-save playwright-core  (uses system Edge/Chrome).

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TUNA_PORT = 1699;      // off the real Tuna default (1608) so it coexists
const WIDGET_PORT = 7100;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? ' — ' + d : ''}`); };

function startMock(port, mode) {
  return new Promise((res, rej) => {
    const c = spawn(process.execPath, ['test/mock-tuna.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TUNA_PORT: String(port), TUNA_MODE: mode || 'normal' } });
    let o = ''; const t = setTimeout(() => rej(new Error('mock-tuna no start\n' + o)), 6000);
    c.stdout.setEncoding('utf8'); c.stdout.on('data', (d) => { o += d; if (o.includes('mock-tuna')) { clearTimeout(t); res(c); } });
    c.stderr.setEncoding('utf8'); c.stderr.on('data', (d) => { o += d; });
  });
}
function startWidgetServer() {
  return new Promise((res) => {
    const s = createServer(async (req, r2) => {
      const p = decodeURIComponent((req.url || '/').split('?')[0]);
      try { const b = await readFile(resolve(ROOT, '.' + p)); r2.writeHead(200, { 'content-type': MIME[extname(p).toLowerCase()] || 'application/octet-stream' }); r2.end(b); }
      catch { r2.writeHead(404); r2.end('not found'); }
    });
    s.listen(WIDGET_PORT, '127.0.0.1', () => res(s));
  });
}
async function launch() {
  for (const ch of ['msedge', 'chrome']) { try { return await chromium.launch({ channel: ch, headless: true }); } catch {} }
  return await chromium.launch({ headless: true });
}

(async () => {
  console.log('Now-Playing widget — Tuna adapter verification\n');
  let mock, ws, browser;
  try {
    mock = await startMock(TUNA_PORT, 'normal');
    ws = await startWidgetServer();
    console.log(`mock Tuna :${TUNA_PORT} (CORS), widget :${WIDGET_PORT}\n`);
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 560, height: 160 }, deviceScaleFactor: 2 });
    // No ?source= — let the widget AUTO-DETECT the source from Tuna's app id.
    const url = `http://127.0.0.1:${WIDGET_PORT}/now-playing-560x160.html?tunaPort=${TUNA_PORT}`;
    await page.goto(url, { waitUntil: 'load' });

    // The widget starts on demo tracks; wait until the adapter swaps in the mock
    // Tuna track ("Nightcall") AND the cross-origin cover art has decoded.
    const ok = await page.waitForFunction(() => {
      const t = document.querySelector('[data-mt]');
      const img = document.querySelector('[data-mart]');
      const tile = document.querySelector('.art');
      return t && t.textContent.replace(/◆.*/, '').trim() === 'Nightcall'
        && tile && tile.classList.contains('has-art') && img && img.naturalWidth > 0;
    }, { timeout: 10000 }).then(() => true).catch(() => false);

    const d = await page.evaluate(() => ({
      title: (document.querySelector('[data-mt]')?.textContent || '').replace(/◆.*/, '').trim(),
      artist: (document.querySelector('[data-ma]')?.textContent || '').trim(),
      src: (document.querySelector('[data-ms]')?.textContent || '').trim(),
      dur: (document.querySelector('[data-md]')?.textContent || '').trim(),
      dot: getComputedStyle(document.querySelector('[data-mdot]')).backgroundColor,
      artLoaded: (document.querySelector('[data-mart]')?.naturalWidth || 0) > 0,
    }));

    check('adapter pulled Tuna track (title = Nightcall)', d.title === 'Nightcall', d.title);
    check('artist mapped from artists[]', /Kavinsky/.test(d.artist), d.artist);
    check('source AUTO-DETECTED from app id (Tidal) + album', /TIDAL/i.test(d.src) && /OutRun/.test(d.src), d.src);
    check('duration mapped ms→m:ss (258000→4:18)', d.dur === '4:18', d.dur);
    check('detected-source dot = Tidal cyan', d.dot.includes('51, 229, 229'), d.dot);
    check('cover art loaded cross-origin', d.artLoaded);
    check('overall render settled', ok);

    // The mock's Tuna progress is FROZEN at 0:20 (SMTC-style); the widget must still
    // advance the bar on its own.
    const toSec = (s) => { const m = String(s).split(':'); return (+m[0]) * 60 + (+m[1]); };
    const e1 = await page.evaluate(() => document.querySelector('[data-me]').textContent.trim());
    await page.waitForTimeout(3000);
    const e2 = await page.evaluate(() => document.querySelector('[data-me]').textContent.trim());
    // Snapshot was 0:20 taken 10s ago → extrapolated position must be ≈0:30+, NOT 0:20.
    check('progress EXTRAPOLATED past frozen snapshot (≈0:30, not 0:20)', toSec(e1) >= 28, e1);
    check('progress advances smoothly while playing', toSec(e2) > toSec(e1) && (toSec(e2) - toSec(e1)) <= 6, `${e1} → ${e2}`);

    const shot = resolve(ROOT, 'test', 'render-check.png');
    await page.screenshot({ path: shot });
    console.log('  screenshot →', shot);

    // ── Repeat/loop regression: a looping track must WRAP the bar, not stick at 100% ──
    console.log('\n[repeat] song on Repeat — the bar must reset, not stick at 100%');
    const mockR = await startMock(1698, 'repeat');
    try {
      const pageR = await browser.newPage({ viewport: { width: 560, height: 160 } });
      await pageR.goto(`http://127.0.0.1:${WIDGET_PORT}/now-playing-560x160.html?tunaPort=1698`, { waitUntil: 'load' });
      await pageR.waitForTimeout(4000); // 2+ polls so the wrap engages past the grace window
      const me = (await pageR.evaluate(() => (document.querySelector('[data-me]') || {}).textContent || '')).trim();
      const secs = (() => { const m = String(me).split(':'); return (+m[0]) * 60 + (+m[1]); })();
      // 30s track, extrapolated ~35-40s → wrapped to ~5-12s. Must be well under 30, not 0:30.
      check('repeat: bar wraps to loop position (not stuck at 100%)', secs > 0 && secs < 25, me + ' of 0:30');
      await pageR.close();
    } finally { mockR.kill(); }

    await browser.close();
  } catch (e) {
    fail++; console.log('\n  ERROR ' + e.message);
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
    if (mock) mock.kill();
    if (ws) ws.close();
  }
  console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
