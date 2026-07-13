// Throwaway mock of a Streamer.bot WebSocket server, so client/nowplaying-sb.js can be
// verified with no Streamer.bot / OBS / Meld install. Dependency-free: a minimal RFC6455
// server (node has an http server but no WS server), just enough to talk to our own
// adapter. Broadcasts a General.Custom "nowplaying:update" every 2s (and immediately on
// any inbound frame, so the adapter's Subscribe/DoAction pokes get instant state),
// mimicking an SMTC snapshot: position captured a while ago then FROZEN, with a
// positionTs the adapter extrapolates from. SB_MODE=repeat → a short looping track whose
// extrapolation overshoots the end (the widget must WRAP the bar, not stick at 100%).

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.SB_PORT) || 8080;
const REPEAT = process.env.SB_MODE === 'repeat';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const tracks = REPEAT
  ? [{ title: 'Loop', artist: 'Test', album: '', durationMs: 30000, appId: 'Spotify.exe' }]
  : [
      { title: 'Nightcall', artist: 'Kavinsky, Lovefoxxx', album: 'OutRun', durationMs: 258000, appId: 'com.squirrel.TIDAL.TIDAL' },
      { title: 'Time', artist: 'Hans Zimmer', album: 'Inception (OST)', durationMs: 275000, appId: 'Spotify.exe' },
    ];
let idx = 0, start = Date.now();
setInterval(() => { if (Date.now() - start >= tracks[idx].durationMs) { idx = (idx + 1) % tracks.length; start = Date.now(); } }, 500);

function payload() {
  const t = tracks[idx];
  const sampledAgoMs = REPEAT ? 35000 : 10000;   // repeat: old enough that extrapolation overshoots 30s
  const positionMs = REPEAT ? 0 : 20000;
  return {
    type: 'nowplaying:update', playing: true,
    title: t.title, artist: t.artist, album: t.album, appId: t.appId, art: '',
    durationMs: t.durationMs, positionMs, positionTs: Date.now() - sampledAgoMs,
  };
}
// SB delivers custom broadcasts inside this envelope; the adapter reads .event + .data.
function envelope(data) { return JSON.stringify({ timeStamp: new Date().toISOString(), event: { source: 'General', type: 'Custom' }, data }); }

// ── minimal WS framing (server→client unmasked; client→server masked) ──
function frame(str) {
  const p = Buffer.from(str, 'utf8'), len = p.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) head = Buffer.from([0x81, 126, (len >> 8) & 255, len & 255]);
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  return Buffer.concat([head, p]);
}
function isClose(buf) { return (buf[0] & 0x0f) === 0x8; }

const clients = new Set();
function broadcast() { const msg = frame(envelope(payload())); for (const s of clients) { try { s.write(msg); } catch {} } }

const server = createServer((_req, res) => { res.writeHead(426); res.end('ws only'); });
server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1').update((req.headers['sec-websocket-key'] || '') + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  clients.add(socket);
  socket.on('data', (buf) => {
    if (isClose(buf)) { clients.delete(socket); try { socket.end(); } catch {} return; }
    // Any inbound frame (Subscribe / DoAction poke) → push current state immediately.
    try { socket.write(frame(envelope(payload()))); } catch {}
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});
setInterval(broadcast, 2000);
server.listen(PORT, '127.0.0.1', () => console.log(`[mock-sb] ws://127.0.0.1:${PORT}/  (General.Custom nowplaying:update every 2s${REPEAT ? ', REPEAT mode' : ''})`));
