import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Flame, Music, Heart, Headphones, Radio } from 'lucide-react'
import type { Track, Collection, Artist } from '@/types'
import { source } from '@/services'
import { ytmusic } from '@/services/ytmusic'
import { getFreshPicks } from '@/services/recommendations'
import { dedupeTracks } from '@/lib/shelf'
import { readDaily, writeDaily, clearDaily } from '@/lib/daily'

export const CATEGORIES = [
  { label: '🔥 Bollywood Hits', query: 'Bollywood Hits', icon: Flame },
  { label: '🎤 Arijit Singh', query: 'Arijit Singh', icon: Music },
  { label: '💃 Punjabi Beats', query: 'Punjabi Hits', icon: Radio },
  { label: '❤️ Hindi Romance', query: 'Hindi Romance', icon: Heart },
  { label: '🎧 Lo-Fi Chill', query: 'Hindi Lofi', icon: Headphones },
  { label: '🌟 Top 50 Hindi', query: 'Top 50 Hindi', icon: Sparkles },
]

/** Canonical artists for the "Popular artists" row — one clean result each.
 *  Kept short to stay light on the rate-limited public API. */
const ARTIST_SEEDS = [
  'Arijit Singh', 'Diljit Dosanjh', 'Shreya Ghoshal', 'A.R. Rahman', 'Neha Kakkar', 'Badshah',
]

/** Genre/mood → curated playlist shelves (JioSaavn editorial playlists). */
const PLAYLIST_SHELVES = [
  { title: 'Bollywood playlists', query: 'Bollywood' },
  { title: 'Punjabi playlists', query: 'Punjabi' },
  { title: 'Pop playlists', query: 'Pop' },
  { title: 'Romance', query: 'Romantic Hindi' },
]

/** Genre → song shelves. */
const SONG_SHELVES = [
  { title: 'Pop hits', query: 'Pop Hits' },
  { title: 'Punjabi hits', query: 'Punjabi Hits' },
]

/**
 * How many songs the feed asks for.
 *
 * The card home splits this three ways — quick picks, the browse shelf, and the
 * closing song block — and they have to be disjoint or the same covers appear
 * three times down one page. Forty left the last block with five entries.
 */
const FEED_SIZE = 60

export interface Shelf<T> {
  title: string
  items: T[]
}

/** Time-of-day greeting. Local hours; no name to personalize with (no auth). */
export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

/**
 * A counter that advances once per visit, used to rotate the "Fresh for you"
 * shelf. Persisted rather than random so consecutive visits are guaranteed to
 * differ — a random seed can repeat itself, and "I already saw these" is the
 * exact complaint a discovery row has to avoid.
 */
function nextRotation(): number {
  try {
    const n = (Number(localStorage.getItem('lf:picks-rotation')) || 0) + 1
    localStorage.setItem('lf:picks-rotation', String(n))
    return n
  } catch {
    return 0
  }
}

/**
 * Songs for a query — JioSaavn first (background-capable audio), falling back to
 * YouTube Music when the JioSaavn mirrors are rate-limited or down. Keeps the
 * home populated even when the primary catalog is unavailable.
 */
export async function discoverTracks(query: string, limit: number): Promise<Track[]> {
  try {
    const t = source.searchTracks
      ? await source.searchTracks(query, limit)
      : (await source.search(query)).tracks
    if (t.length) return t
  } catch {
    /* JioSaavn unavailable — fall through to YouTube Music */
  }
  return ytmusic.searchTracks(query).catch(() => [])
}

/**
 * Everything the home page shows, and the actions that reload it.
 *
 * Lives apart from the markup because there are two home layouts (the card
 * grid and the classic hero page) and only one feed — duplicating this in both
 * would have meant two sets of race guards and two daily caches to keep honest.
 */
export function useHomeFeed() {
  const [trending, setTrending] = useState<Track[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [picks, setPicks] = useState<Track[]>([])
  const [picksLoading, setPicksLoading] = useState(true)
  const [rotation, setRotation] = useState(nextRotation)
  const [artists, setArtists] = useState<Artist[]>([])
  const [playlistShelves, setPlaylistShelves] = useState<Shelf<Collection>[]>([])
  const [songShelves, setSongShelves] = useState<Shelf<Track>[]>([])
  // null = the initial trending feed; only set once the user picks a pill.
  // Booting with a category pre-"selected" showed trending content under a
  // "Bollywood Hits" heading with that pill falsely marked pressed.
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Monotonic token so a slow category response can't overwrite a newer one. */
  const loadSeq = useRef(0)

  const loadCategory = useCallback((catQuery: string) => {
    const token = ++loadSeq.current
    setLoading(true)
    setError(null)
    setActiveCategory(catQuery)

    Promise.all([discoverTracks(catQuery, FEED_SIZE), source.featuredCollections(12).catch(() => [])])
      .then(([t, c]) => {
        // two quick pill taps race — only the latest response may land
        if (token !== loadSeq.current) return
        setTrending(dedupeTracks(t).slice(0, FEED_SIZE))
        if (c.length > 0) setCollections(c)
        setError(t.length ? null : 'Could not load the catalog')
      })
      .catch((e: Error) => {
        if (token === loadSeq.current) setError(e.message)
      })
      .finally(() => {
        if (token === loadSeq.current) setLoading(false)
      })
  }, [])

  /**
   * The trending feed, cached for the calendar day.
   *
   * The catalog rotates its own category seeds daily (see `trending()` in the
   * JioSaavn adapter); this caches the result so the shelf is identical all day
   * — reload, back-navigation and a second tab all agree — and only turns over
   * at midnight. `force` skips the cache for the explicit refresh button.
   */
  const loadTrending = useCallback((force = false) => {
    const token = ++loadSeq.current
    setActiveCategory(null)
    setError(null)

    if (force) clearDaily('trending')
    const cached = force ? null : readDaily<Track[]>('trending')
    if (cached?.length) {
      // Re-spread on read: the cache predates the artwork fix, and a day-old
      // entry written before it would otherwise keep showing the clustered
      // covers until midnight.
      setTrending(dedupeTracks(cached))
      setLoading(false)
      // Collections aren't part of the daily contract, so they still refresh.
      void source.featuredCollections(12).then(
        (c) => token === loadSeq.current && c.length && setCollections(c),
        () => {},
      )
      return
    }

    setLoading(true)
    // trending() can fail hard when the JioSaavn mirrors are down; fall back to
    // YouTube Music so the home still fills instead of showing a bare error.
    Promise.all([
      source.trending(FEED_SIZE).catch(() => discoverTracks('trending songs', FEED_SIZE)),
      source.featuredCollections(12).catch(() => []),
    ])
      .then(([t, c]) => {
        if (token !== loadSeq.current) return
        const spread = dedupeTracks(t)
        setTrending(spread)
        setCollections(c)
        if (spread.length) writeDaily('trending', spread)
        setError(spread.length ? null : 'Could not load the catalog')
      })
      .catch((e: Error) => {
        if (token === loadSeq.current) setError(e.message)
      })
      .finally(() => {
        if (token === loadSeq.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadTrending()
  }, [loadTrending])

  // Discovery shelves — artists, genre playlists, genre songs — all in parallel.
  // Each is independent, so one failing never blanks the others.
  useEffect(() => {
    let active = true

    if (source.searchArtists) {
      void Promise.all(
        ARTIST_SEEDS.map((n) =>
          source.searchArtists!(n, 1)
            .then((a) => a[0] ?? null)
            .catch(() => null),
        ),
      ).then((list) => {
        if (active) setArtists(list.filter((a): a is Artist => !!a))
      })
    }

    if (source.searchPlaylists) {
      void Promise.all(
        PLAYLIST_SHELVES.map((s) =>
          source
            .searchPlaylists!(s.query, 10)
            .then((items) => ({ title: s.title, items }))
            .catch(() => ({ title: s.title, items: [] as Collection[] })),
        ),
      ).then((shelves) => {
        if (active) setPlaylistShelves(shelves.filter((s) => s.items.length > 0))
      })
    }

    void Promise.all(
      SONG_SHELVES.map((s) =>
        discoverTracks(s.query, 20).then((items) => ({ title: s.title, items: dedupeTracks(items) })),
      ),
    ).then((shelves) => {
      if (active) setSongShelves(shelves.filter((s) => s.items.length > 0))
    })

    return () => {
      active = false
    }
  }, [])

  /*
    Fresh picks. Deliberately keyed on `rotation` and not on the library: a
    shelf that re-ran on every favourite toggle would reshuffle itself under the
    user's cursor mid-browse. It advances when they arrive, or when they ask.
  */
  useEffect(() => {
    let active = true
    setPicksLoading(true)
    void getFreshPicks(12, rotation)
      .then((tracks) => active && setPicks(dedupeTracks(tracks)))
      .catch(() => active && setPicks([]))
      .finally(() => active && setPicksLoading(false))
    return () => {
      active = false
    }
  }, [rotation])

  /*
    One stable slice each — computing them inline created a fresh queue array
    per row, per render, defeating the rows' memoization.

    The three slices are disjoint on a full feed so the card layout never shows
    one song in two blocks. A short feed (a rate-limited mirror, a thin
    category) has nothing to spare, so the shelves fall back to overlapping
    rather than rendering empty.
  */
  const quickPicks = useMemo(() => trending.slice(0, 15), [trending])
  const trendingShelf = useMemo(
    () => (trending.length > 35 ? trending.slice(15, 35) : trending.slice(0, 20)),
    [trending],
  )
  const moreSongs = useMemo(
    () => (trending.length > 40 ? trending.slice(35) : trending.slice(20)),
    [trending],
  )

  const refreshPicks = useCallback(() => setRotation((n) => n + 1), [])

  return {
    trending,
    quickPicks,
    trendingShelf,
    moreSongs,
    collections,
    picks,
    picksLoading,
    artists,
    playlistShelves,
    songShelves,
    activeCategory,
    loading,
    error,
    loadCategory,
    loadTrending,
    refreshPicks,
  }
}

export type HomeFeed = ReturnType<typeof useHomeFeed>
