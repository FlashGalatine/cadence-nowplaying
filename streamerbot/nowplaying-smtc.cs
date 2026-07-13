// Streamer.bot ▸ Core ▸ C# ▸ "Execute C# Code" — NOW PLAYING (any player) via Windows SMTC.
//
// Reads the OS media session (System Media Transport Controls — the same thing Tuna
// reads, and what shows in the Windows media popup) and broadcasts the current track to
// overlay browser sources over Streamer.bot's WebSocket, as a General.Custom
// "nowplaying:update" event. Feeds client/nowplaying-sb.js. This is the *any-player*
// relay (Tidal, Spotify free, Apple Music, VLC, foobar2000, …) — the non-OBS equivalent
// of the Tuna recipe. Windows only (SMTC); Streamer.bot is Windows-only anyway.
//
// ── ONE-TIME SETUP — the fragile part; VERIFY ON YOUR SB BUILD ────────────────────────
// This uses the WinRT API Windows.Media.Control, so the C# sub-action needs the WinRT
// projection referenced. In the sub-action's "References" (Referenced Assemblies), add:
//     WinRT.Runtime.dll
//     Microsoft.Windows.SDK.NET.dll
// They ship with the Windows App SDK, and are in the NuGet "Microsoft.Windows.SDK.NET.Ref"
// under lib/net6.0/. Copy them somewhere stable and reference by full path. Current
// Streamer.bot runs on .NET 6/7 (CsWinRT), where IAsyncOperation<T> is awaitable as below.
// If your SB build refuses to load the projection, DON'T fight it — use
// nowplaying-from-args.cs (Spotify / any SB source), or a standalone SMTC→WebSocket
// helper (e.g. the "Dubya.WindowsMediaController" NuGet). See docs/STREAMERBOT-SETUP.md.
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────────────────
// Put this in an action and run it on a short **Timed Action** (~2 s). The overlay
// extrapolates + ticks between updates, so 2 s still yields a smooth bar; only a
// song CHANGE lags by up to one interval. (For zero-lag changes, an event-driven
// variant that subscribes to the SMTC session events is possible — see the doc.)
// No secrets, no accounts, nothing pasted into the kit.

using System;
using Windows.Media.Control;

public class CPHInline
{
    public bool Execute()
    {
        try
        {
            var mgr = GlobalSystemMediaTransportControlsSessionManager.RequestAsync().GetAwaiter().GetResult();
            var s = mgr?.GetCurrentSession();
            if (s == null)
            {
                // Nothing is publishing to SMTC → tell the overlay to stop going live.
                Broadcast(new { type = "nowplaying:update", playing = false, title = "" });
                return true;
            }

            var props = s.TryGetMediaPropertiesAsync().GetAwaiter().GetResult();
            var tl = s.GetTimelineProperties();
            var pi = s.GetPlaybackInfo();
            bool playing = pi != null && pi.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

            long durMs = tl != null ? (long)tl.EndTime.TotalMilliseconds : 0;
            long posMs = tl != null ? (long)tl.Position.TotalMilliseconds : 0;
            long posTs = tl != null ? tl.LastUpdatedTime.ToUnixTimeMilliseconds()
                                    : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            Broadcast(new
            {
                type = "nowplaying:update",
                playing = playing,
                title = props?.Title ?? "",
                artist = props?.Artist ?? "",
                album = props?.AlbumTitle ?? "",
                appId = s.SourceAppUserModelId ?? "",   // overlay maps this to a source chip (Spotify/Tidal/…)
                art = "",                               // SMTC exposes only a thumbnail STREAM, not a URL → no art here
                durationMs = durMs,
                positionMs = posMs,
                positionTs = posTs                      // epoch ms of the sample → overlay extrapolates a smooth bar
            });
            return true;
        }
        catch (Exception e)
        {
            // Most likely the WinRT projection isn't referenced (see setup header).
            CPH.LogError("[nowplaying-smtc] " + e.Message);
            return true;
        }
    }

    // CPH.WebsocketBroadcastJson wraps this JSON as the `data` of a General.Custom event,
    // which client/nowplaying-sb.js is subscribed to. (Newtonsoft ships with Streamer.bot.)
    void Broadcast(object payload)
    {
        CPH.WebsocketBroadcastJson(Newtonsoft.Json.JsonConvert.SerializeObject(payload));
    }
}
