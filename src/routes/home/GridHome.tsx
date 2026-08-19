import { useRef, useState, type ReactNode } from 'react'
import { Play, Shuffle, RefreshCw, ChevronLeft, ChevronRight, ListMusic, CalendarClock } from 'lucide-react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { CollectionCard, ArtistCard } from '@/components/Cards'
import { SongShelfItems } from '@/components/SongShelf'
import { QuickPicks } from '@/components/QuickPicks'
import { Button, ErrorNote, Artwork } from '@/components/ui'
import { CATEGORIES, greeting, type HomeFeed } from './useHomeFeed'

/**
 * A titled horizontal shelf with its own scroll arrows.
 *
 * The shelves are mask-faded at the trailing edge (see `.shelf` in index.css)
 * which tells you there is more, but on a trackpad-less desktop there was no
 * way to *get* to it. These scroll the row by roughly one viewport of cards,
 * and hide themselves on touch-first widths where swiping already works.
 */
function Row({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: 'smooth' })
  }

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {action}
          <div className="hidden items-center gap-1.5 sm:flex">
            <button
              onClick={() => scrollBy(-1)}
              aria-label={`Scroll ${title} left`}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-ink-300 transition hover:border-white/40 hover:text-white"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => scrollBy(1)}
              aria-label={`Scroll ${title} right`}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-ink-300 transition hover:border-white/40 hover:text-white"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
      <div ref={ref} className="shelf">
        {children}
      </div>
    </section>
  )
}

/**
 * The default home: a wall of cards, opening on a playable block.
 *
 * The ordering is the whole point. Songs you can press are first, browsing
 * shelves come after — the previous page put its only song list at the very
 * bottom, under nine shelves, so starting music meant scrolling past the entire
 * page first.
 */
export default function GridHome({ feed }: { feed: HomeFeed }) {
  const {
    quickPicks, trendingShelf, moreSongs, collections, picks, picksLoading, artists,
    playlistShelves, songShelves, activeCategory, loading, error,
    loadCategory, loadTrending, refreshPicks,
  } = feed

  const playQueue = usePlayer((s) => s.playQueue)
  const playShuffled = usePlayer((s) => s.playShuffled)
  const recent = useLibrary((s) => s.recent)
  const favorites = useLibrary((s) => s.favorites)
  const playlists = useLibrary((s) => s.playlists)

  const [hello] = useState(greeting)

  return (
    <div
      data-page-surface
      className="relative -mx-4 -my-6 space-y-10 overflow-hidden bg-[var(--shell-bg,#070708)] px-4 py-6 text-[var(--color-ink-200,#c6c6d2)] transition-colors duration-300 sm:-mx-6 sm:px-6"
    >
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full bg-accent/15 blur-[150px]" />

      {/* Mood & genre chips — the row that opens the reference layout */}
      <div className="chip-row relative items-center">
        <button
          onClick={() => loadTrending()}
          aria-pressed={activeCategory === null}
          className={clsx(
            'inline-flex min-h-9 items-center rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-200',
            activeCategory === null
              ? 'border-accent bg-accent text-ink-950'
              : 'border-white/15 bg-white/5 text-ink-300 hover:border-white/40 hover:text-white',
          )}
        >
          For you
        </button>
        {CATEGORIES.map(({ label, query }) => (
          <button
            key={label}
            onClick={() => loadCategory(query)}
            aria-pressed={activeCategory === query}
            className={clsx(
              'inline-flex min-h-9 items-center rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-200',
              activeCategory === query
                ? 'border-accent bg-accent text-ink-950'
                : 'border-white/15 bg-white/5 text-ink-300 hover:border-white/40 hover:text-white',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <ErrorNote
          message={`Couldn't load the catalog: ${error}`}
          onRetry={() => (activeCategory ? loadCategory(activeCategory) : loadTrending())}
        />
      )}

      {/* Quick picks — first thing on the page, and immediately playable */}
      <QuickPicks
        title="Quick picks"
        subtitle={`${hello} — press play and go.`}
        tracks={quickPicks}
        loading={loading}
        action={
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="accent"
              onClick={() => void playQueue(quickPicks, 0)}
              disabled={!quickPicks.length}
            >
              <Play size={14} fill="currentColor" />
              Play all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void playShuffled(quickPicks)}
              disabled={!quickPicks.length}
            >
              <Shuffle size={14} />
              Shuffle
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (activeCategory ? loadCategory(activeCategory) : loadTrending(true))}
              loading={loading}
              title="Fetch the latest"
              ariaLabel="Refresh quick picks"
            >
              <RefreshCw size={14} />
            </Button>
          </div>
        }
      />

      {/* Recently played */}
      {recent.length > 0 && (
        <Row title="Jump back in">
          <SongShelfItems tracks={recent.slice(0, 12)} queue={recent} keyPrefix="recent-" />
        </Row>
      )}

      {/* Fresh for you */}
      <Row
        title="Fresh for you"
        action={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={refreshPicks}
              loading={picksLoading}
              title="Deal a new set of suggestions"
              ariaLabel="Refresh suggestions"
            >
              <RefreshCw size={14} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void playQueue(picks, 0)} disabled={!picks.length}>
              Play all
            </Button>
          </>
        }
      >
        {picksLoading || picks.length ? (
          <SongShelfItems tracks={picks} keyPrefix="picks-" loading={picksLoading} />
        ) : (
          <p className="py-6 text-sm text-ink-400">
            {favorites.length || recent.length
              ? 'Nothing new to suggest right now — try refresh in a moment.'
              : 'Play or favourite a few songs and this shelf starts learning your taste.'}
          </p>
        )}
      </Row>

      {/* Featured playlists */}
      {collections.length > 0 && (
        <Row title="Featured playlists for you">
          {collections.map((c) => (
            <CollectionCard key={`${c.source}-${c.id}`} collection={c} />
          ))}
        </Row>
      )}

      {/* Trending / category shelf */}
      <Row
        title={activeCategory || 'Trending hits'}
        action={
          <>
            {!activeCategory && (
              <span
                title="A new selection is picked every day"
                className="mr-1 hidden items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-ink-400 lg:inline-flex"
              >
                <CalendarClock size={11} aria-hidden />
                Updated daily
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => void playQueue(trendingShelf, 0)} disabled={!trendingShelf.length}>
              Play all
            </Button>
          </>
        }
      >
        <SongShelfItems tracks={trendingShelf} loading={loading} />
      </Row>

      {/* Popular artists */}
      {artists.length > 0 && (
        <Row title="Popular artists">
          {artists.map((a) => (
            <ArtistCard key={`${a.source}-${a.id}`} artist={a} />
          ))}
        </Row>
      )}

      {/* Genre playlist shelves */}
      {playlistShelves.map((shelf) => (
        <Row key={shelf.title} title={shelf.title}>
          {shelf.items.map((c) => (
            <CollectionCard key={`${c.source}-${c.id}`} collection={c} />
          ))}
        </Row>
      ))}

      {/* Genre song shelves */}
      {songShelves.map((shelf) => (
        <Row
          key={shelf.title}
          title={shelf.title}
          action={
            <Button size="sm" variant="ghost" onClick={() => void playQueue(shelf.items, 0)}>
              Play all
            </Button>
          }
        >
          <SongShelfItems tracks={shelf.items} keyPrefix={`${shelf.title}-`} />
        </Row>
      ))}

      {/* A second playable block, so the page ends on something pressable too */}
      {(loading || moreSongs.length > 0) && (
        <QuickPicks
          title="More songs you might like"
          tracks={moreSongs}
          loading={loading}
          action={
            <Button size="sm" variant="ghost" onClick={() => void playQueue(moreSongs, 0)} disabled={!moreSongs.length}>
              Play all
            </Button>
          }
        />
      )}

      {/* User's own playlists */}
      {playlists.length > 0 && (
        <Row title="Your playlists">
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
        </Row>
      )}
    </div>
  )
}
