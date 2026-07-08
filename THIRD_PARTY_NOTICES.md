# Third-Party Notices

The **widget itself** (`now-playing-560x160.html`, `client/tuna.js`) has **no
third-party runtime code and no dependencies** — it's plain HTML/CSS/JS and uses
system fonts (no CDN, no web fonts by default). It reads data from the
[Tuna](https://obsproject.com/forum/resources/tuna.843/) OBS plugin, which the
streamer installs separately; Tuna is not bundled or distributed here.

## Development-only

The verification harness (`test/verify.mjs`) optionally uses:

- **playwright-core** — Apache-2.0 — to drive a headless browser for the render
  check. It is installed on demand (`npm install --no-save playwright-core`) and is
  **not** part of the shipped widget.

## Bundled sample images

The images in `test/` (`cover-*.png`) are placeholder album covers generated
procedurally for the mock server / tests, released into the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). They are test
fixtures, not part of the widget.
