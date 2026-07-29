# Changelog

All notable changes to **Cadence** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the patch number
tracks the repository's commit count at release time.

Nothing was tagged between the initial release and 1.0.7, so that release
collects every change in between. Commit hashes and landing dates are noted for
traceability.

## [1.0.7] — 2026-07-29

### Added

- **Streamer.bot now-playing relay** — an alternative feed for non-OBS hosts.
  Tuna is an OBS plugin, so it can't feed the widget in Meld Studio, Streamlabs
  Desktop or XSplit. Streamer.bot now reads the track and broadcasts it over
  `ws://127.0.0.1:8080`, and a swapped adapter renders it; the renderer and the
  `window.setNowPlaying()` contract are unchanged.
  - `client/nowplaying-sb.js` — WebSocket adapter, a drop-in sibling of
    `tuna.js` with the same extrapolate / tick / Repeat-wrap logic.
  - `streamerbot/nowplaying-from-args.cs` — Spotify or any SB-known source;
    zero WinRT, ships an album-art URL.
  - `streamerbot/nowplaying-smtc.cs` — any player via Windows SMTC (needs the
    WinRT projection referenced; no album art).
  - `test/mock-sb.mjs` + `test/verify-sb.mjs` — dependency-free mock SB server
    and headless end-to-end check (9/9), plus `docs/STREAMERBOT-SETUP.md`.

  The adapter half is verified end-to-end against the mock. The SB-side C# is
  researched from primary docs but has **not** been run against a live
  Streamer.bot or in Meld — confirm on the first real kit, especially the SMTC
  WinRT reference. Windows only. (`d9fd443`, 2026-07-13)

### Fixed

- **Progress bar stuck at 100 % on Repeat.** On repeat, SMTC doesn't re-report a
  looped track's reset position, so the extrapolated position ran past the
  duration and was clamped. Now, when the *same* title keeps playing well past
  the end (a loop), the bar wraps to the loop position instead of clamping;
  normal track endings still hold at 100 % until the next track's metadata
  resets it. Adds a repeat-mode regression test (`TUNA_MODE=repeat`).
  (`c5535d4`, 2026-07-07)

### Documentation

- README: clone / Download-ZIP as the first setup step. (`9bfa289`, 2026-07-21)
- Support links point at the personal Discord server. (`7645aed`, 2026-07-20)
- README explains *why* Cadence is OBS-coupled: the widget renders in any
  Chromium browser-source app, but the data feed (Tuna) is an OBS plugin. Adds
  BlueSky + Discord contacts. (`689544e`, 2026-07-09)

## [0.1.0] — 2026-07-07

Initial release — a rebrandable now-playing music widget for OBS browser
sources. (`a50eec3`)

### Added

- Theme-agnostic now-playing widget fed by the free **Tuna** plugin: Tidal,
  VLC, Spotify (including free), Apple Music — anything on Windows media
  controls. It reads the OS media session, not a service API, so there are no
  accounts, no OAuth and no Premium requirement.
- Accurate progress via SMTC-timestamp extrapolation.
- Source auto-detection.
- A `file://`-friendly inline config block, so no query string is needed —
  designed for OBS *Local File* sources, which ignore URL parameters.
- CSS-variable re-skinning, with a Tuna setup guide and a re-skinning tutorial.
- MIT licensed.

[1.0.7]: https://github.com/FlashGalatine/cadence-nowplaying/compare/a50eec3...main
