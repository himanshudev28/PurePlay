import { Play, Pause, Heart, ListPlus } from 'lucide-react'
import clsx from 'clsx'
import type { Track } from '@/types'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { keyOf } from '@/lib/db'
import { formatCount } from '@/lib/format'
import { Artwork, NowPlayingBars } from './ui'

/**
 * One dense, playable line: art, title, credit, and a single play target.
 *
 * Deliberately not `TrackRow`: that row carries five hover controls and a
 * popover menu, which is right for a full-width list and far too dense at a
 * third of the page width — or in a phone-width shelf column. Favourite and
 * queue are tucked behind hover on a real pointer (`.row-action`) and stay
 * visible on touch, where nothing ever hovers.
 */
export function CompactTrackRow({ track, queue }: { track: Track; queue: Track[] }) {
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
            fav ? 'text-accent' : 'row-action text-ink-400',
          )}
        >
          <Heart size={14} fill={fav ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={() => usePlayer.getState().enqueue(track)}
          title="Add to queue"
          aria-label={`Add ${track.title} to queue`}
          className="row-action rounded-full p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white"
        >
          <ListPlus size={14} />
        </button>
      </div>
    </div>
  )
}
