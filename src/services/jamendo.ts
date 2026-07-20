import type { MusicSource } from './source'
import { SourceError } from './source'
import type { Track, Artist, Collection } from '@/types'

const BASE = 'https://api.jamendo.com/v3.0'
const CLIENT_ID = import.meta.env.VITE_JAMENDO_CLIENT_ID as string | undefined

/**
 * Second adapter — proves the interface is real and not Audius-shaped.
 * Everything here is Creative Commons licensed, so downloads are unambiguous.
 *
 * Needs a free client id from https://devportal.jamendo.com
 * Set VITE_JAMENDO_CLIENT_ID in .env.local, then VITE_MUSIC_SOURCE=jamendo.
 */

async function api<T>(path: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T> {
  if (!CLIENT_ID) throw new SourceError('VITE_JAMENDO_CLIENT_ID is not set')
  const qs = new URLSearchParams({
    client_id: CLIENT_ID,
    format: 'json',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })
  const res = await fetch(`${BASE}${path}?${qs}`, { signal })
  if (!res.ok) throw new SourceError(`Jamendo HTTP ${res.status}`)
  const json = (await res.json()) as { results?: T; headers?: { error_message?: string } }
  if (json.headers?.error_message) throw new SourceError(json.headers.error_message)
  return (json.results ?? []) as T
}

interface RawTrack {
  id: string
  name: string
  artist_name: string
  artist_id: string
  image?: string
  duration?: number
  audio?: string
  audiodownload?: string
}
interface RawArtist { id: string; name: string; image?: string }
interface RawAlbum { id: string; name: string; artist_name?: string; image?: string }

const toTrack = (t: RawTrack): Track => ({
  id: t.id,
  title: t.name,
  artist: t.artist_name,
  artistId: t.artist_id,
  artwork: t.image,
  duration: t.duration ?? 0,
  source: 'jamendo',
})

export const jamendoSource: MusicSource = {
  id: 'jamendo',
  name: 'Jamendo (Creative Commons)',
  downloadable: true,

  async trending(limit = 40) {
    const r = await api<RawTrack[]>('/tracks', { limit, order: 'popularity_total', include: 'musicinfo' })
    return r.map(toTrack)
  },

  async search(query, signal) {
    const [tracks, artists, albums] = await Promise.allSettled([
      api<RawTrack[]>('/tracks', { search: query, limit: 30 }, signal),
      api<RawArtist[]>('/artists', { search: query, limit: 12 }, signal),
      api<RawAlbum[]>('/albums', { search: query, limit: 12 }, signal),
    ])
    // see the note in audius.ts — an aborted request must not resolve as empty
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const ok = <T>(r: PromiseSettledResult<T[]>): T[] => (r.status === 'fulfilled' ? r.value : [])
    return {
      tracks: ok<RawTrack>(tracks).map(toTrack),
      artists: ok<RawArtist>(artists).map((a) => ({ id: a.id, name: a.name, avatar: a.image, source: 'jamendo' }) satisfies Artist),
      collections: ok<RawAlbum>(albums).map((a) => ({ id: a.id, title: a.name, owner: a.artist_name, artwork: a.image, source: 'jamendo' }) satisfies Collection),
    }
  },

  async track(id) {
    const r = await api<RawTrack[]>('/tracks', { id })
    return r[0] ? toTrack(r[0]) : null
  },

  async artist(id) {
    const [a, t] = await Promise.all([
      api<RawArtist[]>('/artists', { id }),
      api<RawTrack[]>('/artists/tracks', { id, limit: 50 }).catch(() => [] as RawTrack[]),
    ])
    if (!a[0]) return null
    return {
      artist: { id: a[0].id, name: a[0].name, avatar: a[0].image, source: 'jamendo' },
      tracks: (t as RawTrack[]).map(toTrack),
    }
  },

  async collection(id) {
    const [al, tr] = await Promise.all([
      api<RawAlbum[]>('/albums', { id }),
      api<RawTrack[]>('/tracks', { album_id: id, limit: 100 }),
    ])
    if (!al[0]) return null
    return {
      collection: { id: al[0].id, title: al[0].name, owner: al[0].artist_name, artwork: al[0].image, source: 'jamendo' },
      tracks: tr.map(toTrack),
    }
  },

  async featuredCollections(limit = 12) {
    const r = await api<RawAlbum[]>('/albums', { limit, order: 'popularity_total' })
    return r.map((a) => ({ id: a.id, title: a.name, owner: a.artist_name, artwork: a.image, source: 'jamendo' }))
  },

  async streamUrl(track) {
    const r = await api<RawTrack[]>('/tracks', { id: track.id })
    const url = r[0]?.audio ?? r[0]?.audiodownload
    if (!url) throw new SourceError('No stream available for this track')
    return url
  },
}
