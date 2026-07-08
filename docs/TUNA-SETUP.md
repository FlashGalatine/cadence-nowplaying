# Tuna setup (the data side)

Cadence displays whatever the free **[Tuna](https://obsproject.com/forum/resources/tuna.843/)**
OBS plugin reports. Tuna reads your player and serves it as JSON on a local web server;
the widget reads that. This is a one-time, ~2-minute setup. **Windows** steps below
(SMTC); Tuna also works on Linux via MPRIS.

## 1. Install Tuna

Grab it from the [OBS forum](https://obsproject.com/forum/resources/tuna.843/) or GitHub
and install it into OBS. Restart OBS. You'll find it under **Tools → Tuna**, and a
**"Tuna settings"** dialog under its properties.

## 2. Pick your source

Tuna reads **one source at a time**. Choose based on your player:

- **Desktop apps — Tidal, Spotify, Apple Music, iTunes, etc. → "Windows Media Control".**
  Open the **Windows Media Control** tab and, under *Selected media player*, pick your app
  (e.g. `com.squirrel.TIDAL.TIDAL` for Tidal, or the Spotify entry). This uses Windows'
  system media controls (SMTC) — the same thing that shows on your lock screen and reacts
  to keyboard play/pause.
- **VLC playing inside OBS (a VLC Video Source in your scene) → the "VLC" source.** Tuna
  reads the embedded player directly. (Standalone VLC only appears under Windows Media
  Control if its SMTC integration is on — it's finicky; the OBS VLC Source is more reliable.)

**Sanity check:** if your player shows up in the **Windows media popup** (the little
control that appears with the volume flyout) or responds to your keyboard's play/pause
key, then *Windows Media Control* can read it.

## 3. Enable Tuna's web server

In Tuna settings → **Basics** (or the web-server section), enable the **Web server**
output and note the **port** (default **`1608`**). This is what the widget reads.

**Verify it's working:** with music playing, open **http://localhost:1608/** in a normal
browser. You should see a chunk of JSON with your `title`, `artists`, etc. If you do, the
widget will show it.

## 4. Point the widget at it

Open `now-playing-560x160.html`, set the `window.__NP` block, and add the file as a
**Local File** browser source (560×160). See the main [README](../README.md).

```js
window.__NP = { source: 'Tidal', tunaHost: '127.0.0.1', tunaPort: 1608 };
```

## Does my music service work? (subscription note)

Almost certainly **yes**, and **you don't need a paid tier** — the widget reads the OS
media session, not the service's API:

| Service | Works? | Notes |
|---|---|---|
| **Tidal** | ✅ | Via Windows Media Control. Album may be blank (Tidal omits it from SMTC). |
| **Spotify** | ✅ **incl. Free** | The desktop app reports to SMTC on any tier. (No Premium needed — unlike API-based overlays.) |
| **Apple Music** | ✅ | Via the Windows app's media controls. (Apple Music itself needs a sub to *play* — that's the service, not the widget.) |
| **YouTube Music / Deezer / Amazon Music** | ✅ | Desktop apps or browser via Tuna's browser script. |
| **VLC (in OBS)** | ✅ | Use Tuna's "VLC" (OBS VLC Source) option. |
| **foobar2000 / other local players** | ✅ if they publish to SMTC | Check the Windows media popup. |

The rule: **if it appears in Windows' media controls, the widget can show it** — no login,
OAuth, or subscription on the widget's side.

## Troubleshooting

- **Widget stuck on the demo / blank:** open **http://localhost:1608/** — if it's empty,
  Tuna isn't reading your player (wrong Source tab, or the player isn't publishing to SMTC).
- **See exactly what Tuna sends:** load the widget with **`?debug=1`** (over http) or set
  `debug: true` in the `window.__NP` block, then open the browser console (F12) — it logs
  Tuna's raw JSON and the mapped track every second.
- **Wrong source label:** Tuna's JSON doesn't name the app, so set `source` in the config
  block (e.g. `'Tidal'`) to control the label + dot.
- **Progress bar frozen:** you're on an old build — update the widget; the current one
  extrapolates SMTC's stepped position into a smooth bar.
