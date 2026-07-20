import type { MusicSource } from './source'
import { SourceError } from './source'
import type { Track, Artist, Collection, SearchResults } from '@/types'

const APP_NAME = 'ListenFreeClone'
const DISCOVERY = 'https://api.audius.co'

/**
 * Audius is a decentralized network — there is no single API host. You ask the
 * discovery endpoint for a list of healthy nodes and pick one. We cache the
 * choice and fail over to the next node when a request errors.
 */
let hostPool: string[] = []
let hostIndex = 0
let hostPromise: Promise<string[]> | null = null

async function loadHosts(): Promise<string[]> {
  if (hostPool.length) return hostPool
  if (!hostPromise) {
    hostPromise = fetch(DISCOVERY)
      .then((r) => r.json())
      .then((j: { data?: string[] }) => {
        if (!j.data?.length) throw new SourceError('Audius returned no hosts')
        hostPool = j.data
        return hostPool
      })
      .catch((e) => {
        hostPromise = null
        throw new SourceError('Could not reach the Audius discovery service', e)
      })
  }
  return hostPromise
}

async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const hosts = await loadHosts()
  let lastError: unknown

  // try up to 3 nodes before giving up
  for (let attempt = 0; attempt < Math.min(3, hosts.length); attempt++) {
    const host = hosts[(hostIndex + attempt) % hosts.length]
    const sep = path.includes('?') ? '&' : '?'
    try {
      const res = await fetch(`${host}/v1${path}${sep}app_name=${APP_NAME}`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // node worked — make it the preferred one
      hostIndex = (hostIndex + attempt) % hosts.length
      return (await res.json()) as T
    } catch (e) {
      if (signal?.aborted) throw e
      lastError = e
    }
  }
  throw new SourceError(`Audius request failed: ${path}`, lastError)
}

/* ---------- raw response shapes (only the fields we consume) ---------- */

interface RawArtwork { '150x150'?: string; '480x480'?: string; '1000x1000'?: string }
interface RawUser {
  id: string
  name: string
  handle: string
  follower_count?: number
  bio?: string
  profile_picture?: RawArtwork
}
interface RawTrack {
  id: string
  title: string
  duration: number
  genre?: string
  play_count?: number
  user: RawUser
  artwork?: RawArtwork
}
interface RawPlaylist {
  id: string
  playlist_name: string
  description?: string
  total_play_count?: number
  track_count?: number
  user?: RawUser
  artwork?: RawArtwork
}

const art = (a?: RawArtwork) => a?.['480x480'] ?? a?.['1000x1000'] ?? a?.['150x150']

const toTrack = (t: RawTrack): Track => ({
  id: t.id,
  title: t.title,
  artist: t.user?.name || t.user?.handle || 'Unknown artist',
  artistId: t.user?.id,
  artwork: art(t.artwork),
  duration: t.duration ?? 0,
  genre: t.genre,
  playCount: t.play_count,
  source: 'audius',
})

const toArtist = (u: RawUser): Artist => ({
  id: u.id,
  name: u.name || u.handle,
  avatar: art(u.profile_picture),
  followers: u.follower_count,
  bio: u.bio,
  source: 'audius',
})

const toCollection = (p: RawPlaylist): Collection => ({
  id: p.id,
  title: p.playlist_name,
  description: p.description,
  artwork: art(p.artwork),
  owner: p.user?.name || p.user?.handle,
  trackCount: p.track_count,
  source: 'audius',
})

/* ---------------------------- adapter ---------------------------- */

export const audiusSource: MusicSource = {
  id: 'audius',
  name: 'Audius',
  // Audius serves plain mp3 over HTTP with permissive CORS, so offline caching
  // is both technically possible and licensed by the uploading artists.
  downloadable: true,

  async trending(limit = 40) {
    const { data } = await api<{ data: RawTrack[] }>(`/tracks/trending?limit=${limit}`)
    return (data ?? []).map(toTrack)
  },

  async search(query, signal) {
    const q = encodeURIComponent(query)
    const [tracks, users, playlists] = await Promise.allSettled([
      api<{ data: RawTrack[] }>(`/tracks/search?query=${q}&limit=30`, signal),
      api<{ data: RawUser[] }>(`/users/search?query=${q}&limit=12`, signal),
      api<{ data: RawPlaylist[] }>(`/playlists/search?query=${q}&limit=12`, signal),
    ])
    // allSettled turns an abort into a *successful* empty result, so a
    // cancelled request would resolve with nothing and overwrite live results.
    // Surface the abort instead and let the caller discard it.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const val = <T>(r: PromiseSettledResult<{ data: T[] }>): T[] =>
      r.status === 'fulfilled' ? (r.value.data ?? []) : []

    return {
      tracks: val<RawTrack>(tracks).map(toTrack),
      artists: val<RawUser>(users).map(toArtist),
      collections: val<RawPlaylist>(playlists).map(toCollection),
    } satisfies SearchResults
  },

  async track(id) {
    const { data } = await api<{ data: RawTrack }>(`/tracks/${id}`)
    return data ? toTrack(data) : null
  },

  async artist(id) {
    const [user, tracks] = await Promise.all([
      api<{ data: RawUser }>(`/users/${id}`),
      api<{ data: RawTrack[] }>(`/users/${id}/tracks?limit=50`),
    ])
    if (!user.data) return null
    return { artist: toArtist(user.data), tracks: (tracks.data ?? []).map(toTrack) }
  },

  async collection(id) {
    const [pl, tracks] = await Promise.all([
      api<{ data: RawPlaylist[] }>(`/playlists/${id}`),
      api<{ data: RawTrack[] }>(`/playlists/${id}/tracks`),
    ])
    const head = pl.data?.[0]
    if (!head) return null
    return { collection: toCollection(head), tracks: (tracks.data ?? []).map(toTrack) }
  },

  async featuredCollections(limit = 12) {
    const { data } = await api<{ data: RawPlaylist[] }>(`/playlists/trending?limit=${limit}`)
    return (data ?? []).map(toCollection)
  },

  async downloadUrl(track) {
    // Deliberately NOT the resolved node: the content node rejects a direct
    // cross-origin fetch, while this endpoint redirects to it and fetch()
    // follows that redirect with CORS intact.
    const hosts = await loadHosts()
    return `${hosts[hostIndex]}/v1/tracks/${track.id}/stream?app_name=${APP_NAME}`
  },

  async streamUrl(track) {
    const hosts = await loadHosts()
    const endpoint = `${hosts[hostIndex]}/v1/tracks/${track.id}/stream?app_name=${APP_NAME}`

    // /stream 302-redirects to whichever validator node holds the audio.
    // <audio> will NOT follow that redirect (it fails with MEDIA_ERR_SRC_NOT_SUPPORTED),
    // so resolve it ourselves first.
    //
    // A `Range` header would be the obvious way to avoid pulling the file, but
    // it forces a CORS preflight that Audius rejects. Instead: fetch resolves as
    // soon as the headers land, so read res.url and cancel the body immediately —
    // nothing beyond the first buffer is ever transferred.
    try {
      const res = await fetch(endpoint)
      void res.body?.cancel()
      if (!res.ok) throw new SourceError(`Stream unavailable (HTTP ${res.status})`)
      return res.url || endpoint
    } catch (e) {
      if (e instanceof SourceError) throw e
      // network hiccup while resolving — let the element try the redirect itself
      return endpoint
    }
  },
}
