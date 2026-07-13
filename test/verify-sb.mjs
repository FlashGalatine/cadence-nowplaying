// Verify the Streamer.bot adapter (client/nowplaying-sb.js) end-to-end with no SB / OBS /
// Meld: spawn the mock SB WebSocket server + a static server for the widget, load the REAL
// renderer in a real browser with the SB adapter swapped in for the Tuna one (route
// interception on client/tuna.js), and assert it pulls the mock track, auto-detects the
// source from the SMTC app id, extrapolates a smooth progress bar, and wraps on Repeat.
//
// Requires: npm install --no-save playwright-core  (uses system Edge/Chrome).

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SB_PORT = 8099;         // off SB's real default (8080) so it coexists
const SB_PORT_R = 8098;       // repeat-mode mock
const WIDGET_PORT = 7110;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? ' — ' + d : ''}`); };

function startMock(port, mode) {
  return new Promise((res, rej) => {
    const c = spawn(process.execPath, ['test/mock-sb.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SB_PORT: String(port), SB_MODE: mode || 'normal' } });
    let o = ''; const t = setTimeout(() => rej(new Error('mock-sb no start\n' + o)), 6000);
    c.stdout.setEncoding('utf8'); c.stdout.on('data', (d) => { o += d; if (o.includes('mock-sb')) { clearTimeout(t); res(c); } });
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
const toSec = (s) => { const m = String(s).split(':'); return (+m[0]) * 60 + (+m[1]); };

(async () => {
  console.log('Now-Playing widget — Streamer.bot adapter verification\n');
  let mock, ws, browser;
  // Swap the Tuna adapter for the SB adapter, so the REAL renderer runs unmodified.
  const sbAdapter = await readFile(resolve(ROOT, 'client', 'nowplaying-sb.js'), 'utf8');
  const routeSwap = async (page) => page.route('**/client/tuna.js', (route) => route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: sbAdapter }));
  try {
    mock = await startMock(SB_PORT, 'normal');
    ws = await startWidgetServer();
    console.log(`mock SB :${SB_PORT} (ws), widget :${WIDGET_PORT}\n`);
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 560, height: 160 }, deviceScaleFactor: 2 });
    await routeSwap(page);
    // ?sbPort points the adapter at the mock; no ?source= → auto-detect from the app id.
    await page.goto(`http://127.0.0.1:${WIDGET_PORT}/now-playing-560x160.html?sbPort=${SB_PORT}&debug=1`, { waitUntil: 'load' });

    const ok = await page.waitForFunction(() => {
      const t = document.querySelector('[data-mt]');
      return t && t.textContent.replace(/◆.*/, '').trim() === 'Nightcall';
    }, { timeout: 10000 }).then(() => true).catch(() => false);

    const d = await page.evaluate(() => ({
      title: (document.querySelector('[data-mt]')?.textContent || '').replace(/◆.*/, '').trim(),
      artist: (document.querySelector('[data-ma]')?.textContent || '').trim(),
      src: (document.querySelector('[data-ms]')?.textContent || '').trim(),
      dur: (document.querySelector('[data-md]')?.textContent || '').trim(),
      dot: getComputedStyle(document.querySelector('[data-mdot]')).backgroundColor,
    }));

    check('adapter pulled SB track (title = Nightcall)', d.title === 'Nightcall', d.title);
    check('artist mapped', /Kavinsky/.test(d.artist), d.artist);
    check('source AUTO-DETECTED from SMTC app id (Tidal) + album', /TIDAL|Tidal/.test(d.src) && /OutRun/.test(d.src), d.src);
    check('duration mapped ms→m:ss (258000→4:18)', d.dur === '4:18', d.dur);
    check('detected-source dot = Tidal cyan', d.dot.includes('51, 229, 229'), d.dot);
    check('overall render settled', ok);

    // Mock position is FROZEN at 0:20 sampled 10s ago → adapter must extrapolate to ≈0:30+.
    const e1 = await page.evaluate(() => document.querySelector('[data-me]').textContent.trim());
    await page.waitForTimeout(3000);
    const e2 = await page.evaluate(() => document.querySelector('[data-me]').textContent.trim());
    check('progress EXTRAPOLATED past frozen snapshot (≈0:30, not 0:20)', toSec(e1) >= 28, e1);
    check('progress advances smoothly while playing', toSec(e2) > toSec(e1) && (toSec(e2) - toSec(e1)) <= 6, `${e1} → ${e2}`);

    await page.screenshot({ path: resolve(ROOT, 'test', 'render-check-sb.png') });

    // ── Repeat/loop regression: a looping track must WRAP the bar, not stick at 100% ──
    console.log('\n[repeat] song on Repeat — the bar must reset, not stick at 100%');
    const mockR = await startMock(SB_PORT_R, 'repeat');
    try {
      const pageR = await browser.newPage({ viewport: { width: 560, height: 160 } });
      await routeSwap(pageR);
      await pageR.goto(`http://127.0.0.1:${WIDGET_PORT}/now-playing-560x160.html?sbPort=${SB_PORT_R}`, { waitUntil: 'load' });
      await pageR.waitForTimeout(4500);   // 2+ broadcasts so the wrap engages past the grace window
      const me = (await pageR.evaluate(() => (document.querySelector('[data-me]') || {}).textContent || '')).trim();
      check('repeat: bar wraps to loop position (not stuck at 100%)', toSec(me) > 0 && toSec(me) < 25, me + ' of 0:30');
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
