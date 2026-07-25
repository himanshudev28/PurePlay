import { Play, Pause, SkipBack, SkipForward, Maximize2, X, Heart, Shuffle } from 'lucide-react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { Artwork, SeekRange } from './ui'
import { formatDuration } from '@/lib/format'
import { usePlayerTheme } from '@/contexts/PlayerThemeContext'

export function CardPlayer() {
  const s = usePlayer()
  const isFavorite = useLibrary((l) => l.isFavorite)
  const toggleFavorite = useLibrary((l) => l.toggleFavorite)
  const { playerTheme } = usePlayerTheme()

  const current = s.current
  const visible = !!current && !s.fullPlayerOpen && s.playerViewMode === 'card'

  if (!visible || !current) return null

  const fav = isFavorite(current)
  const pct = s.duration ? (s.position / s.duration) * 100 : 0

  return (
    <div
      className={clsx(
        // On phones the bottom tab bar lives in the same corner — sit above it
        // and never exceed the viewport width, or navigation becomes unreachable.
        'fixed bottom-[calc(76px+env(safe-area-inset-bottom,0px))] lg:bottom-6 right-4 lg:right-6 z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border shadow-2xl transition-all duration-300',
        playerTheme === 'neumorphic'
          ? 'bg-[#d6cfc4] text-stone-800 border-[#c8c0b4]'
          : playerTheme === 'vibrant'
          ? 'bg-gradient-to-b from-purple-950 to-indigo-950 text-white border-purple-800/40'
          : playerTheme === 'cherry-blossom'
          ? 'bg-gradient-to-b from-rose-950 to-pink-950 text-white border-rose-800/40'
          : playerTheme === 'sunset-shades'
          ? 'bg-gradient-to-b from-orange-950 to-amber-950 text-white border-orange-800/40'
          : playerTheme === 'arc-studio'
          ? 'bg-gradient-to-b from-emerald-950 to-teal-950 text-white border-cyan-800/40'
          : playerTheme === 'cosmic-aurora'
          ? 'bg-gradient-to-b from-slate-950 via-indigo-950 to-purple-950 text-white border-indigo-800/40'
          : playerTheme === 'minimal'
          ? 'bg-gray-950 text-white border-gray-800'
          : playerTheme === 'midnight-ember'
          ? 'bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1e] text-white border-[#e94560]/30'
          : playerTheme === 'emerald-gold'
          ? 'bg-gradient-to-b from-[#0f2d22] to-[#071a12] text-white border-[#f5c542]/30'
          : 'glass text-white border-ink-800'
      )}
    >
      {/* Top bar controls */}
      <div className="flex items-center justify-between p-3">
        <span className="text-[11px] font-bold tracking-wider uppercase opacity-60">Card View</span>
        <div className="flex items-center gap-1">
          <button
            onClick={s.openFullPlayer}
            className="rounded-full p-1.5 opacity-70 hover:opacity-100 hover:bg-white/10"
            title="Expand to full player"
          >
            <Maximize2 size={15} />
          </button>
          <button
            onClick={() => s.setPlayerViewMode('bar')}
            className="rounded-full p-1.5 opacity-70 hover:opacity-100 hover:bg-white/10"
            title="Switch to player bar"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Artwork */}
      <div className="px-5 pb-3">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl shadow-lg">
          <Artwork src={current.artwork} alt="" className="h-full w-full" rounded="rounded-2xl" />
        </div>
      </div>

      {/* Meta */}
      <div className="px-5 text-center">
        <h3 className="truncate font-bold text-base">{current.title}</h3>
        <p className="truncate text-xs opacity-70 mt-0.5">{current.artist}</p>
      </div>

      {/* Scrubber */}
      <div className="px-5 py-3 space-y-1.5">
        <div className="group relative h-1.5 cursor-pointer rounded-full bg-white/20">
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${pct}%` }}
          />
          <SeekRange />
        </div>
        <div className="flex items-center justify-between text-[10px] tabular-nums opacity-60">
          <span>{formatDuration(s.position)}</span>
          <span>{formatDuration(s.duration)}</span>
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center justify-around px-4 pb-4">
        <button
          onClick={s.toggleShuffle}
          className={clsx('p-1.5 transition', s.shuffle ? 'text-accent' : 'opacity-60 hover:opacity-100')}
          title="Shuffle"
        >
          <Shuffle size={16} />
        </button>
        <button onClick={() => void s.prev()} className="p-1.5 opacity-80 hover:opacity-100" title="Previous">
          <SkipBack size={20} fill="currentColor" />
        </button>
        <button
          onClick={s.toggle}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 active:scale-95"
          title={s.playing ? 'Pause' : 'Play'}
        >
          {s.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
        </button>
        <button onClick={() => void s.next()} className="p-1.5 opacity-80 hover:opacity-100" title="Next">
          <SkipForward size={20} fill="currentColor" />
        </button>
        <button
          onClick={() => toggleFavorite(current)}
          className={clsx('p-1.5 transition', fav ? 'text-accent' : 'opacity-60 hover:opacity-100')}
          title={fav ? 'Remove favorite' : 'Add favorite'}
        >
          <Heart size={18} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Without this, a failed stream in card view is pure silence — the play
          button just appears to do nothing. */}
      {s.error && (
        <div role="alert" className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/30 px-4 py-2">
          <p className="min-w-0 truncate text-[11px] opacity-80">{s.error}</p>
          <button onClick={s.dismissError} className="rounded p-1 opacity-60 hover:opacity-100" aria-label="Dismiss error">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
