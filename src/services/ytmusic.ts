import type { Track } from '@/types'

/**
 * YouTube Music discovery, via our server bridge (see api/ytmusic.ts).
 *
 * This enriches search/discovery with YouTube's much larger catalog. Tracks
 * come back with source:"youtube", so they play through the existing iframe
 * engine — JioSaavn remains the source for background-capable audio. Every call
 * degrades to an empty result if the bridge is unavailable, so the app never
 * breaks when YouTube Music can't be reached.
 */
const BASE = (import.meta.env.VITE_YTMUSIC_API as string | undefined)?.replace(/\/$/, '') || '/api/ytmusic'

interface YtThumbnail {
  url: string
  width?: number
  height?: number
}
interface YtSong {
  videoId: string
  name: string
  artist?: { name?: string }
  artists?: Array<{ name?: string }>
  duration?: number
  thumbnails?: YtThumbnail[]
}

/** Thumbnails come smallest-first; the last is the highest resolution. */
function bestThumbnail(thumbs?: YtThumbnail[]): string | undefined {
  if (!thumbs?.length) return undefined
  return thumbs[thumbs.length - 1]?.url
}

async function call<T>(action: string, q: string, signal?: AbortSignal): Promise<T[]> {
  try {
    const res = await fetch(`${BASE}?action=${action}&q=${encodeURIComponent(q.trim())}`, { signal })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: T[] }
    return json.data ?? []
  } catch {
    // bridge unavailable (e.g. not deployed) — discovery just falls back to JioSaavn
    return []
  }
}

export const ytmusic = {
  /** True once we've had at least one successful response, so the UI can hide
   *  the section entirely when the bridge isn't there. Best-effort. */
  async searchTracks(query: string, signal?: AbortSignal): Promise<Track[]> {
    if (!query.trim()) return []
    const songs = await call<YtSong>('searchSongs', query, signal)
    return songs
      .filter((s) => s.videoId)
      .map((s) => ({
        id: s.videoId,
        title: s.name || 'Untitled',
        artist:
          s.artist?.name ||
          s.artists?.map((a) => a.name).filter(Boolean).join(', ') ||
          'Unknown Artist',
        artwork: bestThumbnail(s.thumbnails),
        duration: s.duration ?? 0,
        source: 'youtube',
      }))
  },
}
