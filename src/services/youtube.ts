import type { MusicSource } from './source'
import { SourceError } from './source'
import type { Track, Artist, Collection } from '@/types'
import { withTimeout } from '@/lib/net'

const BASE = 'https://www.googleapis.com/youtube/v3'
const KEY = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined

/**
 * YouTube Data API v3 adapter — the universal catalog.
 *
 * `downloadable: false` is the important line. Caching YouTube audio is not
 * permitted under any circumstances, and the flag makes that enforceable in
 * code: every download control in the UI hides itself for these tracks rather
 * than relying on anyone remembering the rule.
 *
 * Quota reality: the free tier is 10,000 units/day and a search costs 100, so
 * roughly 100 searches per day per key. Results are cached in-session below to
 * stretch that. A production deployment needs a quota increase or a
 * server-side cache — this is the real constraint on this adapter, not latency.
 */

const searchCache = new Map<string, { tracks: Track[]; at: number }>()
const CACHE_TTL = 10 * 60 * 1000

function requireKey(): string {
  if (!KEY) {
    throw new SourceError(
      'VITE_YOUTUBE_API_KEY is not set — get a free key from console.cloud.google.com and enable YouTube Data API v3',
    )
  }
  return KEY
}

async function api<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams({ key: requireKey(), ...params })
  const res = await fetch(`${BASE}${path}?${qs}`, { signal: withTimeout(signal) })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string; errors?: { reason?: string }[] }
    } | null
    const reason = body?.error?.errors?.[0]?.reason
    if (reason === 'quotaExceeded') {
      throw new SourceError('YouTube daily quota exhausted — try again tomorrow or raise the quota')
    }
    throw new SourceError(body?.error?.message ?? `YouTube HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

/* ---- response shapes (only the fields consumed) ---- */

interface SearchItem {
  id: { videoId?: string; channelId?: string; playlistId?: string }
  snippet: {
    title: string
    channelTitle: string
    channelId: string
    description?: string
    thumbnails?: Record<string, { url: string }>
  }
}
interface VideoItem {
  id: string
  snippet: { title: string; channelTitle: string; channelId: string; thumbnails?: Record<string, { url: string }> }
  contentDetails?: { duration?: string }
  statistics?: { viewCount?: string }
}

const thumb = (t?: Record<string, { url: string }>) =>
  t?.maxres?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url

/** ISO-8601 duration (PT4M13S) -> seconds. */
function parseDuration(iso?: string): number {
  if (!iso) return 0
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/**
 * YouTube titles are messy for a music UI: "Artist - Song (Official Video)".
 * Split off the artist when the convention is followed, and drop the noise.
 */
function cleanTitle(raw: string, channel: string): { title: string; artist: string } {
  const noise =
    /\s*[([]\s*(official\s*(music\s*)?(video|audio|lyric[s]?\s*video)?|lyrics?|hd|4k|remastered|visualizer|mv|m\/v)\s*[)\]]\s*/gi
  let t = raw.replace(noise, ' ').replace(/\s+/g, ' ').trim()

  const dash = t.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/)
  if (dash) return { title: dash[2].trim(), artist: dash[1].trim() }

  // channels are often "<Artist>VEVO" or "<Artist> - Topic"
  const artist = channel.replace(/VEVO$/i, '').replace(/\s*-\s*Topic$/i, '').trim()
  return { title: t, artist: artist || channel }
}

const toTrack = (v: VideoItem): Track => {
  const { title, artist } = cleanTitle(v.snippet.title, v.snippet.channelTitle)
  return {
    id: v.id,
    title,
    artist,
    artistId: v.snippet.channelId,
    artwork: thumb(v.snippet.thumbnails),
    duration: parseDuration(v.contentDetails?.duration),
    playCount: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
    source: 'youtube',
  }
}

/**
 * search returns ids without duration; a second videos.list call fills them in
 * for 1 quota unit total. Worth it — Heardle needs real durations, and so does
 * the scrubber.
 */
async function hydrate(ids: string[], signal?: AbortSignal): Promise<Track[]> {
  if (!ids.length) return []
  const { items } = await api<{ items: VideoItem[] }>(
    '/videos',
    { part: 'snippet,contentDetails,statistics', id: ids.join(','), maxResults: '50' },
    signal,
  )
  return (items ?? []).map(toTrack)
}

export const youtubeSource: MusicSource = {
  id: 'youtube',
  name: 'YouTube',
  // Never cache YouTube audio — not permitted. The UI reads this flag and
  // hides every download affordance for these tracks.
  downloadable: false,

  async trending(limit = 40) {
    const { items } = await api<{ items: VideoItem[] }>('/videos', {
      part: 'snippet,contentDetails,statistics',
      chart: 'mostPopular',
      videoCategoryId: '10', // Music
      regionCode: (import.meta.env.VITE_YOUTUBE_REGION as string) || 'IN',
      maxResults: String(Math.min(limit, 50)),
    })
    return (items ?? []).map(toTrack)
  },

  async search(query, signal) {
    const key = query.trim().toLowerCase()
    const hit = searchCache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      return { tracks: hit.tracks, artists: [], collections: [] }
    }

    const { items } = await api<{ items: SearchItem[] }>(
      '/search',
      {
        part: 'snippet',
        q: query,
        type: 'video',
        videoCategoryId: '10',
        maxResults: '25',
      },
      signal,
    )
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const ids = (items ?? []).map((i) => i.id.videoId).filter((v): v is string => !!v)
    const tracks = await hydrate(ids, signal)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    searchCache.set(key, { tracks, at: Date.now() })

    // Artists/playlists would each cost another 100 quota units per keystroke's
    // worth of search. Not worth it against a 100-search/day budget.
    return { tracks, artists: [] as Artist[], collections: [] as Collection[] }
  },

  async track(id) {
    const [t] = await hydrate([id])
    return t ?? null
  },

  async artist(id) {
    const { items } = await api<{ items: SearchItem[] }>('/search', {
      part: 'snippet',
      channelId: id,
      type: 'video',
      order: 'viewCount',
      maxResults: '25',
    })
    const ids = (items ?? []).map((i) => i.id.videoId).filter((v): v is string => !!v)
    const tracks = await hydrate(ids)
    if (!tracks.length) return null
    return {
      artist: {
        id,
        name: tracks[0].artist,
        avatar: tracks[0].artwork,
        source: 'youtube',
      },
      tracks,
    }
  },

  async collection(id) {
    const { items } = await api<{ items: { contentDetails?: { videoId?: string }; snippet?: { title?: string } }[] }>(
      '/playlistItems',
      { part: 'snippet,contentDetails', playlistId: id, maxResults: '50' },
    )
    const ids = (items ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter((v): v is string => !!v)
    const tracks = await hydrate(ids)
    if (!tracks.length) return null
    return {
      collection: { id, title: items?.[0]?.snippet?.title ?? 'Playlist', source: 'youtube' },
      tracks,
    }
  },

  async featuredCollections() {
    // Not exposed: there is no cheap "featured playlists" endpoint, and search
    // would cost 100 units per call. Home falls back to trending.
    return []
  },

  async streamUrl(track) {
    // Playback goes through the IFrame player, never a media URL. Returning the
    // watch URL keeps the contract honest for anything that logs or shares it.
    return `https://www.youtube.com/watch?v=${track.id}`
  },
}
