import { useEffect, useMemo, useState } from 'react'
import { Play, Sparkles, Flame, Music, Heart, Headphones, Radio, ListMusic, Shuffle } from 'lucide-react'
import clsx from 'clsx'
import type { Track, Collection } from '@/types'
import { source } from '@/services'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { TrackCard, CollectionCard } from '@/components/Cards'
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

export default function Home() {
  const [trending, setTrending] = useState<Track[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [forYou, setForYou] = useState<Track[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('Bollywood Hits')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const playQueue = usePlayer((s) => s.playQueue)
  const playShuffled = usePlayer((s) => s.playShuffled)
  const recent = useLibrary((s) => s.recent)
  const favorites = useLibrary((s) => s.favorites)
  const playlists = useLibrary((s) => s.playlists)

  // Fixed for the render session so it doesn't flip while the user is reading.
  const [hello] = useState(greeting)

  // The strongest taste signal we have without a backend: the artist behind the
  // most recent favorite, or failing that, the last thing played.
  const tasteArtist = useMemo(() => {
    const seed = favorites[0] || recent[0]
    return seed ? leadArtist(seed.artist) || null : null
  }, [favorites, recent])

  const loadCategory = (catQuery: string) => {
    setLoading(true)
    setError(null)
    setActiveCategory(catQuery)

    Promise.all([
      source.search(catQuery).then((r) => r.tracks.slice(0, 40)),
      source.featuredCollections(12).catch(() => []),
    ])
      .then(([t, c]) => {
        setTrending(t)
        if (c.length > 0) setCollections(c)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([source.trending(40), source.featuredCollections(12).catch(() => [])])
      .then(([t, c]) => {
        setTrending(t)
        setCollections(c)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Taste shelf — refreshed whenever the top favorite/recent artist changes.
  useEffect(() => {
    if (!tasteArtist) {
      setForYou([])
      return
    }
    let active = true
    void source
      .search(tasteArtist)
      .then((r) => {
        if (active) setForYou(r.tracks.slice(0, 12))
      })
      .catch(() => {
        /* the rest of the page is unaffected by a missing taste shelf */
      })
    return () => {
      active = false
    }
  }, [tasteArtist])

  const hero = trending[0]

  return (
    /*
      The negative margin mirrors Shell's padding exactly (px-4 py-6, sm:px-6);
      overflow-hidden keeps the offset glow circles from causing horizontal
      scroll.
    */
    <div className="relative -mx-4 -my-6 space-y-10 overflow-hidden bg-[var(--shell-bg,#070708)] text-[var(--color-ink-200,#c6c6d2)] transition-colors duration-300 px-4 py-6 sm:-mx-6 sm:px-6">
      <div aria-hidden className="pointer-events-none absolute -top-20 -left-20 h-[420px] w-[420px] rounded-full bg-accent/20 blur-[140px]" />
      <div aria-hidden className="pointer-events-none absolute top-1/3 -right-20 h-[420px] w-[420px] rounded-full bg-accent/15 blur-[150px]" />

      {/* Greeting & PurePlay Brand Banner */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-handwritten text-4xl sm:text-5xl font-bold tracking-wide text-white drop-shadow-[0_2px_10px_rgba(255,107,74,0.4)]">PurePlay</span>
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[10px] font-bold text-accent uppercase tracking-wider">Ad-Free</span>
          </div>
          <p className="text-sm text-ink-300 sm:text-base">
            {hello} 👋 — Unlimited free music streaming without ads.
          </p>
        </div>
      </header>

      {error && (
        <ErrorNote message={`Couldn't load the catalog: ${error}`} onRetry={() => loadCategory(activeCategory)} />
      )}

      {/* Hero — featured track */}
      {loading ? (
        <Skeleton className="h-64 w-full rounded-3xl sm:h-80" />
      ) : hero ? (
        <section className="relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl">
          <div aria-hidden className="absolute inset-0">
            <Artwork src={hero.artwork} alt="" rounded="rounded-none" className="h-full w-full scale-105" />
            <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-transparent" />
          </div>

          <div className="relative flex min-h-[300px] flex-col justify-end px-6 py-12 sm:px-10 sm:py-16">
            <p className="mb-3 flex w-fit items-center gap-2 rounded-full border border-accent/40 bg-accent/20 px-3 py-1 text-xs font-semibold text-accent-soft backdrop-blur-md">
              <Sparkles size={13} aria-hidden />
              Featured track
            </p>
            <h2 className="font-display line-clamp-2 max-w-2xl text-3xl leading-tight font-extrabold tracking-tight text-white sm:text-5xl [text-wrap:balance]">
              {hero.title}
            </h2>
            <p className="mt-2 text-sm font-medium text-ink-200 sm:text-base">{hero.artist}</p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button size="lg" variant="accent" onClick={() => void playQueue(trending, 0)}>
                <Play size={18} fill="currentColor" />
                Play now
              </Button>
              <Button
                size="lg"
                variant="outline"
                // playQueue(list, randomIndex) only randomises the *first*
                // track and then plays the rest in order — playShuffled also
                // turns the mode on, so shuffle lasts past one song
                onClick={() => void playShuffled(trending)}
                disabled={!trending.length}
              >
                <Shuffle size={16} />
                Shuffle
              </Button>
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

      {/* Recommended songs list */}
      <section>
        <SectionHeader title="More songs you might like" />
        <div className="space-y-0.5">
          {loading
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)
            : trending.slice(20, 40).map((t, i) => (
                <TrackRow key={`${t.source}-${t.id}`} track={t} index={i} queue={trending.slice(20, 40)} />
              ))}
        </div>
      </section>
    </div>
  )
}
