import { useState } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Volume2, VolumeX, Heart, ListMusic, HardDriveDownload, X, Maximize2, Minimize2,
} from 'lucide-react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { formatDuration } from '@/lib/format'
import { Artwork } from './ui'
import { keyOf } from '@/lib/db'

export function PlayerBar() {
  const s = usePlayer()
  const [queueOpen, setQueueOpen] = useState(false)
  const isFavorite = useLibrary((l) => l.isFavorite)
  const toggleFavorite = useLibrary((l) => l.toggleFavorite)

  if (!s.current) return null
  const fav = isFavorite(s.current)
  const pct = s.duration ? (s.position / s.duration) * 100 : 0

  return (
    <>
      {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-800 bg-ink-900/95 backdrop-blur">
        {/* seek bar sits flush on the top edge */}
        <label className="group relative block h-1 cursor-pointer">
          <span className="absolute inset-0 bg-ink-700" />
          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
          <input
            type="range"
            min={0}
            max={s.duration || 0}
            step={0.1}
            value={s.position}
            onChange={(e) => s.seek(Number(e.target.value))}
            aria-label="Seek"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-5">
          {/* now playing */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Artwork src={s.current.artwork} alt={s.current.title} className="h-12 w-12" rounded="rounded-lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{s.current.title}</p>
              <p className="flex items-center gap-1.5 truncate text-xs text-ink-400">
                {s.fromCache && <HardDriveDownload size={11} className="shrink-0 text-accent" />}
                {s.current.artist}
              </p>
            </div>
            <button
              onClick={() => s.current && toggleFavorite(s.current)}
              className={clsx('hidden shrink-0 rounded-full p-2 hover:bg-ink-800 sm:block', fav ? 'text-accent' : 'text-ink-400')}
              title={fav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
            </button>
          </div>

          {/* transport */}
          <div className="flex shrink-0 flex-col items-center gap-1">
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={s.toggleShuffle}
                title="Shuffle"
                className={clsx('hidden rounded-full p-2 hover:bg-ink-800 sm:block', s.shuffle ? 'text-accent' : 'text-ink-400')}
              >
                <Shuffle size={15} />
              </button>
              <button onClick={() => void s.prev()} title="Previous" className="rounded-full p-2 text-ink-200 hover:bg-ink-800">
                <SkipBack size={18} fill="currentColor" />
              </button>
              <button
                onClick={s.toggle}
                title={s.playing ? 'Pause' : 'Play'}
                className="rounded-full bg-white p-2.5 text-ink-950 transition hover:scale-105 hover:bg-ink-200"
              >
                {s.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <button onClick={() => void s.next()} title="Next" className="rounded-full p-2 text-ink-200 hover:bg-ink-800">
                <SkipForward size={18} fill="currentColor" />
              </button>
              <button
                onClick={s.cycleRepeat}
                title={`Repeat: ${s.repeat}`}
                className={clsx('hidden rounded-full p-2 hover:bg-ink-800 sm:block', s.repeat !== 'off' ? 'text-accent' : 'text-ink-400')}
              >
                {s.repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
              </button>
            </div>
            <div className="hidden items-center gap-2 text-[11px] tabular-nums text-ink-400 sm:flex">
              <span>{formatDuration(s.position)}</span>
              <span>/</span>
              <span>{formatDuration(s.duration)}</span>
            </div>
          </div>

          {/* volume + queue */}
          <div className="flex flex-1 items-center justify-end gap-2">
            {s.videoActive && (
              <button
                onClick={s.toggleVideoExpanded}
                title={s.videoExpanded ? 'Shrink video' : 'Expand video'}
                className="rounded-full p-2 text-ink-400 hover:bg-ink-800 hover:text-white"
              >
                {s.videoExpanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            )}
            <button
              onClick={() => setQueueOpen((v) => !v)}
              title="Queue"
              className={clsx('rounded-full p-2 hover:bg-ink-800', queueOpen ? 'text-accent' : 'text-ink-400')}
            >
              <ListMusic size={17} />
            </button>
            <div className="hidden items-center gap-2 md:flex">
              <button onClick={s.toggleMute} className="rounded-full p-2 text-ink-400 hover:bg-ink-800" title="Mute">
                {s.muted || s.volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={s.muted ? 0 : s.volume}
                onChange={(e) => s.setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-ink-700 accent-accent"
              />
            </div>
          </div>
        </div>

        {s.error && (
          <div className="flex items-center justify-between gap-3 border-t border-accent-dim bg-accent-dim/40 px-5 py-1.5">
            <p className="text-xs text-accent-soft">{s.error}</p>
            <button
              onClick={s.dismissError}
              className="rounded p-1 text-accent-soft hover:text-white"
              title="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function QueuePanel({ onClose }: { onClose: () => void }) {
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const playQueue = usePlayer((s) => s.playQueue)
  const removeFromQueue = usePlayer((s) => s.removeFromQueue)
  const clearQueue = usePlayer((s) => s.clearQueue)

  return (
    <aside className="fixed right-0 bottom-[76px] z-40 flex max-h-[60vh] w-full flex-col rounded-t-2xl border border-ink-800 bg-ink-900 shadow-2xl sm:right-4 sm:w-96 sm:rounded-2xl">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Up next · {queue.length}</h3>
        <div className="flex items-center gap-1">
          <button onClick={clearQueue} className="rounded-full px-2 py-1 text-xs text-ink-400 hover:text-white">
            Clear
          </button>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink-400 hover:bg-ink-800 hover:text-white">
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {queue.map((t, i) => (
          <div
            key={`${keyOf(t)}-${i}`}
            className={clsx(
              'group flex items-center gap-2 rounded-lg px-2 py-1.5',
              i === index ? 'bg-ink-800' : 'hover:bg-ink-800/60',
            )}
          >
            <button onClick={() => void playQueue(queue, i)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <Artwork src={t.artwork} alt={t.title} className="h-8 w-8" rounded="rounded" />
              <div className="min-w-0">
                <p className={clsx('truncate text-xs font-medium', i === index ? 'text-accent' : 'text-ink-200')}>
                  {t.title}
                </p>
                <p className="truncate text-[11px] text-ink-400">{t.artist}</p>
              </div>
            </button>
            <button
              onClick={() => removeFromQueue(i)}
              className="rounded p-1 text-ink-400 opacity-0 hover:text-white group-hover:opacity-100"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
