# Streamer.bot setup (the data side — for Meld Studio / non-OBS)

Cadence normally reads **Tuna**, but Tuna is an **OBS plugin**, so it can't run in
**Meld Studio, Streamlabs Desktop, or XSplit**. This is the alternative feed: source the
track from **[Streamer.bot](https://streamer.bot/)** (a standalone app — Windows only)
and relay it to the widget over Streamer.bot's local WebSocket, which works from a browser
source in *any* Chromium-based broadcaster. Same widget, same look — only the adapter
changes (`client/nowplaying-sb.js` instead of `client/tuna.js`).

> **Windows only.** Streamer.bot is Windows-only, and the any-player path reads Windows
> SMTC. On macOS (e.g. Meld on a Mac) neither is available — use a hosted music widget or
> a Mac SMTC-equivalent bridge instead.

## Pick your source path

| Your player | Use | Album art? | Notes |
|---|---|---|---|
| **Spotify** (or anything SB already reports) | `streamerbot/nowplaying-from-args.cs` | ✅ (art URL) | Robust, no extra references. Uses SB's Spotify integration / a community extension. **Recommended when it fits.** |
| **Any player** — Tidal, Apple Music, VLC, foobar2000, free Spotify… | `streamerbot/nowplaying-smtc.cs` | ❌ (SMTC has no art URL) | Reads the OS media session like Tuna does. Needs the WinRT projection referenced (below) — the one fragile step. |

Both broadcast the **same** `nowplaying:update` event, so the widget is identical either
way. You can even run both (Spotify via args, everything else via SMTC).

## 1. Turn on Streamer.bot's WebSocket server

Streamer.bot → **Servers/Clients → WebSocket Server → Enabled**. Default
**`127.0.0.1:8080`**. That's the address the widget connects to. (If 8080 is taken, change
it and set `sbPort` in the widget config below — port collisions are the #1 field issue.)

## 2. Add the relay action

1. Streamer.bot → **Actions** → new action, e.g. **"NowPlaying Broadcast"**.
2. Add a sub-action **Core → C# → Execute C# Code**, and paste in the `.cs` for your path
   (`nowplaying-from-args.cs` or `nowplaying-smtc.cs`). Press **Compile**.
   - **SMTC path only — reference the WinRT projection.** In the sub-action's
     *References*, add `WinRT.Runtime.dll` and `Microsoft.Windows.SDK.NET.dll` (from the
     Windows App SDK, or the `Microsoft.Windows.SDK.NET.Ref` NuGet under `lib/net6.0/`).
     If it won't compile/load on your SB build, use the from-args path instead, or a
     standalone SMTC→WebSocket helper (e.g. the `Dubya.WindowsMediaController` NuGet).
3. **Run it:**
   - **from-args:** trigger the action on your Spotify integration's **"song changed"**
     event, after mapping its argument names to `title/artist/album/durationMs/positionMs/
     isPlaying/albumArtUrl/sourceLabel` (see the file header — names vary by integration;
     check SB's log). Add a short **Timed Action** too so a freshly-loaded overlay fills.
   - **SMTC:** add a **Timed Action** (~2 s) that runs the action. The widget extrapolates
     and ticks between updates, so 2 s still looks smooth; only a song *change* lags by up
     to the interval.

## 3. Point the widget at Streamer.bot

Open `now-playing-560x160.html` and **swap the adapter script at the bottom**:

```html
<!-- was: <script src="client/tuna.js"></script> -->
<script src="client/nowplaying-sb.js"></script>
```

Then set the config block for SB (the same `window.__NP` block; SB keys shown):

```js
window.__NP = {
  sbHost: '127.0.0.1',
  sbPort: 8080,             // match the WebSocket Server port
  source: '',              // '' = auto-detect from the app id (Spotify/Tidal/…); or force 'Spotify'
  // pokeAction: 'NowPlaying Broadcast',  // optional: fill the panel instantly on load
  // debug: true,
};
```

Add the HTML as a browser source (**Meld:** Scene Layers → **+** → **Browser** → drag the
file onto the canvas; **OBS/SLD:** Local File; **XSplit:** Webpage → Browse), size
560×160. Done.

## Test it with no Streamer.bot

`test/mock-sb.mjs` is a throwaway SB WebSocket server (dependency-free) that broadcasts a
demo track, so you can preview the SB path without SB running:

```
node test/mock-sb.mjs            # then open now-playing-560x160.html (adapter swapped) with sbPort=8080
node test/verify-sb.mjs          # headless end-to-end check (needs playwright-core + system Edge/Chrome)
```

## Troubleshooting

- **Panel stuck on the demo / blank** → the WebSocket Server is off, on another port
  (set `sbPort`), or the relay action isn't broadcasting. Load with `debug:true` and open
  DevTools (**Meld:** `chrome://inspect#devices`) — the adapter logs each envelope.
- **Connects but never updates** → the Subscribe used capitalized `General`; it must be
  lowercase `general` (the adapter already does this — only relevant if you hand-edit).
  Or the relay isn't running (no timer / trigger never fires).
- **SMTC path won't compile** → the WinRT projection isn't referenced (see step 2). This
  is the expected fragile point; switch to the from-args path if needed.
- **No album art on the SMTC path** → expected — SMTC exposes only a thumbnail stream, not
  a URL. Use the from-args path (Spotify art URL) if art matters, or accept text-only.
- **Wrong source chip** → set `source` explicitly in the config block, or (SMTC path)
  confirm the app id in `SourceAppUserModelId` matches a pattern in the adapter.
