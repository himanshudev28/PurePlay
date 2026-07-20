# ListenFree (clone)

A music streaming SPA — instant search, offline downloads, synced listening rooms —
built on a **swappable catalog layer** so the audio source is one file, not a dependency
baked through the app.

## Run it

```bash
npm install
npm run dev
```

Works with no configuration. It defaults to the **Audius** public API — a real,
open catalog of artist-uploaded music, no key required.

## Architecture

```
src/
  services/          catalog adapters — the swappable part
    source.ts        the MusicSource interface every adapter implements
    audius.ts        default adapter (open API, no auth)
    jamendo.ts       second adapter (Creative Commons, needs a free key)
    index.ts         registry — picks the adapter from VITE_MUSIC_SOURCE
  store/
    player.ts        queue, transport, shuffle/repeat, drives the audio element
    library.ts       favorites, playlists, recents (persisted to localStorage)
  lib/
    db.ts            IndexedDB — offline audio blobs + download metadata
    room.ts          room protocol + transport (WebSocket, BroadcastChannel fallback)
  components/
    AudioEngine.tsx  the single <audio> element for the whole app
    PlayerBar.tsx    transport, seek, volume, queue panel
  routes/            home, search, library, favorites, downloads, playlist, artist, room
```

### The source abstraction

Nothing outside `services/` knows where music comes from. Every track carries a
`source` field, and `sourceFor(track.source)` resolves the adapter that produced it —
so tracks from different catalogs can sit in one queue.

To add a catalog, implement `MusicSource` (9 methods) and register it. That's it.

```
VITE_MUSIC_SOURCE=jamendo    # swap the whole catalog
```

`downloadable: false` on an adapter hides download controls automatically — the
right behaviour for embed-only or DRM'd sources where caching isn't permitted.

## Features

- **Player** — queue, shuffle, repeat one/all, seek, volume, OS media-key integration
  via the Media Session API, `Space` / `Shift+←→` shortcuts
- **Offline** — streams audio into IndexedDB with live progress; cached tracks play
  back from blob and are preferred over the network automatically
- **Rooms** — host-authoritative sync with latency-compensated drift correction, plus chat
- **Search** — debounced, aborts in-flight requests, shareable via `?q=`
- **Library** — favorites and playlists, persisted locally

### How room sync works

The host broadcasts `{track, position, playing, at}` on every state change plus a
5s heartbeat. Followers compute where they *should* be using `expectedPosition()`,
which adds the elapsed time since `at` to compensate for message latency, then:

| drift | action |
|---|---|
| < 0.35s | ignore — seeking would be more disruptive than the drift |
| 0.35–2s | nudge halfway, so audio doesn't glitch |
| > 2s | hard seek |

Without a `VITE_ROOM_WS` server, rooms sync across tabs on one device via
BroadcastChannel — the protocol is identical, so a relay server is a drop-in upgrade.

## Gotchas worth knowing about

Found by driving the running app and by review, not by reading code alone.

**`streamUrl` and `downloadUrl` are separate on purpose.** Audius `/stream`
302-redirects to a content node. `<audio>` will not follow that redirect (it fails
with `MEDIA_ERR_SRC_NOT_SUPPORTED`), so `streamUrl()` pre-resolves it. But the
resolved node then *rejects a direct cross-origin `fetch()`*, so downloads must use
the un-resolved endpoint, which fetch follows with CORS intact. Collapsing these two
back into one method breaks either playback or downloads — never both at once, which
is what makes it easy to miss.

A `Range: bytes=0-0` header would be the obvious way to resolve the redirect cheaply,
but it triggers a CORS preflight Audius rejects. The code does a plain GET and cancels
the body as soon as headers land.

**Fast track switching** cancels the pending `play()`, surfaced by Chrome as
`AbortError: interrupted by a new load request`. Expected, not a failure — filtered.

**`load()` is token-guarded.** It awaits twice before touching the element, so without
a staleness check a slow network load started *first* can resolve *last* and leave the
element playing a different track than the UI shows.

**Downloads are keyed `source:id`.** An earlier version keyed the object store on
`track.id` while every read used `source:id`, so downloads were written but never found
again — the Downloads *page* listed them (it reads via an index) while every row still
offered "Download". Symptomless in the obvious place, broken everywhere else.

**IndexedDB `blocked`/`blocking` are handled.** Without them a version upgrade held
open by another tab makes `openDB` hang forever — not reject — so every download
silently does nothing with no error to diagnose.

## Licensing — read before swapping catalogs

The adapters shipped here (Audius, Jamendo) host **artist-uploaded and
Creative-Commons licensed** music. Streaming *and* caching it offline is permitted.

That is not true of every catalog. If you point an adapter at a commercial service's
internal CDN, this app becomes a piracy tool regardless of how the code is
structured — and offline caching in particular is the part no commercial licence
permits. Legitimate routes to a mainstream catalog:

| Source | Playback | Offline |
|---|---|---|
| Spotify Web Playback SDK | yes (listener needs Premium) | no |
| YouTube IFrame API | yes | no |
| Audius / Jamendo / FMA | yes | yes |

The `downloadable` flag exists to make that distinction enforceable in code.
