/** Normalized shapes the whole app speaks. Adapters translate into these. */

export interface Track {
  id: string
  title: string
  artist: string
  artistId?: string
  artwork?: string
  /** seconds */
  duration: number
  genre?: string
  playCount?: number
  /** which adapter produced this track — used to resolve stream urls later */
  source: string
}

export interface Artist {
  id: string
  name: string
  avatar?: string
  followers?: number
  bio?: string
  source: string
}

export interface Collection {
  id: string
  title: string
  description?: string
  artwork?: string
  owner?: string
  trackCount?: number
  /** album = one release, playlist = a curated set. Drives the card's badge. */
  kind?: 'album' | 'playlist'
  source: string
}

export interface SearchResults {
  tracks: Track[]
  artists: Artist[]
  collections: Collection[]
}
