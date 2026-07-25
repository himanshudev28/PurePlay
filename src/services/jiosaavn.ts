import type { MusicSource } from './source'
import { SourceError } from './source'
import type { Track, Artist, Collection, SearchResults } from '@/types'
import { getQuality, type Quality } from '@/lib/prefs'
import { withTimeout } from '@/lib/net'

/*
  API mirrors, tried in order. Set VITE_JIOSAAVN_API in .env to put your own
  (self-hosted saavn.dev) instance first — that's the real fix for reliability,
  since the public instances rate-limit and occasionally go down. The rest are
  community fallbacks: if the primary 429s or fails, apiFetch retries the same
  request against the next mirror automatically.
*/
const ENV_BASE = (import.meta.env.VITE_JIOSAAVN_API as string | undefined)?.replace(/\/$/, '')
const API_BASES = ENV_BASE
  ? [ENV_BASE, 'https://saavn.sumit.co/api']
  : import.meta.env.PROD
    ? // On Vercel: go through same-origin proxy rewrites (see vercel.json). Both
      // are CDN-cached and CORS-free; the second is a different upstream so a
      // rate-limited primary fails over cleanly, still same-origin.
      ['/api/saavn', '/api/saavn2']
    : // Local dev has no proxy, so hit the public mirrors directly.
      ['https://saavn.sumit.co/api', 'https://saavn.dev/api']
/** URLs are built with this; apiFetch swaps in the other mirrors on failure. */
const API_BASE = API_BASES[0]

/*
  The public JioSaavn API rate-limits bursts with HTTP 429 — and a home page of
  shelves fires ~20 requests at once. Its 429 responses also omit CORS headers,
  so in the browser a throttled request surfaces as an opaque "Failed to fetch".

  apiFetch is a drop-in for fetch() that:
    • caps concurrency so we never fire the whole burst at once,
    • retries 429s / network failures with backoff, then fails over to the next
      mirror,
    • caches successful GETs briefly, so re-renders and back-navigation are free.
*/
const MAX_CONCURRENT = 2
let activeRequests = 0
const waiting: Array<() => void> = []
const acquire = () =>
  activeRequests < MAX_CONCURRENT
    ? ((activeRequests++), Promise.resolve())
    : new Promise<void>((r) => waiting.push(() => ((activeRequests++), r())))
const release = () => {
  activeRequests--
  waiting.shift()?.()
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const CACHE_TTL = 5 * 60 * 1000
/** Entries are only TTL-checked on read, so cap the map or a long session
 *  accumulates every response body ever fetched. */
const CACHE_MAX = 150
const responseCache = new Map<string, { at: number; body: string; status: number }>()


/*
  Circuit breaker. When every mirror fails (the public instances are frequently
  rate-limited or down), keep retrying each subsequent request against them and
  the whole page hangs for tens of seconds before callers give up and fall back
  to YouTube Music. Instead, once they all fail, mark the catalog "down" for a
  minute and fast-fail — callers then hit their fallback immediately.
*/
const BREAKER_MS = 60 * 1000
let downUntil = 0

/** One mirror, with one backoff retry for a transient 429 / network blip. */
async function fetchWithRetry(target: string, init?: RequestInit, attempts = 1): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      // per-attempt timeout — a mirror that accepts and then hangs must fail
      // over like one that refuses
      const res = await fetch(target, { ...init, signal: withTimeout(init?.signal) })
      if (res.status === 429 && attempt < attempts) {
        await sleep(500 * (attempt + 1) + Math.random() * 300)
        continue
      }
      return res
    } catch (e) {
      // only rethrow a CALLER abort — a TimeoutError falls through to retry
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (attempt < attempts) {
        await sleep(500 * (attempt + 1) + Math.random() * 300)
        continue
      }
      throw e
    }
  }
}

/** Walk the mirror list; resolves with the body of the first usable response. */
async function fetchThroughMirrors(
  url: string,
  init?: RequestInit,
): Promise<{ body: string; status: number; ok: boolean }> {
  // Re-check the breaker AFTER the semaphore too: a burst of ~20 requests all
  // passes a single up-front check in the same tick, then queues — by the time
  // a queued request gets a slot, an earlier one may have tripped the breaker.
  if (Date.now() < downUntil) throw new Error('Catalog temporarily unavailable')
  await acquire()
  try {
    if (Date.now() < downUntil) throw new Error('Catalog temporarily unavailable')

    let lastError: unknown
    for (const base of API_BASES) {
      const target = base === API_BASE ? url : url.replace(API_BASE, base)
      try {
        const res = await fetchWithRetry(target, init)
        if (res.ok) {
          downUntil = 0 // a success reopens the breaker
          const body = await res.text()
          if (responseCache.size >= CACHE_MAX) {
            const oldest = responseCache.keys().next().value
            if (oldest !== undefined) responseCache.delete(oldest)
          }
          responseCache.set(url, { at: Date.now(), body, status: res.status })
          return { body, status: res.status, ok: true }
        }
        /*
          Don't fail over on 429 (retried above) but DO fail over on other
          4xx: the mirrors are different implementations (a self-hosted worker
          vs saavn.sumit.co), so a 404 from one does not mean the other lacks
          the endpoint. Server errors fail over as before.
        */
        lastError = new Error(`HTTP ${res.status}`)
        if (res.status !== 429 && res.status < 500 && base === API_BASES[API_BASES.length - 1]) {
          return { body: await res.text(), status: res.status, ok: false }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        lastError = e
      }
    }
    // Every mirror failed — trip the breaker so the next calls fast-fail.
    downUntil = Date.now() + BREAKER_MS
    throw lastError instanceof Error ? lastError : new Error('All music API mirrors are unavailable')
  } finally {
    release()
  }
}

/** GETs already on the wire, so identical concurrent requests share one fetch
 *  instead of stampeding an API that rate-limits at ~20 concurrent. */
const pending = new Map<string, Promise<{ body: string; status: number; ok: boolean }>>()

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const cacheable = !init?.method || init.method === 'GET'
  if (!cacheable) return fetchThroughMirrors(url, init).then((r) => new Response(r.body, { status: r.status }))

  const hit = responseCache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL) return new Response(hit.body, { status: hit.status })

  // Only share requests that carry no abort signal — a shared promise tied to
  // one caller's signal would reject for everyone when that caller aborts.
  if (init?.signal) {
    const r = await fetchThroughMirrors(url, init)
    return new Response(r.body, { status: r.status })
  }

  let inFlight = pending.get(url)
  if (!inFlight) {
    inFlight = fetchThroughMirrors(url, init).finally(() => pending.delete(url))
    pending.set(url, inFlight)
  }
  const r = await inFlight
  return new Response(r.body, { status: r.status })
}

interface RawImage { quality: string; url: string }
interface RawDownloadUrl { quality: string; url: string }
interface RawArtistRef { id: string; name: string; role?: string; image?: RawImage[] }
interface RawSong {
  id: string
  name: string
  title?: string
  duration?: number
  playCount?: number
  image?: RawImage[]
  downloadUrl?: RawDownloadUrl[]
  artists?: { primary?: RawArtistRef[] }
  primaryArtists?: string
  album?: { id?: string; name?: string }
}

interface RawArtist {
  id: string
  name: string
  image?: RawImage[]
  followerCount?: number
  bio?: string
  topSongs?: RawSong[]
}

interface RawAlbum {
  id: string
  name: string
  title?: string
  image?: RawImage[]
  artist?: string | { primary?: RawArtistRef[] }
  songCount?: number
  description?: string
  songs?: RawSong[]
}

const getBestImage = (img?: RawImage[]): string | undefined => {
  if (!img || !img.length) return undefined
  // prefer highest resolution (usually index 2 is 500x500)
  return img[2]?.url || img[1]?.url || img[0]?.url
}

/**
 * Pick the best stream at or below the user's chosen quality, so "Data Saver"
 * genuinely fetches the smaller file instead of being decorative.
 *
 * Matched on the `quality` FIELD ("320kbps"), never on array position — the
 * mirrors are different implementations and nothing guarantees the ladder's
 * order or length, and indexing a differently-ordered ladder silently served
 * 12kbps to users who chose 320.
 */
const getBestAudioUrl = (urls?: RawDownloadUrl[]): string | undefined => {
  if (!urls?.length) return undefined
  const want = Number(getQuality() satisfies Quality)
  const parsed = urls
    .filter((u) => u?.url)
    .map((u) => ({ url: u.url, kbps: parseInt(u.quality, 10) }))

  const usable = parsed.filter((u) => Number.isFinite(u.kbps)).sort((a, b) => b.kbps - a.kbps)
  // highest at-or-below the preference, else the lowest available
  const best = usable.find((u) => u.kbps <= want) ?? usable[usable.length - 1]
  return best?.url ?? parsed[0]?.url
}

/**
 * Identity key for de-duplication. Credit strings for the same recording come
 * back in different orders across endpoints ("Vishal Mishra, Mithoon, Asees
 * Kaur" vs "Mithoon, Vishal Mishra, Asees Kaur"), so the names are sorted
 * before comparing.
 */
const identityOf = (t: Track): string =>
  `${t.title.trim().toLowerCase()}|${t.artist
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',')}`

const getArtistName = (s: RawSong): string => {
  if (s.artists?.primary?.length) {
    return s.artists.primary.map((a) => a.name).join(', ')
  }
  if (typeof s.primaryArtists === 'string' && s.primaryArtists.trim()) {
    return s.primaryArtists
  }
  return 'Unknown Artist'
}

const toTrack = (s: RawSong): Track => ({
  id: s.id,
  title: s.name || s.title || 'Untitled',
  artist: getArtistName(s),
  artwork: getBestImage(s.image),
  duration: s.duration ? Number(s.duration) : 0,
  playCount: s.playCount ? Number(s.playCount) : undefined,
  source: 'jiosaavn',
})

const toArtist = (a: RawArtist): Artist => ({
  id: a.id,
  name: a.name,
  avatar: getBestImage(a.image),
  followers: a.followerCount,
  bio: a.bio,
  source: 'jiosaavn',
})

const toCollection = (c: RawAlbum, kind: 'album' | 'playlist' = 'album'): Collection => ({
  id: c.id,
  title: c.name || c.title || 'Playlist',
  description: c.description,
  artwork: getBestImage(c.image),
  owner: typeof c.artist === 'string' ? c.artist : c.artist?.primary?.[0]?.name,
  trackCount: c.songCount || c.songs?.length,
  kind,
  source: 'jiosaavn',
})

export const jiosaavnSource: MusicSource = {
  id: 'jiosaavn',
  name: 'JioSaavn (Bollywood & Global)',
  downloadable: true,

  async trending(limit = 40): Promise<Track[]> {
    const categories = ['Bollywood Hits', 'Punjabi Hits', 'Hindi Trending', 'English Hits', 'Pop Hits']

    // These five requests are independent. Running them in sequence made the
    // very first paint of the app wait on five round-trips stacked end to end.
    const settled = await Promise.allSettled(
      categories.map(async (cat) => {
        const res = await apiFetch(`${API_BASE}/search/songs?query=${encodeURIComponent(cat)}&limit=15`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        return (json.data?.results || json.data || []) as RawSong[]
      }),
    )

    const results: Track[] = []
    /*
      De-dupe on title + artist, not on artwork and not on id.

      Artwork was the old key, which collapsed distinct songs that happen to
      share an album cover. But id alone isn't enough either: the same
      recording is indexed under several ids across compilations, so the five
      category searches routinely put one song in the shelf two or three times.
    */
    const seen = new Set<string>()

    for (const outcome of settled) {
      if (outcome.status !== 'fulfilled') continue
      for (const raw of outcome.value) {
        if (results.length >= limit) break
        const track = toTrack(raw)
        const key = identityOf(track)
        if (seen.has(key)) continue
        seen.add(key)
        results.push(track)
      }
    }

    if (!results.length) {
      throw new SourceError(
        'Could not load trending music from JioSaavn',
        settled.find((o) => o.status === 'rejected'),
      )
    }
    return results
  },

  async search(query: string, signal?: AbortSignal): Promise<SearchResults> {
    const q = encodeURIComponent(query.trim())
    try {
      const res = await apiFetch(`${API_BASE}/search?query=${q}`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const data = json.data || {}

      const rawTracks = (data.songs?.results || []) as RawSong[]
      const rawArtists = (data.artists?.results || []) as RawArtist[]
      const rawAlbums = (data.albums?.results || []) as RawAlbum[]
      const rawPlaylists = (data.playlists?.results || []) as RawAlbum[]

      return {
        tracks: rawTracks.map(toTrack),
        artists: rawArtists.map(toArtist),
        collections: [
          ...rawAlbums.map((a) => toCollection(a, 'album')),
          ...rawPlaylists.map((p) => toCollection(p, 'playlist')),
        ],
      }
    } catch (e) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw new SourceError(`Search failed for "${query}"`, e)
    }
  },

  /**
   * The combined /search endpoint returns exactly 3 songs regardless of how
   * many match (4,491 for "Arijit Singh"). /search/songs honours `limit`, so
   * anything that needs a real list of tracks has to come through here.
   */
  async searchTracks(query: string, limit = 30, signal?: AbortSignal): Promise<Track[]> {
    const res = await apiFetch(
      `${API_BASE}/search/songs?query=${encodeURIComponent(query.trim())}&limit=${limit}`,
      { signal },
    )
    if (!res.ok) throw new SourceError(`Song search failed for "${query}"`)
    const json = await res.json()
    const list = (json.data?.results || json.data || []) as RawSong[]
    return list.map(toTrack)
  },

  /** Curated playlists for a genre/mood term — the backbone of the discovery shelves. */
  async searchPlaylists(query: string, limit = 10, signal?: AbortSignal): Promise<Collection[]> {
    const res = await apiFetch(
      `${API_BASE}/search/playlists?query=${encodeURIComponent(query.trim())}&limit=${limit}`,
      { signal },
    )
    if (!res.ok) throw new SourceError(`Playlist search failed for "${query}"`)
    const json = await res.json()
    const list = (json.data?.results || json.data || []) as RawAlbum[]
    return list.map((p) => toCollection(p, 'playlist'))
  },

  async searchArtists(query: string, limit = 10, signal?: AbortSignal): Promise<Artist[]> {
    const res = await apiFetch(
      `${API_BASE}/search/artists?query=${encodeURIComponent(query.trim())}&limit=${limit}`,
      { signal },
    )
    if (!res.ok) throw new SourceError(`Artist search failed for "${query}"`)
    const json = await res.json()
    const list = (json.data?.results || json.data || []) as RawArtist[]
    return list.map(toArtist)
  },

  async track(id: string): Promise<Track | null> {
    try {
      const res = await apiFetch(`${API_BASE}/songs/${id}`)
      if (!res.ok) return null
      const json = await res.json()
      const raw = json.data?.[0] as RawSong | undefined
      return raw ? toTrack(raw) : null
    } catch {
      return null
    }
  },

  async artist(id: string): Promise<{ artist: Artist; tracks: Track[] } | null> {
    try {
      const res = await apiFetch(`${API_BASE}/artists/${id}`)
      if (!res.ok) return null
      const json = await res.json()
      const data = json.data as RawArtist | undefined
      if (!data) return null
      const tracks = (data.topSongs || []).map(toTrack)
      return { artist: toArtist(data), tracks }
    } catch {
      return null
    }
  },

  async collection(id: string): Promise<{ collection: Collection; tracks: Track[] } | null> {
    // An id may be an album OR a playlist, and the API returns 200 for the wrong
    // kind too — just with no songs. So `res.ok` can't decide which it is; fetch
    // both and keep whichever actually has tracks. (This was the "playlist is
    // empty" bug: /albums?id=<playlistId> 200s empty, so we never tried
    // /playlists?id=.)
    const fetchKind = async (
      path: 'albums' | 'playlists',
      kind: 'album' | 'playlist',
    ): Promise<{ collection: Collection; tracks: Track[] } | null> => {
      try {
        const res = await apiFetch(`${API_BASE}/${path}?id=${encodeURIComponent(id)}&limit=100`)
        if (!res.ok) return null
        const data = (await res.json()).data as RawAlbum | undefined
        if (!data) return null
        return { collection: toCollection(data, kind), tracks: (data.songs || []).map(toTrack) }
      } catch {
        return null
      }
    }

    const album = await fetchKind('albums', 'album')
    if (album?.tracks.length) return album

    const playlist = await fetchKind('playlists', 'playlist')
    if (playlist?.tracks.length) return playlist

    // Neither had songs — return whatever metadata we got (so the header still
    // renders) rather than a hard "not found".
    return playlist ?? album
  },

  /*
    This used to be a single `search/albums?query=Trending`, which is a literal
    keyword search — so the "Featured" shelf filled up with albums that merely
    have the word "Trending" in their title ("Trending Nakhra", "Bolbam
    Trending Song", "Trending Bollywood 1 Min Mix"). Seeding with real genre
    terms returns actual albums instead.
  */
  async featuredCollections(limit = 12): Promise<Collection[]> {
    const seeds = ['Bollywood', 'Punjabi', 'Romantic Hits', 'Party Anthems']
    const perSeed = Math.max(3, Math.ceil(limit / seeds.length))

    const settled = await Promise.allSettled(
      seeds.map(async (seed) => {
        const res = await apiFetch(
          `${API_BASE}/search/albums?query=${encodeURIComponent(seed)}&limit=${perSeed}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        return (json.data?.results || json.data || []) as RawAlbum[]
      }),
    )

    const out: Collection[] = []
    const seen = new Set<string>()
    for (const outcome of settled) {
      if (outcome.status !== 'fulfilled') continue
      for (const raw of outcome.value) {
        if (out.length >= limit) return out
        const c = toCollection(raw)
        const key = c.title.trim().toLowerCase()
        if (!c.id || seen.has(key)) continue
        seen.add(key)
        out.push(c)
      }
    }
    return out
  },

  async streamUrl(track: Track): Promise<string> {
    try {
      // fetch song details to get the high quality direct audio URL
      const res = await apiFetch(`${API_BASE}/songs/${track.id}`)
      if (!res.ok) throw new Error('Song details unavailable')
      const json = await res.json()
      const raw = json.data?.[0] as RawSong | undefined
      const url = getBestAudioUrl(raw?.downloadUrl)
      if (!url) throw new Error('Audio stream URL not found')
      return url
    } catch (e) {
      throw new SourceError(`Could not resolve stream URL for track ${track.title}`, e)
    }
  },

  async downloadUrl(track: Track): Promise<string> {
    return this.streamUrl(track)
  },
}
