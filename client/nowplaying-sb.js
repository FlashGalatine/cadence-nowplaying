// Streamer.bot adapter — feeds the Now-Playing widget from Streamer.bot instead of Tuna.
//
// WHY THIS EXISTS: Tuna is an OBS *plugin*, so it can't run in non-OBS broadcasters
// (Meld Studio, Streamlabs Desktop, XSplit). Streamer.bot is a standalone app whose
// local WebSocket works from ANY Chromium browser source, so we source the track from
// SB and relay it over the same ws://127.0.0.1 transport the Tally / countdown widgets
// already use. Drop-in sibling of client/tuna.js: the renderer and the
// window.setNowPlaying() contract are UNCHANGED — only the transport differs.
//
// SB SIDE: an action broadcasts a General.Custom event carrying the current track.
//   - streamerbot/nowplaying-smtc.cs      → any player, read from Windows SMTC
//   - streamerbot/nowplaying-from-args.cs → Spotify / anything SB already knows
//   Payload (this is the `data` field of SB's General.Custom envelope):
//     { type:'nowplaying:update', playing, title, artist, album,
//       appId, source, art, durationMs, positionMs, positionTs }
//   positionTs = epoch ms when positionMs was sampled → smooth extrapolation.
//
// CONFIG (window.__NP block for local files, or ?params when served over http):
//   sbHost:'127.0.0.1'  sbPort:8080  sbEndpoint:'/'   — Streamer.bot WebSocket server
//   source:'Spotify'                                  — force the chip (else derived from appId)
//   pokeAction:'NowPlaying Broadcast'                 — optional: DoAction on connect for instant state
//   debug:true                                        — log raw envelopes + mapped track

(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  // Config precedence: URL ?param= (works over http) → window.__NP (inline, for
  // file:// / local-file sources that can't take a query string) → default.
  var NP = (window.__NP && typeof window.__NP === 'object') ? window.__NP : {};
  function opt(name) { var v = q.get(name); return (v !== null && v !== '') ? v : NP[name]; }

  var HOST = opt('sbHost') || '127.0.0.1';
  var PORT = String(opt('sbPort') || '8080');
  var ENDPOINT = opt('sbEndpoint') || '/';
  var WS_URL = 'ws://' + HOST + ':' + PORT + ENDPOINT;
  var SOURCE = opt('source') || '';           // explicit chip label; else derived from appId
  var POKE = opt('pokeAction') || '';         // optional action to DoAction on connect
  var DEBUG = q.get('debug') === '1' || NP.debug === true;

  // Same source auto-detect table as the Tuna adapter — maps an SMTC app id / hint to a
  // chip label. SB's SMTC relay forwards SourceAppUserModelId (e.g. "Spotify.exe",
  // "com.squirrel.TIDAL.TIDAL"); the from-args relay can send an explicit `source`.
  var SOURCE_PATTERNS = [
    [/tidal/i, 'Tidal'], [/spotify/i, 'Spotify'], [/\bvlc\b|videolan/i, 'VLC'],
    [/deezer/i, 'Deezer'], [/youtube.?music|ytmusic|com\.google\.android\.apps\.youtube\.music/i, 'YouTube Music'],
    [/apple.?music|com\.apple|itunes/i, 'Apple Music'], [/amazon.?music/i, 'Amazon Music'],
  ];
  function detectSource(hint) {
    if (SOURCE) return SOURCE;
    var h = String(hint || '');
    for (var k = 0; k < SOURCE_PATTERNS.length; k++) if (SOURCE_PATTERNS[k][0].test(h)) return SOURCE_PATTERNS[k][1];
    return '';
  }

  var live = false, lastTitle = null;
  function go(track) {
    if (typeof window.setNowPlaying !== 'function') return;
    if (!live && typeof window.__musicGoLive === 'function') { window.__musicGoLive(); live = true; }
    window.setNowPlaying(track);
  }

  function handle(d) {
    if (!d || d.type !== 'nowplaying:update') return;   // ignore other General.Custom traffic
    if (!d.title) return;                                // nothing playing → keep last frame on screen
    var playing = (typeof d.playing === 'boolean') ? d.playing : true;
    var durMs = Number(d.durationMs) || 0;
    var elapsedMs = Number(d.positionMs) || 0;
    // Extrapolate from the sample timestamp while playing. SMTC steps a track's position
    // ONLY on play/pause/seek (Spotify's progress is likewise a snapshot), so add the age
    // of the sample so the bar is accurate, not offset. Paused → use the frozen value.
    if (playing) {
      var ts = Number(d.positionTs);
      if (ts > 0) { var extra = Date.now() - ts; if (extra >= 0 && extra < 12 * 3600 * 1000) elapsedMs += extra; }
    }
    var title = String(d.title);
    if (durMs > 0 && elapsedMs > durMs) {
      // Past the end. On Repeat the SAME title keeps playing but the source never
      // re-reports the reset, so extrapolation runs off the end — wrap so the bar doesn't
      // stick at 100%; otherwise hold at 100% (a normal ending resets within ~1s).
      elapsedMs = (playing && title === lastTitle && (elapsedMs - durMs) > 1500) ? elapsedMs % durMs : durMs;
    }
    lastTitle = title;
    var track = {
      title: title,
      artist: String(d.artist || ''),
      album: String(d.album || ''),
      source: detectSource(d.appId || d.source),   // explicit config wins; else derive from app id
      art: String(d.art || ''),                    // SMTC relay ships '' (no art via SMTC); args relay ships a URL
      duration: Math.round(durMs / 1000),
      elapsed: Math.round(elapsedMs / 1000),
      playing: playing,
    };
    if (DEBUG) console.log('[np-sb] →', track);
    go(track);
  }

  // ── Streamer.bot WebSocket: connect, subscribe to General.Custom, auto-reconnect ──
  var ws = null, retry = 0;
  function connect() {
    if (DEBUG) console.log('[np-sb] connecting ' + WS_URL);
    try { ws = new WebSocket(WS_URL); } catch (e) { schedule(); return; }
    ws.onopen = function () {
      retry = 0;
      // NOTE: the event-source key MUST be lowercase `general`, even though delivered
      // events carry `General.Custom`. Capitalizing it here silently subscribes to nothing
      // (the same SB quirk documented for the Tally scorebug).
      ws.send(JSON.stringify({ request: 'Subscribe', id: 'np', events: { general: ['Custom'] } }));
      // Optional: ask SB to broadcast current state right now, so the panel fills on load
      // instead of waiting for the relay's next tick.
      if (POKE) ws.send(JSON.stringify({ request: 'DoAction', id: 'np-poke', action: { name: POKE } }));
      if (DEBUG) console.log('[np-sb] subscribed general.Custom' + (POKE ? ' + poked "' + POKE + '"' : ''));
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (DEBUG) console.log('[np-sb] raw', m);
      // General.Custom broadcasts arrive as { event:{source:'General',type:'Custom'}, data:{...} }.
      if (m && m.event && m.event.type === 'Custom' && m.data) handle(m.data);
    };
    ws.onclose = function () { schedule(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };  // onclose then schedules the retry
  }
  function schedule() {
    retry = Math.min(retry + 1, 6);
    var wait = 500 * Math.pow(2, retry - 1);   // 0.5s → 16s backoff; overlay keeps its last frame meanwhile
    if (DEBUG) console.warn('[np-sb] disconnected; retry in ' + wait + 'ms (SB not running, WS server off, or wrong port)');
    setTimeout(connect, wait);
  }
  connect();
})();
