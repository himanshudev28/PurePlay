import { Play, Pause, Heart, ListPlus } from 'lucide-react'
import clsx from 'clsx'
import type { Track } from '@/types'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { keyOf } from '@/lib/db'
import { formatCount } from '@/lib/format'
import { Artwork, NowPlayingBars, Skeleton } from './ui'

/**
 * One line of the quick-picks card.
 *
 * Deliberately not `TrackRow`: that row carries five hover controls and a
 * popover menu, which is right for a full-width list and far too dense at a
 * third of the page width. This keeps art, title, credit and a single play
 * target, with favourite and queue tucked behind hover.
 */
function QuickPickRow({ track, queue }: { track: Track; queue: Track[] }) {
  const current = usePlayer((s) => s.current)
  const playing = usePlayer((s) => s.playing)
  const playTrack = usePlayer((s) => s.playTrack)
  const toggle = usePlayer((s) => s.toggle)
  const isFavorite = useLibrary((s) => s.isFavorite)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)

  const isCurrent = current ? keyOf(current) === keyOf(track) : false
  const isPlaying = isCurrent && playing
  const fav = isFavorite(track)

  return (
    <div
      className={clsx(
        'group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-200',
        isCurrent ? 'bg-white/10' : 'hover:bg-white/5',
      )}
    >
      <button
        onClick={() => (isCurrent ? toggle() : void playTrack(track, queue))}
        aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title} by ${track.artist}`}
        className="relative shrink-0 rounded-lg"
      >
        <Artwork src={track.artwork} alt="" rounded="rounded-lg" className="h-12 w-12" />
        <span
          aria-hidden
          className={clsx(
            'absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 transition-opacity',
            isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {isPlaying ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" />}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className={clsx('truncate text-sm font-medium', isCurrent ? 'text-accent' : 'text-white')}>
          {track.title}
          {isCurrent && <span className="sr-only"> (now playing)</span>}
        </p>
        <p className="truncate text-xs text-ink-400">
          {track.artist}
          {track.playCount ? ` • ${formatCount(track.playCount)} plays` : ''}
        </p>
      </div>

      {isCurrent && <NowPlayingBars className="shrink-0" />}

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          onClick={() => toggleFavorite(track)}
          title={fav ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={`${fav ? 'Remove' : 'Add'} ${track.title} ${fav ? 'from' : 'to'} favorites`}
          aria-pressed={fav}
          className={clsx(
            'rounded-full p-1.5 transition hover:bg-white/10',
            fav ? 'text-accent' : 'text-ink-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Heart size={14} fill={fav ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={() => usePlayer.getState().enqueue(track)}
          title="Add to queue"
          aria-label={`Add ${track.title} to queue`}
          className="rounded-full p-1.5 text-ink-400 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
        >
          <ListPlus size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * The playable block that opens the home page.
 *
 * The song list used to sit at the very bottom, under nine shelves of cards —
 * so the fastest way to actually start music was to scroll past everything
 * else. Column-flowed inside one card, fifteen songs fit above the fold on a
 * desktop and press-to-play is the first thing on screen.
 */
export function QuickPicks({
  title,
  subtitle,
  tracks,
  loading,
  action,
}: {
  title: string
  subtitle?: string
  tracks: Track[]
  loading?: boolean
  action?: React.ReactNode
}) {
  return (
    <section className="animate-fade-up rounded-2xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-xl sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-2">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-ink-400">{subtitle}</p>}
        </div>
        {action}
      </div>

      {/*
        Column-major on wide screens so the list reads top-to-bottom in each
        column, the way the reference layout does — `grid-flow-col` with a
        fixed row count is what produces that, rather than left-to-right wrap.
      */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 md:grid-flow-col md:grid-cols-2 md:grid-rows-[repeat(8,minmax(0,1fr))] xl:grid-cols-3 xl:grid-rows-[repeat(5,minmax(0,1fr))]">
        {loading && !tracks.length
          ? Array.from({ length: 15 }, (_, i) => <Skeleton key={i} className="h-[60px] w-full" />)
          : tracks.map((t) => <QuickPickRow key={`${t.source}-${t.id}`} track={t} queue={tracks} />)}
      </div>

      {!loading && !tracks.length && (
        <p className="px-2 py-6 text-sm text-ink-400">
          Nothing to play right now — try refreshing in a moment.
        </p>
      )}
    </section>
  )
}
