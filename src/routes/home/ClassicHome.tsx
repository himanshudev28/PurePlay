import { useState } from 'react'
import { Play, Sparkles, ListMusic, Shuffle, RefreshCw, CalendarClock } from 'lucide-react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { TrackCard, CollectionCard, ArtistCard } from '@/components/Cards'
import { TrackRow } from '@/components/TrackRow'
import { SectionHeader, Skeleton, Button, ErrorNote, Artwork } from '@/components/ui'
import { CATEGORIES, greeting, type HomeFeed } from './useHomeFeed'

/**
 * The original home: one large featured track, then horizontal shelves.
 * Kept selectable in Settings for anyone who prefers the editorial feel over
 * the denser card grid that is now the default.
 */
export default function ClassicHome({ feed }: { feed: HomeFeed }) {
  const {
    trending, moreSongs, collections, picks, picksLoading, artists,
    playlistShelves, songShelves, activeCategory, loading, error,
    loadCategory, loadTrending, refreshPicks,
  } = feed

  const playQueue = usePlayer((s) => s.playQueue)
  const playShuffled = usePlayer((s) => s.playShuffled)
  const recent = useLibrary((s) => s.recent)
  const favorites = useLibrary((s) => s.favorites)
  const playlists = useLibrary((s) => s.playlists)

  const [hello] = useState(greeting)

  const hero = trending[0]

  return (
    <div data-page-surface className="relative -mx-4 -my-6 space-y-10 overflow-hidden bg-[var(--shell-bg,#070708)] text-[var(--color-ink-200,#c6c6d2)] transition-colors duration-300 px-4 py-6 sm:-mx-6 sm:px-6">
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

      {/* Fresh for you — a new hand of suggestions every visit */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              Fresh for you
            </h2>
            <p className="mt-0.5 text-xs text-ink-400">
              {favorites.length || recent.length
                ? 'Matched to what you’ve been playing — and never something you just heard.'
                : 'Play or favourite a few songs and this shelf starts learning your taste.'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={refreshPicks}
              loading={picksLoading}
              title="Deal a new set of suggestions"
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void playQueue(picks, 0)}
              disabled={!picks.length}
            >
              Play all
            </Button>
          </div>
        </div>
        <div className="shelf">
          {picksLoading && !picks.length ? (
            Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[212px] w-[152px] shrink-0 sm:w-[168px]" />
            ))
          ) : picks.length ? (
            picks.map((t) => (
              <TrackCard key={`picks-${t.source}-${t.id}`} track={t} queue={picks} />
            ))
          ) : (
            <p className="py-6 text-sm text-ink-400">
              Nothing new to suggest right now — try Refresh in a moment.
            </p>
          )}
        </div>
      </section>

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
            <div className="flex items-center gap-1.5">
              {!activeCategory && (
                <span
                  title="A new selection is picked every day"
                  className="hidden items-center gap-1.5 rounded-full border border-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-400 sm:inline-flex"
                >
                  <CalendarClock size={11} aria-hidden />
                  Updated daily
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (activeCategory ? loadCategory(activeCategory) : loadTrending(true))}
                loading={loading}
                title="Fetch the latest"
                ariaLabel="Refresh trending"
              >
                <RefreshCw size={14} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void playQueue(trending, 0)} disabled={!trending.length}>
                Play all
              </Button>
            </div>
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
