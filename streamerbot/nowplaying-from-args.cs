// Streamer.bot ▸ Core ▸ C# ▸ "Execute C# Code" — NOW PLAYING from action arguments.
//
// Zero WinRT, zero extra references, nothing to install. Use this when Streamer.bot
// ALREADY knows the track — e.g. its Spotify integration, a community Spotify extension
// (Spot2SB, MM Spotify, …), or any action that has song info in its arguments. It just
// packages those args into the same General.Custom "nowplaying:update" event that
// client/nowplaying-sb.js consumes. This is the ROBUST default when the player is
// Spotify; use nowplaying-smtc.cs when you need any-player coverage.
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────────────────
// Trigger this action on your source's "song changed" event (and optionally also a short
// timer so a freshly-loaded overlay fills in). BEFORE the fields below will populate you
// must map YOUR source's argument names to these — the names vary by integration, so open
// SB's log, fire a song change, and see what args it sets, then either rename them with a
// "Set Argument" sub-action or edit the strings below.
//
// Expected args (anything missing just ships blank/duration 0 — the widget copes):
//   title, artist, album, albumArtUrl, sourceLabel   (strings)
//   durationMs, positionMs                            (integers, milliseconds)
//   isPlaying                                         (true/false)
// If your integration gives seconds, multiply by 1000; if it gives an art URL, great —
// unlike SMTC, this path CAN show album art.

using System;

public class CPHInline
{
    public bool Execute()
    {
        string title  = Arg("title");
        string artist = Arg("artist");
        string album  = Arg("album");
        string art    = Arg("albumArtUrl");     // remote URL is fine in the overlay (only file:// fetch is banned)
        string source = Arg("sourceLabel");     // e.g. "Spotify"; blank → overlay hides the chip

        long durMs = ArgLong("durationMs");
        long posMs = ArgLong("positionMs");
        bool playing = ArgBool("isPlaying", true);

        if (string.IsNullOrEmpty(title)) { CPH.LogWarn("[nowplaying-from-args] no 'title' arg — map your source's arg names (see header)"); }

        CPH.WebsocketBroadcastJson(Newtonsoft.Json.JsonConvert.SerializeObject(new
        {
            type = "nowplaying:update",
            playing = playing,
            title = title,
            artist = artist,
            album = album,
            source = source,
            art = art,
            durationMs = durMs,
            positionMs = posMs,
            positionTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()   // the trigger fires ~now → sample = now
        }));
        return true;
    }

    string Arg(string n) { return CPH.TryGetArg(n, out object v) && v != null ? v.ToString() : ""; }
    long ArgLong(string n) { long v; return long.TryParse(Arg(n), out v) ? v : 0; }
    bool ArgBool(string n, bool dflt) { bool v; return bool.TryParse(Arg(n), out v) ? v : dflt; }
}
