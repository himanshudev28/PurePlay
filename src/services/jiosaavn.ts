import type { MusicSource } from './source'
import { SourceError } from './source'
import type { Track, Artist, Collection, SearchResults } from '@/types'
import { getQuality, type Quality } from '@/lib/prefs'

const API_BASE = 'https://saavn.sumit.co/api'

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
        const res = await fetch(`${API_BASE}/search/songs?query=${encodeURIComponent(cat)}&limit=15`)
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
      const res = await fetch(`${API_BASE}/search?query=${q}`, { signal })
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
    const res = await fetch(
      `${API_BASE}/search/songs?query=${encodeURIComponent(query.trim())}&limit=${limit}`,
      { signal },
    )
    if (!res.ok) throw new SourceError(`Song search failed for "${query}"`)
    const json = await res.json()
    const list = (json.data?.results || json.data || []) as RawSong[]
    return list.map(toTrack)
  },

  async track(id: string): Promise<Track | null> {
    try {
      const res = await fetch(`${API_BASE}/songs/${id}`)
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
      const res = await fetch(`${API_BASE}/artists/${id}`)
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
      let res = await fetch(`${API_BASE}/albums?id=${id}`)
      if (!res.ok) {
        res = await fetch(`${API_BASE}/playlists?id=${id}`)
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
        const res = await fetch(
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
      const res = await fetch(`${API_BASE}/songs/${track.id}`)
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
