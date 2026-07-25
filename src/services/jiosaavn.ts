import type { MusicSource } from './source'
import { SourceError } from './source'
import type { Track, Artist, Collection, SearchResults } from '@/types'
import { getQuality, type Quality } from '@/lib/prefs'

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
    ? // On Vercel: go through our own same-origin edge proxy (no CORS, CDN-cached
      // so the upstream is barely hit). Public mirrors are a last resort.
      ['/api/saavn', 'https://saavn.sumit.co/api', 'https://saavn.dev/api']
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
const responseCache = new Map<string, { at: number; body: string; status: number }>()

/** One mirror, with a couple of backoff retries for 429 / transient failures. */
async function fetchWithRetry(target: string, init?: RequestInit, attempts = 2): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const res = await fetch(target, init)
      if (res.status === 429 && attempt < attempts) {
        await sleep(500 * (attempt + 1) + Math.random() * 300)
        continue
      }
      return res
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      if (attempt < attempts) {
        await sleep(500 * (attempt + 1) + Math.random() * 300)
        continue
      }
      throw e
    }
  }
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const cacheable = !init?.method || init.method === 'GET'
  if (cacheable) {
    const hit = responseCache.get(url)
    if (hit && Date.now() - hit.at < CACHE_TTL) return new Response(hit.body, { status: hit.status })
  }

  await acquire()
  try {
    let lastError: unknown
    for (const base of API_BASES) {
      const target = base === API_BASE ? url : url.replace(API_BASE, base)
      try {
        const res = await fetchWithRetry(target, init)
        if (res.ok) {
          if (cacheable) {
            const body = await res.text()
            responseCache.set(url, { at: Date.now(), body, status: res.status })
            return new Response(body, { status: res.status })
          }
          return res
        }
        // 4xx (not-found/bad request) is the same on every mirror — don't waste
        // time failing over. Only rate-limits and server errors get another try.
        if (res.status !== 429 && res.status < 500) return res
        lastError = new Error(`HTTP ${res.status}`)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        lastError = e
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All music API mirrors are unavailable')
  } finally {
    release()
  }
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
 * JioSaavn returns a fixed ladder of bitrates: 12, 48, 96, 160, 320 kbps.
 * Start at whatever the user chose in Settings and walk down from there, so
 * "Data Saver" genuinely fetches the smaller file instead of being decorative.
 */
const QUALITY_INDEX: Record<Quality, number> = { '320': 4, '160': 3, '96': 2 }

const getBestAudioUrl = (urls?: RawDownloadUrl[]): string | undefined => {
  if (!urls?.length) return undefined
  const start = QUALITY_INDEX[getQuality()]
  for (let i = start; i >= 0; i--) {
    if (urls[i]?.url) return urls[i].url
  }
  // the ladder was shorter than expected — take whatever exists
  return urls.find((u) => u?.url)?.url
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
    try {
      // try album first, then playlist
      let kind: 'album' | 'playlist' = 'album'
      let res = await apiFetch(`${API_BASE}/albums?id=${id}`)
      if (!res.ok) {
        res = await apiFetch(`${API_BASE}/playlists?id=${id}`)
        kind = 'playlist'
      }
      if (!res.ok) return null
      const json = await res.json()
      const data = json.data as RawAlbum | undefined
      if (!data) return null
      const tracks = (data.songs || []).map(toTrack)
      return { collection: toCollection(data, kind), tracks }
    } catch {
      return null
    }
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
