import type { Track, Artist, Collection, SearchResults } from '@/types'

/**
 * Every catalog backend implements this. The rest of the app never imports an
 * adapter directly — it goes through `getSource()` in ./index.ts.
 *
 * Swapping catalogs (Audius -> Jamendo -> Spotify -> your own licensed CDN)
 * means writing one file that satisfies this interface. Nothing else changes.
 */
export interface MusicSource {
  /** stable key, also stamped onto every Track.source */
  readonly id: string
  readonly name: string
  /** false when tracks are DRM'd / embed-only and cannot be cached offline */
  readonly downloadable: boolean

  trending(limit?: number): Promise<Track[]>
  search(query: string, signal?: AbortSignal): Promise<SearchResults>
  track(id: string): Promise<Track | null>
  artist(id: string): Promise<{ artist: Artist; tracks: Track[] } | null>
  collection(id: string): Promise<{ collection: Collection; tracks: Track[] } | null>
  featuredCollections(limit?: number): Promise<Collection[]>
  /**
   * A directly playable URL for an <audio> element. May need redirects
   * pre-resolved, since media elements refuse to follow them.
   */
  streamUrl(track: Track): Promise<string>

  /**
   * URL to fetch() when caching for offline use. Defaults to streamUrl.
   *
   * These are deliberately separate: a pre-resolved CDN node can be playable by
   * <audio> yet reject a cross-origin fetch(), while the un-resolved endpoint
   * fetches fine because fetch follows redirects and returns CORS headers.
   */
  downloadUrl?(track: Track): Promise<string>
}

export class SourceError extends Error {
  readonly detail?: unknown

  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'SourceError'
    this.detail = detail
  }
}
