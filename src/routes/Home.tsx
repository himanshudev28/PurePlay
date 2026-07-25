import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Sparkles, Flame, Music, Heart, Headphones, Radio, ListMusic, Shuffle } from 'lucide-react'
import clsx from 'clsx'
import type { Track, Collection, Artist } from '@/types'
import { source } from '@/services'
import { ytmusic } from '@/services/ytmusic'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { TrackCard, CollectionCard, ArtistCard } from '@/components/Cards'
import { TrackRow } from '@/components/TrackRow'
import { SectionHeader, Skeleton, Button, ErrorNote, Artwork } from '@/components/ui'

const CATEGORIES = [
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

interface Shelf<T> {
  title: string
  items: T[]
}

/** Time-of-day greeting. Local hours; no name to personalize with (no auth). */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

/** Lead artist of "A, B & C feat. D" → "A", for seeding a taste shelf. */
function leadArtist(name: string): string {
  return name.split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0]?.trim() ?? ''
}

/**
 * Songs for a query — JioSaavn first (background-capable audio), falling back to
 * YouTube Music when the JioSaavn mirrors are rate-limited or down. Keeps the
 * home populated even when the primary catalog is unavailable.
 */
async function discoverTracks(query: string, limit: number): Promise<Track[]> {
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

export default function Home() {
  const [trending, setTrending] = useState<Track[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [forYou, setForYou] = useState<Track[]>([])
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

  const playQueue = usePlayer((s) => s.playQueue)
  const playShuffled = usePlayer((s) => s.playShuffled)
  const recent = useLibrary((s) => s.recent)
  const favorites = useLibrary((s) => s.favorites)
  const playlists = useLibrary((s) => s.playlists)

  const [hello] = useState(greeting)

  const tasteArtist = useMemo(() => {
    const seed = favorites[0] || recent[0]
    return seed ? leadArtist(seed.artist) || null : null
  }, [favorites, recent])

  const loadCategory = useCallback((catQuery: string) => {
    const token = ++loadSeq.current
    setLoading(true)
    setError(null)
    setActiveCategory(catQuery)

    Promise.all([discoverTracks(catQuery, 40), source.featuredCollections(12).catch(() => [])])
      .then(([t, c]) => {
        // two quick pill taps race — only the latest response may land
        if (token !== loadSeq.current) return
        setTrending(t.slice(0, 40))
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

  const loadTrending = useCallback(() => {
    const token = ++loadSeq.current
    setLoading(true)
    setError(null)
    setActiveCategory(null)
    // trending() can fail hard when the JioSaavn mirrors are down; fall back to
    // YouTube Music so the home still fills instead of showing a bare error.
    Promise.all([
      source.trending(40).catch(() => discoverTracks('trending songs', 40)),
      source.featuredCollections(12).catch(() => []),
    ])
      .then(([t, c]) => {
        if (token !== loadSeq.current) return
        setTrending(t)
        setCollections(c)
        setError(t.length ? null : 'Could not load the catalog')
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
        discoverTracks(s.query, 20).then((items) => ({ title: s.title, items })),
      ),
    ).then((shelves) => {
      if (active) setSongShelves(shelves.filter((s) => s.items.length > 0))
    })

    return () => {
      active = false
    }
  }, [])

  // Taste shelf — refreshed whenever the top favorite/recent artist changes.
  useEffect(() => {
    if (!tasteArtist) {
      setForYou([])
      return
    }
    let active = true
    void discoverTracks(tasteArtist, 12).then((tracks) => {
      if (active) setForYou(tracks.slice(0, 12))
    })
    return () => {
      active = false
    }
  }, [tasteArtist])

  const hero = trending[0]
  // one stable slice — computing it inline created a fresh queue array per row,
  // per render, defeating the rows' memoization
  const moreSongs = useMemo(() => trending.slice(20, 40), [trending])

  return (
    <div className="relative -mx-4 -my-6 space-y-10 overflow-hidden bg-[var(--shell-bg,#070708)] text-[var(--color-ink-200,#c6c6d2)] transition-colors duration-300 px-4 py-6 sm:-mx-6 sm:px-6">
      <div aria-hidden className="pointer-events-none absolute -top-20 -left-20 h-[420px] w-[420px] rounded-full bg-accent/20 blur-[140px]" />
      <div aria-hidden className="pointer-events-none absolute top-1/3 -right-20 h-[420px] w-[420px] rounded-full bg-accent/15 blur-[150px]" />

      {/* Greeting & PurePlay Brand Banner */}
      <header className="flex animate-fade-up flex-col justify-between gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-handwritten text-4xl font-bold tracking-wide text-white drop-shadow-[0_2px_10px_rgba(255,107,74,0.4)] sm:text-5xl">PurePlay</span>
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase">Ad-Free</span>
          </div>
          <p className="text-sm text-ink-300 sm:text-base">
            {hello} 👋 — Unlimited free music streaming without ads.
          </p>
        </div>
      </header>

      {error && (
        <ErrorNote
          message={`Couldn't load the catalog: ${error}`}
          // retry what actually failed: the chosen category, or the initial feed
          onRetry={() => (activeCategory ? loadCategory(activeCategory) : loadTrending())}
        />
      )}

      {/* Hero — featured track */}
      {loading ? (
        <Skeleton className="h-72 w-full rounded-3xl sm:h-80" />
      ) : hero ? (
        <section className="group relative animate-fade-up overflow-hidden rounded-3xl border border-white/10 shadow-2xl">
          {/* Blurred artwork backdrop + accent glow */}
          <div aria-hidden className="absolute inset-0">
            <Artwork src={hero.artwork} alt="" rounded="rounded-none" className="h-full w-full scale-110 blur-[2px]" />
            <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/88 to-ink-950/35" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-transparent" />
            <div className="absolute -top-24 -right-12 h-72 w-72 rounded-full bg-accent/25 blur-[120px]" />
          </div>

          {/* Drifting sheen */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="hero-sheen absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>

          <div className="relative flex min-h-[300px] items-center gap-6 px-6 py-10 sm:min-h-[340px] sm:px-10 sm:py-14">
            {/* Crisp album art */}
            <div className="hidden shrink-0 sm:block">
              <Artwork
                src={hero.artwork}
                alt={hero.title}
                rounded="rounded-2xl"
                className="h-44 w-44 shadow-2xl ring-1 ring-white/15 transition-transform duration-500 group-hover:scale-105 glow-accent"
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="mb-3 flex w-fit items-center gap-2 rounded-full border border-accent/40 bg-accent/20 px-3 py-1 text-xs font-semibold text-accent-soft backdrop-blur-md">
                <Sparkles size={13} aria-hidden />
                Featured track
              </p>
              <h2 className="font-display line-clamp-2 max-w-2xl text-3xl leading-tight font-extrabold tracking-tight text-white sm:text-5xl [text-wrap:balance]">
                {hero.title}
              </h2>
              <p className="mt-2 truncate text-sm font-medium text-ink-200 sm:text-base">{hero.artist}</p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button size="lg" variant="accent" onClick={() => void playQueue(trending, 0)}>
                  <Play size={18} fill="currentColor" />
                  Play now
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => void playShuffled(trending)}
                  disabled={!trending.length}
                >
                  <Shuffle size={16} />
                  Shuffle
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Category pills */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-200">Explore moods & genres</h2>
        <div role="group" aria-label="Browse by mood or genre" className="flex flex-wrap gap-2.5">
          {CATEGORIES.map(({ label, query }) => (
            <button
              key={label}
              onClick={() => loadCategory(query)}
              aria-pressed={activeCategory === query}
              className={clsx(
                'inline-flex min-h-9 items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-200',
                activeCategory === query
                  ? 'border-accent bg-accent text-ink-950'
                  : 'border-ink-800 bg-ink-900/80 text-ink-300 hover:border-ink-600 hover:text-white',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Recently played */}
      {recent.length > 0 && (
        <section>
          <SectionHeader title="Jump back in" />
          <div className="shelf">
            {recent.slice(0, 12).map((t) => (
              <TrackCard key={`recent-${t.source}-${t.id}`} track={t} queue={recent} />
            ))}
          </div>
        </section>
      )}

      {/* Top picks — taste-based */}
      {forYou.length > 0 && (
        <section>
          <SectionHeader
            title="Top picks for you"
            action={
              <Button size="sm" variant="ghost" onClick={() => void playQueue(forYou, 0)}>
                Play all
              </Button>
            }
          />
          <div className="shelf">
            {forYou.map((t) => (
              <TrackCard key={`foryou-${t.source}-${t.id}`} track={t} queue={forYou} />
            ))}
          </div>
        </section>
      )}

      {/* Popular artists */}
      {artists.length > 0 && (
        <section>
          <SectionHeader title="Popular artists" />
          <div className="shelf">
            {artists.map((a) => (
              <ArtistCard key={`${a.source}-${a.id}`} artist={a} />
            ))}
          </div>
        </section>
      )}

      {/* Trending / category shelf */}
      <section>
        <SectionHeader
          title={activeCategory || 'Trending hits'}
          action={
            <Button size="sm" variant="ghost" onClick={() => void playQueue(trending, 0)} disabled={!trending.length}>
              Play all
            </Button>
          }
        />
        <div className="shelf">
          {loading
            ? Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-[212px] w-[152px] shrink-0 sm:w-[168px]" />
              ))
            : trending.slice(0, 20).map((t) => <TrackCard key={`${t.source}-${t.id}`} track={t} queue={trending} />)}
        </div>
      </section>

      {/* Genre playlist shelves */}
      {playlistShelves.map((shelf) => (
        <section key={shelf.title}>
          <SectionHeader title={shelf.title} />
          <div className="shelf">
            {shelf.items.map((c) => (
              <CollectionCard key={`${c.source}-${c.id}`} collection={c} />
            ))}
          </div>
        </section>
      ))}

      {/* Genre song shelves */}
      {songShelves.map((shelf) => (
        <section key={shelf.title}>
          <SectionHeader
            title={shelf.title}
            action={
              <Button size="sm" variant="ghost" onClick={() => void playQueue(shelf.items, 0)}>
                Play all
              </Button>
            }
          />
          <div className="shelf">
            {shelf.items.map((t) => (
              <TrackCard key={`${shelf.title}-${t.source}-${t.id}`} track={t} queue={shelf.items} />
            ))}
          </div>
        </section>
      ))}

      {/* Featured albums & playlists */}
      {collections.length > 0 && (
        <section>
          <SectionHeader title="Albums & playlists" />
          <div className="shelf">
            {collections.map((c) => (
              <CollectionCard key={`${c.source}-${c.id}`} collection={c} />
            ))}
          </div>
        </section>
      )}

      {/* User's own playlists */}
      {playlists.length > 0 && (
        <section>
          <SectionHeader title="Your playlists" />
          <div className="shelf">
            {playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => p.tracks.length && void playQueue(p.tracks, 0)}
                disabled={!p.tracks.length}
                aria-label={`Play playlist ${p.name}`}
                className="group w-[152px] shrink-0 text-left sm:w-[168px] card-hover disabled:opacity-60"
              >
                <div className="relative">
                  <span aria-hidden className="absolute -top-1.5 left-1/2 h-full w-[88%] -translate-x-1/2 rounded-xl bg-ink-700/50" />
                  <span aria-hidden className="absolute -top-0.5 left-1/2 h-full w-[94%] -translate-x-1/2 rounded-xl bg-ink-600/40" />
                  <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10">
                    <span className="pointer-events-none absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/95 uppercase ring-1 ring-white/15 backdrop-blur-md">
                      <ListMusic size={10} aria-hidden />
                      Playlist
                    </span>
                    <Artwork src={p.tracks[0]?.artwork} alt="" className="aspect-square w-full" />
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
                    <span className="absolute right-2 bottom-2 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-accent text-ink-950 opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 glow-accent">
                      <Play size={16} fill="currentColor" className="ml-0.5" />
                    </span>
                  </div>
                </div>
                <p className="mt-2 truncate text-sm font-medium text-white">{p.name}</p>
                <p className="truncate text-xs text-ink-400">
                  {p.tracks.length} track{p.tracks.length === 1 ? '' : 's'}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Recommended songs list */}
      <section>
        <SectionHeader title="More songs you might like" />
        <div className="space-y-0.5">
          {loading
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)
            : moreSongs.map((t, i) => (
                <TrackRow key={`${t.source}-${t.id}`} track={t} index={i} queue={moreSongs} />
              ))}
        </div>
      </section>
    </div>
  )
}
