// Tuna adapter — feeds the Now-Playing widget from the free Tuna OBS plugin.
//
// Tuna does the hard part: it reads VLC (its "OBS VLC Source") and Tidal (its
// "Windows Media Control" / SMTC source, which is the ONLY way a browser can ever
// see Tidal — SMTC is an OS API no web page can touch directly), and serves the
// current track over a local webserver. This adapter polls it and maps it into
// window.setNowPlaying(). No bespoke backend required from the client.
//
// Setup for the streamer: install Tuna, pick their source (Windows Media Control
// for Tidal, OBS VLC Source for VLC), and enable Tuna's "Web server" output
// (default port 1608). Then add this widget as a Browser Source.
//
// URL params (all optional):
//   ?tunaHost=127.0.0.1  ?tunaPort=1608   — where Tuna's web server is
//   ?source=Tidal|VLC|Spotify             — label + dot (Tuna's JSON has no source field)
//   ?pollMs=1000                          — poll interval

(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  // Config precedence: URL ?param= (works over http) → window.__NP (set inline in the
  // HTML, for OBS local-file/file:// sources that can't take a query string) → default.
  var NP = (window.__NP && typeof window.__NP === 'object') ? window.__NP : {};
  function opt(name) { var v = q.get(name); return (v !== null && v !== '') ? v : NP[name]; }

  var HOST = opt('tunaHost') || '127.0.0.1';
  var PORT = String(opt('tunaPort') || '1608');
  var BASE = 'http://' + HOST + ':' + PORT;
  var SOURCE = opt('source') || '';           // label + dot; Tuna's JSON has no source name
  var POLL = Math.max(500, parseInt(opt('pollMs'), 10) || 1000);
  var DEBUG = q.get('debug') === '1' || NP.debug === true;  // log Tuna's raw JSON + mapped track

  var live = false;
  var lastTitle = null;
  if (DEBUG) console.log('[tuna] polling ' + BASE + '/ every ' + POLL + 'ms');

  // Tuna's JSON carries no reliable "source" field, so detect it: an explicit
  // ?source= override wins; else map a player/app id if Tuna forwards one (WMC gives
  // e.g. "com.squirrel.TIDAL.TIDAL"); else infer from the cover URL's domain (works
  // for streaming CDNs, not local SMTC thumbnails). Unknown → no source chip.
  var SOURCE_PATTERNS = [
    [/tidal/i, 'Tidal'], [/spotify/i, 'Spotify'], [/\bvlc\b|videolan/i, 'VLC'],
    [/deezer/i, 'Deezer'], [/youtube.?music|ytmusic|com\.google\.android\.apps\.youtube\.music/i, 'YouTube Music'],
    [/apple.?music|com\.apple/i, 'Apple Music'], [/amazon.?music/i, 'Amazon Music'],
  ];
  function detectSource(j) {
    if (SOURCE) return SOURCE;
    var hint = String(j.source || j.player || j.app || j.app_name || j.app_id || j.player_name || j.playerName || '');
    var cover = String(j.cover_url || j.album_url || '');
    for (var k = 0; k < SOURCE_PATTERNS.length; k++) {
      if (SOURCE_PATTERNS[k][0].test(hint) || SOURCE_PATTERNS[k][0].test(cover)) return SOURCE_PATTERNS[k][1];
    }
    return '';
  }

  // SMTC/Tuna stamps WHEN it captured the position (playback_date "YYYY.MM.DD" +
  // playback_time "HH:MM:SS", local time). Returns that as an epoch, or NaN.
  function snapshotEpoch(j) {
    var dm = String(j.playback_date || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
    var tm = String(j.playback_time || '').match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!dm || !tm) return NaN;
    return new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], +tm[3]).getTime();
  }

  function go(track) {
    if (typeof window.setNowPlaying !== 'function') return;
    if (!live && typeof window.__musicGoLive === 'function') { window.__musicGoLive(); live = true; }
    window.setNowPlaying(track);
  }

  function poll() {
    fetch(BASE + '/', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (DEBUG) console.log('[tuna] raw', j);
        if (!j || !j.title) return;   // nothing playing → keep the last frame on screen
        var artists = Array.isArray(j.artists) ? j.artists.filter(Boolean).join(', ') : (j.artists || '');
        var title = String(j.title);
        var playing = j.status ? j.status === 'playing' : true;
        var durMs = Number(j.duration) || 0;
        // SMTC reports a track's position ONLY on play/pause/seek (Tuna's `progress`
        // otherwise sits frozen). While playing, extrapolate the live position from
        // Tuna's snapshot timestamp so the bar is accurate, not offset by snapshot age.
        // When paused, use the raw (frozen) position. The widget also ticks between polls.
        var elapsedMs = Number(j.progress) || 0;
        if (playing) {
          var snap = snapshotEpoch(j);
          if (!isNaN(snap)) { var extra = Date.now() - snap; if (extra >= 0 && extra < 12 * 3600 * 1000) elapsedMs += extra; }
        }
        if (durMs > 0 && elapsedMs > durMs) {
          // Past the end. On Repeat, the SAME title keeps playing but the source (SMTC)
          // doesn't re-report the reset position, so extrapolation runs off the end. If
          // we're still on the same title well past the end, treat it as a loop and WRAP
          // the bar so it doesn't stick at 100%; otherwise hold at 100% (a normal ending —
          // the next track's metadata resets us within ~1s).
          elapsedMs = (playing && title === lastTitle && (elapsedMs - durMs) > 1500)
            ? elapsedMs % durMs
            : durMs;
        }
        lastTitle = title;
        // Cover comes from Tuna's /cover.png. Cache-bust per TRACK (not per poll) so a
        // new cover loads but the same track doesn't reload every second.
        var art = BASE + '/cover.png?ck=' + encodeURIComponent(title);
        var track = {
          title: title,
          artist: artists,
          album: j.album || '',
          source: detectSource(j),          // '' → widget shows album only, no source chip
          art: art,
          duration: Math.round(durMs / 1000),
          elapsed: Math.round(elapsedMs / 1000),
          playing: playing,
        };
        if (DEBUG) console.log('[tuna] →', track);
        go(track);
      })
      .catch(function (e) {
        // Tuna down, or a cross-origin block if Tuna's web server sends no CORS
        // header — keep the last frame and retry. (Real Tuna allows browser reads;
        // if a build doesn't, serve this widget from Tuna's own web server folder.)
        if (DEBUG) console.warn('[tuna] fetch failed (Tuna not running, wrong port, or CORS blocked):', e && e.message);
      });
  }

  poll();
  setInterval(poll, POLL);
})();
