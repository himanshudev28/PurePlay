import { useEffect, useRef, useState } from 'react'
import {
  Heart, Play, Pause, Download, Check, Loader2, ListPlus, ListMusic, Plus, Trash2, HardDriveDownload,
  MoreVertical, X, ChevronLeft,
} from 'lucide-react'
import clsx from 'clsx'
import type { Track } from '@/types'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { useDownloads } from '@/hooks/useDownloads'
import { formatDuration } from '@/lib/format'
import { Artwork, NowPlayingBars } from './ui'
import { keyOf } from '@/lib/db'

/** Close on outside pointer-down or Escape — shared by the popover and the sheet. */
function useDismissable(open: boolean, close: () => void, rootRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, rootRef])
}

/**
 * The "add to playlist" choices.
 *
 * Shared, because the same list has to appear in two very different shells: a
 * small popover on a pointer device, and a bottom sheet on a phone.
 */
function PlaylistChoices({ track, onDone }: { track: Track; onDone: () => void }) {
  const playlists = useLibrary((s) => s.playlists)
  const addToPlaylist = useLibrary((s) => s.addToPlaylist)
  const createPlaylist = useLibrary((s) => s.createPlaylist)
  const [addedTo, setAddedTo] = useState<string | null>(null)

  const add = (playlistId: string) => {
    addToPlaylist(playlistId, track)
    setAddedTo(playlistId)
    setTimeout(() => {
      onDone()
      setAddedTo(null)
    }, 700)
  }

  return (
    <>
      <button
        role="menuitem"
        onClick={() => {
          const name = window.prompt('Name the new playlist:')
          if (name?.trim()) add(createPlaylist(name.trim()))
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-white hover:bg-ink-800 sm:py-2 sm:text-xs"
      >
        <Plus size={15} className="shrink-0" /> New playlist
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
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-ink-200 hover:bg-ink-800 disabled:cursor-default disabled:opacity-50 sm:py-2 sm:text-xs"
          >
            {addedTo === p.id || alreadyIn ? (
              <Check size={15} className="shrink-0 text-accent" />
            ) : (
              <ListMusic size={15} className="shrink-0 text-ink-400" />
            )}
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-ink-400">{p.tracks.length}</span>
          </button>
        )
      })}
    </>
  )
}

/**
 * The playlist feature's missing half: the store could create playlists and
 * remove tracks, but no control anywhere ADDED one — every playlist was
 * permanently empty while its empty state said "add songs from search".
 *
 * Pointer devices only; a phone reaches the same choices through the row's
 * overflow sheet, where a popover anchored to a row near the bottom of the
 * screen would have opened off the end of it.
 */
function AddToPlaylistMenu({ track }: { track: Track }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useDismissable(open, () => setOpen(false), rootRef)

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Add to playlist"
        aria-label={`Add ${track.title} to a playlist`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={clsx(
          'rounded-full p-2 text-ink-400 transition hover:bg-ink-700 hover:text-white',
          open ? 'text-white' : 'row-action',
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
          <PlaylistChoices track={track} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

/** One full-width action line inside the sheet. */
function SheetItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition hover:bg-ink-800',
        danger ? 'text-red-400' : 'text-white',
      )}
    >
      <span className="shrink-0 text-ink-400">{icon}</span>
      {label}
    </button>
  )
}

/**
 * Every row action, in a bottom sheet — the phone half of the row's controls.
 *
 * A sheet rather than a popover because rows sit anywhere on a long scrolling
 * list, and an anchored menu on the last row opens into nothing. It also gives
 * each action a full-width, thumb-sized target instead of a 30px circle.
 */
function TrackSheet({
  track,
  onRemove,
  downloadLabel,
  status,
  supported,
  onDownload,
  saveLabel,
  saveStatus,
  onSaveToDevice,
}: {
  track: Track
  onRemove?: () => void
  downloadLabel: string
  status: ReturnType<typeof useDownloads>['status']
  supported: boolean
  onDownload: () => void
  saveLabel: string
  saveStatus: ReturnType<typeof useDownloads>['saveStatus']
  onSaveToDevice: () => void
}) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setPicking(false)
  }
  useDismissable(open, close, sheetRef)

  // The page must not scroll behind an open sheet.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  /*
    Widening past the breakpoint hides this whole subtree via `sm:hidden`
    without unmounting it: the sheet would vanish mid-interaction while
    `body { overflow: hidden }` stayed applied, leaving a page that could no
    longer be scrolled and no visible control to undo it.
  */
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia('(min-width: 640px)')
    const onChange = () => {
      if (mq.matches) {
        setOpen(false)
        setPicking(false)
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="More actions"
        aria-label={`More actions for ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-full p-2 text-ink-400 transition hover:bg-ink-700 hover:text-white"
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-60 flex items-end bg-black/60 backdrop-blur-sm">
          <div
            ref={sheetRef}
            role="menu"
            aria-label={`Actions for ${track.title}`}
            className="max-h-[75dvh] w-full overflow-y-auto rounded-t-2xl border-t border-ink-700 bg-ink-900 p-2 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] shadow-2xl"
          >
            <div className="mb-1 flex items-center gap-3 px-2 py-2">
              {picking ? (
                <button
                  onClick={() => setPicking(false)}
                  aria-label="Back"
                  className="rounded-full p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white"
                >
                  <ChevronLeft size={18} />
                </button>
              ) : (
                <Artwork src={track.artwork} alt="" rounded="rounded-lg" className="h-10 w-10" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {picking ? 'Add to playlist' : track.title}
                </p>
                {!picking && <p className="truncate text-xs text-ink-400">{track.artist}</p>}
              </div>
              <button
                onClick={close}
                aria-label="Close"
                className="shrink-0 rounded-full p-1.5 text-ink-400 hover:bg-ink-800 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="h-px bg-ink-800" aria-hidden />

            {picking ? (
              <div className="pt-1">
                <PlaylistChoices track={track} onDone={close} />
              </div>
            ) : (
              <div className="pt-1">
                {supported && (
                  <SheetItem
                    icon={
                      status === 'downloading' ? (
                        <Loader2 size={17} className="animate-spin" />
                      ) : status === 'done' ? (
                        <Check size={17} className="text-accent" />
                      ) : (
                        <Download size={17} />
                      )
                    }
                    label={downloadLabel}
                    onClick={() => {
                      onDownload()
                      if (status !== 'downloading') close()
                    }}
                  />
                )}
                {supported && (
                  <SheetItem
                    icon={
                      saveStatus === 'saving' ? (
                        <Loader2 size={17} className="animate-spin" />
                      ) : saveStatus === 'saved' || saveStatus === 'shared' ? (
                        <Check size={17} className="text-accent" />
                      ) : (
                        <HardDriveDownload size={17} />
                      )
                    }
                    label={saveLabel}
                    // Deliberately does NOT close: a multi-megabyte fetch takes
                    // a moment, and the label is the only thing that says so.
                    onClick={onSaveToDevice}
                  />
                )}
                <SheetItem
                  icon={<ListMusic size={17} />}
                  label="Add to playlist"
                  onClick={() => setPicking(true)}
                />
                <SheetItem
                  icon={<ListPlus size={17} />}
                  label="Add to queue"
                  onClick={() => {
                    usePlayer.getState().enqueue(track)
                    close()
                  }}
                />
                {onRemove && (
                  <SheetItem
                    icon={<Trash2 size={17} />}
                    label="Remove from this list"
                    danger
                    onClick={() => {
                      onRemove()
                      close()
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
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

  const {
    status, progress, error: downloadError, download, remove, supported, saveStatus, saveToDevice,
  } = useDownloads(track)

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
          : 'Keep offline in app'

  const onDownload = () => (status === 'done' ? void remove() : void download())

  const saveLabel =
    saveStatus === 'saving'
      ? 'Saving file…'
      : saveStatus === 'saved'
        ? 'Saved to your device'
        : saveStatus === 'shared'
          ? 'Sent to your device'
          : saveStatus === 'error'
            ? 'Could not save — tap to retry'
            : 'Save to device'

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

      <div className="flex shrink-0 items-center gap-0.5">
        {/* Favourite keeps a permanent target at every size — it is the one
            action a listener reaches for mid-scroll. */}
        <button
          onClick={() => toggleFavorite(track)}
          title={fav ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={`${fav ? 'Remove' : 'Add'} ${track.title} ${fav ? 'from' : 'to'} favorites`}
          aria-pressed={fav}
          className={clsx(
            'rounded-full p-2 transition hover:bg-ink-700',
            fav ? 'text-accent' : 'text-ink-400 row-action',
          )}
        >
          <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
        </button>

        {/*
          Wide screens keep every action inline behind hover. Narrow ones get
          a single overflow button instead: four 30px circles ate 124px of a
          360px row and left song titles truncated to about fifteen characters.
        */}
        <div className="hidden items-center gap-0.5 sm:flex">
          {supported && (
            <button
              onClick={onDownload}
              title={downloadLabel}
              aria-label={`${downloadLabel}: ${track.title}`}
              aria-busy={status === 'downloading' || undefined}
              className={clsx(
                'relative rounded-full p-2 transition hover:bg-ink-700',
                status === 'done' && 'text-accent',
                status === 'error' && 'text-accent-soft',
                status !== 'done' && status !== 'error' && 'text-ink-400 row-action',
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

          {supported && (
            <button
              onClick={() => void saveToDevice()}
              title={saveLabel}
              aria-label={`${saveLabel}: ${track.title}`}
              aria-busy={saveStatus === 'saving' || undefined}
              className={clsx(
                'rounded-full p-2 transition hover:bg-ink-700',
                saveStatus === 'saved' || saveStatus === 'shared'
                  ? 'text-accent'
                  : saveStatus === 'error'
                    ? 'text-accent-soft'
                    : 'text-ink-400 row-action',
              )}
            >
              {saveStatus === 'saving' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : saveStatus === 'saved' || saveStatus === 'shared' ? (
                <Check size={15} />
              ) : (
                <HardDriveDownload size={15} />
              )}
            </button>
          )}

          <AddToPlaylistMenu track={track} />

          {onRemove ? (
            <button
              onClick={onRemove}
              title="Remove"
              aria-label={`Remove ${track.title}`}
              className="row-action rounded-full p-2 text-ink-400 transition hover:bg-ink-700 hover:text-white"
            >
              <Trash2 size={15} />
            </button>
          ) : (
            <button
              onClick={() => usePlayer.getState().enqueue(track)}
              title="Add to queue"
              aria-label={`Add ${track.title} to queue`}
              className="row-action rounded-full p-2 text-ink-400 transition hover:bg-ink-700 hover:text-white"
            >
              <ListPlus size={15} />
            </button>
          )}
        </div>

        <div className="sm:hidden">
          <TrackSheet
            track={track}
            onRemove={onRemove}
            downloadLabel={downloadLabel}
            saveLabel={saveLabel}
            saveStatus={saveStatus}
            onSaveToDevice={() => void saveToDevice()}
            status={status}
            supported={supported}
            onDownload={onDownload}
          />
        </div>
      </div>
    </div>
  )
}
