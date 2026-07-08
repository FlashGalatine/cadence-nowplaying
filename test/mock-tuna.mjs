// Throwaway mock of the Tuna OBS plugin's web server, so the widget's Tuna adapter
// can be verified with no Tuna / OBS install. Serves:
//   GET /            → current-track JSON (title, artists[], album, progress, duration, status)
//   GET /cover.png   → the current track's cover image
// …with `Access-Control-Allow-Origin: *`, matching how real Tuna lets a browser
// source read it cross-origin. Progress advances in real time and cycles tracks.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TUNA_PORT) || 1608;
const CORS = { 'Access-Control-Allow-Origin': '*' };

const tracks = [
  { title: 'Nightcall', artists: ['Kavinsky', 'Lovefoxxx'], album: 'OutRun', duration: 258000, cover: 'cover-0.png', app: 'com.squirrel.TIDAL.TIDAL' },
  { title: 'Time', artists: ['Hans Zimmer'], album: 'Inception (OST)', duration: 275000, cover: 'cover-1.png', app: 'com.squirrel.TIDAL.TIDAL' },
];

let idx = 0, start = Date.now();
setInterval(() => { if (Date.now() - start >= tracks[idx].duration) { idx = (idx + 1) % tracks.length; start = Date.now(); } }, 500);
function state() { return { t: tracks[idx] }; }

// Mimic a real SMTC snapshot: position captured a while ago, then FROZEN (WMC only
// re-reports on play/pause/seek). The widget extrapolates the live position from the
// snapshot timestamp (playback_date/playback_time), not the frozen value.
// TUNA_MODE=repeat → a SHORT track whose snapshot is old enough that extrapolation
// overshoots the end, simulating a song looping on Repeat while SMTC never re-fires.
// The widget must WRAP the bar (not stick at 100%).
const REPEAT = process.env.TUNA_MODE === 'repeat';
const SNAP_EPOCH = Date.now() - (REPEAT ? 35000 : 10000);
const SNAP_PROGRESS_MS = REPEAT ? 0 : 20000;
const DURATION_MS = REPEAT ? 30000 : null;   // override the served duration in repeat mode
const pad = (n) => String(n).padStart(2, '0');
function stamp(epoch) {
  const d = new Date(epoch);
  return {
    date: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/' || path === '/status') {
    const { t } = state();
    const s = stamp(SNAP_EPOCH);
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
    // `source` mimics Tuna forwarding the WMC app id (source auto-detection).
    res.end(JSON.stringify({
      title: t.title, artists: t.artists, album: t.album,
      cover_url: `http://127.0.0.1:${PORT}/cover.png`,
      progress: SNAP_PROGRESS_MS, duration: DURATION_MS || t.duration, status: 'playing', source: t.app,
      playback_date: s.date, playback_time: s.time,
    }));
    return;
  }
  if (path === '/cover.png') {
    try {
      const buf = await readFile(resolve(__dirname, tracks[idx].cover));
      res.writeHead(200, { ...CORS, 'content-type': 'image/png' });
      res.end(buf);
    } catch { res.writeHead(404, CORS); res.end(); }
    return;
  }
  res.writeHead(404, CORS); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`[mock-tuna] http://127.0.0.1:${PORT}/  (JSON + /cover.png, CORS *)`));
