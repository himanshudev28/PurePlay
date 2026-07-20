# Checkpoint — resume here

Last session ended with the YouTube adapter built but **unverified**. Read this
before writing code.

## Start it up

```bash
npm install
cp .env.example .env.local     # then add your YouTube key — see below
npm run dev
```

## THE ONE BLOCKER

The default source is YouTube and it needs a free API key. Nothing will search
until you do this:

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. Enable **YouTube Data API v3**
3. Create an API key
4. Put it in `.env.local` as `VITE_YOUTUBE_API_KEY=...`

Without it, search shows "VITE_YOUTUBE_API_KEY is not set" — that's expected,
not a bug.

**Want to work on something else instead?** Set `VITE_MUSIC_SOURCE=audius` in
`.env.local`. Audius needs no key and is fully verified working — use it for any
work on rooms, Heardle, library, offline, or UI.

## State of things

| Area | Status |
|---|---|
| Audius playback | **Verified** — plays, seeks, queues |
| Offline downloads (Audius) | **Verified** — IndexedDB round-trip confirmed |
| Search / library / favorites / playlists | **Verified** on Audius |
| PWA service worker | Built, **not verified** |
| Heardle | UI verified; snippet audio **not verified** |
| Rooms | Cross-tab only; multi-device **not verified** |
| **YouTube adapter** | **Nothing verified** — no key existed to test with |
| Automated tests | **None** |

## Pick up here

1. **Verify the YouTube path end-to-end** — this is the real next task. Search,
   playback, the video frame, and switching mid-queue between a YouTube track
   and an Audius track. It is the largest chunk of code in this repo that has
   never been executed. Expect to debug, not to demo.
2. **Server-side search cache.** Free quota is 10,000 units/day and a search
   costs 100 → ~100 searches/day total, shared by all users. There is a
   10-minute in-memory cache in `services/youtube.ts`, but the real fix is a
   shared server cache. This is the hard ceiling on the current design.
3. **Tests.** Everything so far has been checked by hand, which is exactly how
   the download key bug (below) survived a passing manual check.

## Traps — things that already bit us

**`streamUrl` vs `downloadUrl` are separate on purpose.** Audius `/stream`
302-redirects. `<audio>` won't follow the redirect, so `streamUrl` pre-resolves
it — but the resolved node then *rejects a cross-origin `fetch`*, so downloads
must use the un-resolved endpoint. Merging them breaks exactly one of playback
or downloads, and looks fine in whichever you test first.

**Downloads are keyed `source:id`.** An earlier version keyed the store on
`track.id` while reads used `source:id`. The Downloads *page* still looked
correct (it reads via an index) while every row silently re-offered "Download".
If you touch `lib/db.ts`, verify with `isDownloaded`, not the page.

**IndexedDB `blocked`/`blocking` are handled — keep them.** Without them a
version upgrade held open by another tab makes `openDB` hang forever rather than
reject, and every download silently does nothing with no error anywhere.

**Chrome suspends media in background tabs.** If you automate the browser,
playback tests will fail in ways that look exactly like code bugs. I chased this
twice. Check `document.visibilityState` before believing a media failure.

**YouTube ToS forbids audio-only playback and hiding the player.** The visible
video frame in `PlaybackHost.tsx` is a requirement, not a design choice. If you
want audio-only, switch to Audius/Jamendo — don't hide the frame.

## Architecture in one screen

```
src/
  services/     WHERE music comes from  (youtube | audius | jamendo)
                → MusicSource interface; downloadable:false hides download UI
  playback/     HOW it plays            (htmlAudio | youtube iframe)
                → PlaybackEngine interface; store picks per track.source
  store/        player (queue/transport) + library (favorites/playlists)
  lib/          db (IndexedDB offline), room (sync protocol), pwa, format
  routes/       home search library favorites downloads playlist artist room heardle
```

Every `Track` carries a `source`, so tracks from different catalogs coexist in
one queue and each resolves through the right adapter and the right engine.

Full detail in `README.md`.
