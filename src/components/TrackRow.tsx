import { useEffect, useRef, useState } from 'react'
import { Heart, Play, Pause, Download, Check, Loader2, ListPlus, ListMusic, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type { Track } from '@/types'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { useDownloads } from '@/hooks/useDownloads'
import { formatDuration } from '@/lib/format'
import { Artwork, NowPlayingBars } from './ui'
import { keyOf } from '@/lib/db'

/**
 * The playlist feature's missing half: the store could create playlists and
 * remove tracks, but no control anywhere ADDED one — every playlist was
 * permanently empty while its empty state said "add songs from search".
 */
function AddToPlaylistMenu({ track }: { track: Track }) {
  const playlists = useLibrary((s) => s.playlists)
  const addToPlaylist = useLibrary((s) => s.addToPlaylist)
  const createPlaylist = useLibrary((s) => s.createPlaylist)
  const [open, setOpen] = useState(false)
  const [addedTo, setAddedTo] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const add = (playlistId: string) => {
    addToPlaylist(playlistId, track)
    setAddedTo(playlistId)
    setTimeout(() => {
      setOpen(false)
      setAddedTo(null)
    }, 700)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Add to playlist"
        aria-label={`Add ${track.title} to a playlist`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={clsx(
          'rounded-full p-2 transition hover:bg-ink-700 hover:text-white',
          open
            ? 'text-white'
            : 'text-ink-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        <ListMusic size={15} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Add to playlist"
          className="absolute top-full right-0 z-50 mt-1 w-52 rounded-xl border border-ink-700 bg-ink-900 p-1 shadow-2xl"
        >
          <button
            role="menuitem"
            onClick={() => {
              const name = window.prompt('Name the new playlist:')
              if (name?.trim()) add(createPlaylist(name.trim()))
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-white hover:bg-ink-800"
          >
            <Plus size={13} /> New playlist
          </button>
          {playlists.length > 0 && <div className="mx-2 my-1 h-px bg-ink-800" aria-hidden />}
          {playlists.map((p) => {
            const alreadyIn = p.tracks.some((t) => keyOf(t) === keyOf(track))
            return (
              <button
                key={p.id}
                role="menuitem"
                onClick={() => add(p.id)}
                disabled={alreadyIn}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-ink-200 hover:bg-ink-800 disabled:cursor-default disabled:opacity-50"
              >
                {addedTo === p.id || alreadyIn ? (
                  <Check size={13} className="shrink-0 text-accent" />
                ) : (
                  <ListMusic size={13} className="shrink-0 text-ink-400" />
                )}
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-ink-400">{p.tracks.length}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

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

  const downloadLabel =
    status === 'done'
      ? 'Remove download'
      : status === 'downloading'
        ? `Downloading… ${Math.round(progress * 100)}%`
        : status === 'error'
          ? (downloadError ?? 'Download failed — click to retry')
          : 'Download for offline'

  return (
    <div
      // The active row used to be flagged with a 3px accent left border. That
      // reads as decoration and shifted the row's text 1px out of alignment
      // with every neighbour; the tint + accent title + equalizer carry it.
      className={clsx(
        'group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-200 sm:px-3',
        isCurrent ? 'bg-ink-800/80' : 'hover:bg-ink-800/50',
      )}
    >
      <button
        onClick={() => (isCurrent ? toggle() : void playTrack(track, queue))}
        className="relative shrink-0 rounded-lg"
        aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title} by ${track.artist}`}
      >
        <Artwork src={track.artwork} alt="" className="h-11 w-11" rounded="rounded-lg" />
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

      {index !== undefined && (
        <span className="hidden w-5 text-right text-xs tabular-nums text-ink-400 sm:block">
          {isCurrent ? <NowPlayingBars className="ml-auto" /> : index + 1}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className={clsx('truncate text-sm font-medium', isCurrent ? 'text-accent' : 'text-white')}>
          {track.title}
          {isCurrent && <span className="sr-only"> (now playing)</span>}
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
          aria-label={`${fav ? 'Remove' : 'Add'} ${track.title} ${fav ? 'from' : 'to'} favorites`}
          aria-pressed={fav}
          className={clsx(
            'rounded-full p-2 transition hover:bg-ink-700',
            fav ? 'text-accent' : 'text-ink-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
        </button>

        {supported && (
          <button
            onClick={() => (status === 'done' ? void remove() : void download())}
            title={downloadLabel}
            aria-label={`${downloadLabel}: ${track.title}`}
            aria-busy={status === 'downloading' || undefined}
            className={clsx(
              'relative rounded-full p-2 transition hover:bg-ink-700',
              status === 'done' && 'text-accent',
              status === 'error' && 'text-accent-soft opacity-100',
              status !== 'done' &&
                status !== 'error' &&
                'text-ink-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
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

        <AddToPlaylistMenu track={track} />

        {onRemove ? (
          <button
            onClick={onRemove}
            title="Remove"
            aria-label={`Remove ${track.title}`}
            className="rounded-full p-2 text-ink-400 opacity-0 transition hover:bg-ink-700 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 size={15} />
          </button>
        ) : (
          <button
            onClick={() => usePlayer.getState().enqueue(track)}
            title="Add to queue"
            aria-label={`Add ${track.title} to queue`}
            className="rounded-full p-2 text-ink-400 opacity-0 transition hover:bg-ink-700 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ListPlus size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
