import { Heart, Play, Pause, Download, Check, Loader2, MoreHorizontal, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type { Track } from '@/types'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { useDownloads } from '@/hooks/useDownloads'
import { formatDuration } from '@/lib/format'
import { Artwork } from './ui'
import { keyOf } from '@/lib/db'

export function TrackRow({
  track,
  index,
  queue,
  onRemove,
}: {
  track: Track
  index?: number
  /** the list this row belongs to — becomes the play queue */
  queue?: Track[]
  onRemove?: () => void
}) {
  const current = usePlayer((s) => s.current)
  const playing = usePlayer((s) => s.playing)
  const playTrack = usePlayer((s) => s.playTrack)
  const toggle = usePlayer((s) => s.toggle)

  const isFavorite = useLibrary((s) => s.isFavorite)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)

  const { status, progress, error: downloadError, download, remove, supported } = useDownloads(track)

  const isCurrent = current ? keyOf(current) === keyOf(track) : false
  const isPlaying = isCurrent && playing
  const fav = isFavorite(track)

  return (
    <div
      className={clsx(
        'group flex items-center gap-3 rounded-xl px-2 py-2 transition sm:px-3',
        isCurrent ? 'bg-ink-800/80' : 'hover:bg-ink-800/50',
      )}
    >
      <button
        onClick={() => (isCurrent ? toggle() : void playTrack(track, queue))}
        className="relative shrink-0"
        aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
      >
        <Artwork src={track.artwork} alt={track.title} className="h-11 w-11" rounded="rounded-lg" />
        <span
          className={clsx(
            'absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 transition',
            isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {isPlaying ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" />}
        </span>
      </button>

      {index !== undefined && (
        <span className="hidden w-5 text-right text-xs tabular-nums text-ink-400 sm:block">
          {index + 1}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className={clsx('truncate text-sm font-medium', isCurrent ? 'text-accent' : 'text-white')}>
          {track.title}
        </p>
        <p className="truncate text-xs text-ink-400">{track.artist}</p>
      </div>

      <span className="hidden text-xs tabular-nums text-ink-400 sm:block">
        {formatDuration(track.duration)}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          onClick={() => toggleFavorite(track)}
          title={fav ? 'Remove from favorites' : 'Add to favorites'}
          className={clsx(
            'rounded-full p-2 transition hover:bg-ink-700',
            fav ? 'text-accent' : 'text-ink-400 opacity-0 group-hover:opacity-100 focus:opacity-100',
          )}
        >
          <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
        </button>

        {supported && (
          <button
            onClick={() => (status === 'done' ? void remove() : void download())}
            title={
              status === 'done'
                ? 'Remove download'
                : status === 'downloading'
                  ? `Downloading… ${Math.round(progress * 100)}%`
                  : status === 'error'
                    ? (downloadError ?? 'Download failed — click to retry')
                    : 'Download for offline'
            }
            className={clsx(
              'relative rounded-full p-2 transition hover:bg-ink-700',
              status === 'done' && 'text-accent',
              status === 'error' && 'text-accent-soft opacity-100',
              status !== 'done' &&
                status !== 'error' &&
                'text-ink-400 opacity-0 group-hover:opacity-100 focus:opacity-100',
            )}
          >
            {status === 'downloading' ? (
              <Loader2 size={15} className="animate-spin" />
            ) : status === 'done' ? (
              <Check size={15} />
            ) : (
              <Download size={15} />
            )}
            {status === 'downloading' && progress > 0 && (
              <span className="absolute -bottom-0.5 left-1/2 w-6 -translate-x-1/2 overflow-hidden rounded-full bg-ink-700">
                <span className="block h-0.5 bg-accent" style={{ width: `${progress * 100}%` }} />
              </span>
            )}
          </button>
        )}

        {onRemove ? (
          <button
            onClick={onRemove}
            title="Remove"
            className="rounded-full p-2 text-ink-400 opacity-0 transition hover:bg-ink-700 hover:text-white group-hover:opacity-100 focus:opacity-100"
          >
            <Trash2 size={15} />
          </button>
        ) : (
          <button
            onClick={() => usePlayer.getState().enqueue(track)}
            title="Add to queue"
            className="rounded-full p-2 text-ink-400 opacity-0 transition hover:bg-ink-700 hover:text-white group-hover:opacity-100 focus:opacity-100"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
