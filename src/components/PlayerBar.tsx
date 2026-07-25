import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Volume2, VolumeX, Heart, ListMusic, HardDriveDownload, X, Maximize2, LayoutGrid,
  Sparkles, ListPlus,
} from 'lucide-react'
import clsx from 'clsx'
import type { Track, Collection } from '@/types'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { getSuggestions } from '@/services/recommendations'
import { Artwork, NowPlayingBars, QueueTailLoader } from './ui'
import { keyOf } from '@/lib/db'
import { usePlayerTheme } from '@/contexts/PlayerThemeContext'

export function PlayerBar() {
  const s = usePlayer()
  const [queueOpen, setQueueOpen] = useState(false)
  const isFavorite = useLibrary((l) => l.isFavorite)
  const toggleFavorite = useLibrary((l) => l.toggleFavorite)
  const { playerTheme } = usePlayerTheme()

  const barRef = useRef<HTMLDivElement>(null)
  const current = s.current
  const visible = !!current && !s.fullPlayerOpen && s.playerViewMode !== 'card'

  /*
    Publish the bar's height so the mobile bottom navigation bar can position itself.
  */
  useEffect(() => {
    const root = document.documentElement
    if (!visible) {
      root.style.setProperty('--player-bar-h', '0px')
      return
    }
    const el = barRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      // Add margin height for floating island layout
      root.style.setProperty(
        '--player-bar-h',
        `${Math.round(entry.target.getBoundingClientRect().height) + 12}px`
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  if (!visible || !current) return null

  const fav = isFavorite(current)
  const pct = s.duration ? (s.position / s.duration) * 100 : 0

  // ── Shared transport controls ──────────────────────────────────────────
  const TransportControls = ({
    btnClass = 'hover:bg-white/10 text-white/80 hover:text-white',
    playBg = 'bg-white text-ink-950 hover:bg-white/90',
  }: {
    btnClass?: string
    playBg?: string
  }) => (
    <div className="flex items-center gap-1 sm:gap-2">
      <button
        onClick={s.toggleShuffle}
        title="Shuffle"
        aria-label="Shuffle"
        aria-pressed={s.shuffle}
        className={clsx('hidden rounded-full p-2 transition sm:block', s.shuffle ? 'text-accent' : btnClass)}
      >
        <Shuffle size={15} />
      </button>
      <button
        onClick={() => void s.prev()}
        title="Previous"
        aria-label="Previous track"
        className={clsx('rounded-full p-2 transition', btnClass)}
      >
        <SkipBack size={18} fill="currentColor" />
      </button>
      <button
        onClick={s.toggle}
        title={s.playing ? 'Pause' : 'Play'}
        aria-label={s.playing ? 'Pause' : 'Play'}
        className={clsx('rounded-full p-2.5 transition hover:scale-105 active:scale-95 shadow-md', playBg)}
      >
        {s.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>
      <button
        onClick={() => void s.next()}
        title="Next"
        aria-label="Next track"
        className={clsx('rounded-full p-2 transition', btnClass)}
      >
        <SkipForward size={18} fill="currentColor" />
      </button>
      <button
        onClick={s.cycleRepeat}
        title={`Repeat: ${s.repeat}`}
        aria-label={`Repeat mode: ${s.repeat === 'off' ? 'off' : s.repeat === 'one' ? 'repeat this track' : 'repeat queue'}`}
        className={clsx('hidden rounded-full p-2 transition sm:block', s.repeat !== 'off' ? 'text-accent' : btnClass)}
      >
        {s.repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
      </button>
    </div>
  )

  const VolumeControl = ({ textClass = 'text-white/60 hover:text-white' }: { textClass?: string }) => (
    <div className="hidden items-center gap-2 md:flex">
      <button
        onClick={s.toggleMute}
        className={clsx('rounded-full p-2 transition', textClass)}
        title={s.muted ? 'Unmute' : 'Mute'}
        aria-label={s.muted ? 'Unmute' : 'Mute'}
        aria-pressed={s.muted}
      >
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
        aria-valuetext={`${Math.round((s.muted ? 0 : s.volume) * 100)} percent`}
        className="vol-bar h-1 w-20 cursor-pointer"
      />
    </div>
  )

  const ErrorBanner = () =>
    s.error ? (
      <div role="alert" className="flex items-center justify-between gap-3 border-t border-accent-dim bg-accent-dim/40 px-5 py-1.5 rounded-b-2xl">
        <p className="text-xs text-accent-soft">{s.error}</p>
        <button onClick={s.dismissError} className="rounded p-1 text-accent-soft hover:text-white" title="Dismiss" aria-label="Dismiss error">
          <X size={13} />
        </button>
      </div>
    ) : null

  // ════════════════════════════════════════════════════════════════════════
  // THEME 1: NEUMORPHIC — Light pill island
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'neumorphic') {
    return (
      <>
        {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        <div
          ref={barRef}
          className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full shadow-2xl transition-all duration-300"
          style={{ background: '#d6cfc4', boxShadow: '8px 8px 20px #b8a990, -8px -8px 20px #f0e8da, 0 10px 25px rgba(0,0,0,0.15)' }}
        >
          {/* Seek bar */}
          <div className="group relative h-1.5 cursor-pointer">
            <span aria-hidden className="absolute inset-0" style={{ background: '#c0b8ac' }} />
            <span aria-hidden className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: '#8a7d6a' }} />
            <input type="range" min={0} max={s.duration || 0} step={0.1} value={s.position} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Seek" className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button onClick={s.openFullPlayer} className="group flex min-w-0 items-center gap-3 rounded-full text-left" aria-label={`Open player for ${current.title}`}>
                <span className="relative shrink-0 overflow-hidden rounded-full" style={{ boxShadow: '3px 3px 6px #b8a990, -3px -3px 6px #f0e8da' }}>
                  <Artwork src={current.artwork} alt="" className="h-11 w-11" rounded="rounded-full" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-stone-800">{current.title}</span>
                  <span className="block truncate text-xs text-stone-500">{current.artist}</span>
                </span>
              </button>
              <button onClick={() => toggleFavorite(current)} className={clsx('hidden shrink-0 rounded-full p-2 sm:block', fav ? 'text-rose-500' : 'text-stone-400')} title={fav ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <button onClick={() => void s.prev()} title="Previous" aria-label="Previous track" className="rounded-full p-2 text-stone-600"><SkipBack size={18} fill="currentColor" /></button>
              <button onClick={s.toggle} title={s.playing ? 'Pause' : 'Play'} aria-label={s.playing ? 'Pause' : 'Play'} className="rounded-full p-2.5 text-stone-800 transition" style={{ background: '#d6cfc4', boxShadow: '4px 4px 8px #b8a990, -4px -4px 8px #f0e8da' }}>
                {s.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
              </button>
              <button onClick={() => void s.next()} title="Next" aria-label="Next track" className="rounded-full p-2 text-stone-600"><SkipForward size={18} fill="currentColor" /></button>
            </div>

            <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
              <button onClick={() => s.setPlayerViewMode('card')} title="Card view" className="hidden rounded-full p-2 text-stone-500 hover:text-stone-800 sm:block"><LayoutGrid size={17} /></button>
              <button onClick={() => setQueueOpen((v) => !v)} title="Queue" className="rounded-full p-2 text-stone-500 hover:text-stone-800"><ListMusic size={17} /></button>
              <button onClick={s.openFullPlayer} title="Full screen player" className="rounded-full p-2 text-stone-500 hover:text-stone-800"><Maximize2 size={17} /></button>
            </div>
          </div>
          <ErrorBanner />
        </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME 2: VIBRANT — Purple gradient pill island
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'vibrant') {
    return (
      <>
        {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        <div
          ref={barRef}
          className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full text-white shadow-2xl transition-all duration-300"
          style={{ background: 'linear-gradient(90deg, #3b0764 0%, #6d28d9 50%, #7c3aed 100%)', boxShadow: '0 12px 30px rgba(109, 40, 217, 0.4)' }}
        >
          <div className="group relative h-1.5 cursor-pointer">
            <span aria-hidden className="absolute inset-0 bg-white/20" />
            <span aria-hidden className="absolute inset-y-0 left-0 bg-white" style={{ width: `${pct}%` }} />
            <input type="range" min={0} max={s.duration || 0} step={0.1} value={s.position} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Seek" className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button onClick={s.openFullPlayer} className="group flex min-w-0 items-center gap-3 rounded-full text-left">
                <span className="relative shrink-0 overflow-hidden rounded-full border-2 border-white/30">
                  <Artwork src={current.artwork} alt="" className="h-11 w-11" rounded="rounded-full" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{current.title}</span>
                  <span className="block truncate text-xs text-purple-200">{current.artist}</span>
                </span>
              </button>
              <button onClick={() => toggleFavorite(current)} className={clsx('hidden shrink-0 rounded-full p-2 hover:bg-white/10 sm:block', fav ? 'text-pink-300' : 'text-white/50')} title={fav ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>

            <TransportControls btnClass="text-purple-200 hover:text-white hover:bg-white/10" playBg="bg-white text-purple-900" />

            <div className="flex flex-1 items-center justify-end gap-1.5">
              <button onClick={() => s.setPlayerViewMode('card')} title="Card view" className="hidden rounded-full p-2 text-purple-200 hover:bg-white/10 hover:text-white sm:block"><LayoutGrid size={17} /></button>
              <button onClick={() => setQueueOpen((v) => !v)} title="Queue" className="rounded-full p-2 text-purple-200 hover:bg-white/10 hover:text-white"><ListMusic size={17} /></button>
              <button onClick={s.openFullPlayer} title="Full screen player" className="rounded-full p-2 text-purple-200 hover:bg-white/10 hover:text-white"><Maximize2 size={17} /></button>
              <VolumeControl textClass="text-purple-200 hover:text-white" />
            </div>
          </div>
          <ErrorBanner />
        </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME 3: MINIMAL — Crisp floating pill bar
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'minimal') {
    return (
      <>
        {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        <div
          ref={barRef}
          className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full bg-gray-950 border border-gray-800 text-white shadow-2xl transition-all duration-300"
        >
          <div className="group relative h-1 cursor-pointer">
            <span aria-hidden className="absolute inset-0 bg-gray-800" />
            <span aria-hidden className="absolute inset-y-0 left-0 bg-white" style={{ width: `${pct}%` }} />
            <input type="range" min={0} max={s.duration || 0} step={0.1} value={s.position} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Seek" className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button onClick={s.openFullPlayer} className="group flex min-w-0 items-center gap-3 text-left">
                <Artwork src={current.artwork} alt="" className="h-10 w-10 shrink-0" rounded="rounded-md" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{current.title}</span>
                  <span className="block truncate text-xs text-gray-400">{current.artist}</span>
                </span>
              </button>
              <button onClick={() => toggleFavorite(current)} className={clsx('hidden shrink-0 rounded-full p-2 sm:block', fav ? 'text-white' : 'text-gray-600 hover:text-white')}>
                <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>

            <TransportControls btnClass="text-gray-400 hover:text-white" playBg="bg-white text-gray-950" />

            <div className="flex flex-1 items-center justify-end gap-1">
              <button onClick={() => setQueueOpen((v) => !v)} title="Queue" className="rounded-full p-2 text-gray-400 hover:text-white"><ListMusic size={17} /></button>
              <button onClick={s.openFullPlayer} title="Full screen player" className="rounded-full p-2 text-gray-400 hover:text-white"><Maximize2 size={17} /></button>
              <VolumeControl textClass="text-gray-400 hover:text-white" />
            </div>
          </div>
          <ErrorBanner />
        </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME 4: CHERRY BLOSSOM (NEW) — Crimson & Rose pill island
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'cherry-blossom') {
    return (
      <>
        {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        <div
          ref={barRef}
          className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full text-white shadow-2xl transition-all duration-300"
          style={{
            background: 'linear-gradient(90deg, #4a0e17 0%, #881337 50%, #9f1239 100%)',
            boxShadow: '0 12px 30px rgba(244, 63, 94, 0.35), 0 0 0 1px rgba(254, 205, 211, 0.2)',
          }}
        >
          <div className="group relative h-1.5 cursor-pointer">
            <span aria-hidden className="absolute inset-0 bg-rose-950/40" />
            <span aria-hidden className="absolute inset-y-0 left-0 bg-rose-400 shadow-[0_0_8px_#f43f5e]" style={{ width: `${pct}%` }} />
            <input type="range" min={0} max={s.duration || 0} step={0.1} value={s.position} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Seek" className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button onClick={s.openFullPlayer} className="group flex min-w-0 items-center gap-3 rounded-full text-left">
                <span className="relative shrink-0 overflow-hidden rounded-full border-2 border-rose-300/40 shadow-lg">
                  <Artwork src={current.artwork} alt="" className="h-11 w-11" rounded="rounded-full" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{current.title}</span>
                  <span className="block truncate text-xs text-rose-200">{current.artist}</span>
                </span>
              </button>
              <button onClick={() => toggleFavorite(current)} className={clsx('hidden shrink-0 rounded-full p-2 sm:block', fav ? 'text-rose-300' : 'text-white/50')} title={fav ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>

            <TransportControls btnClass="text-rose-200 hover:text-white hover:bg-white/10" playBg="bg-rose-500 text-white shadow-rose-900/50" />

            <div className="flex flex-1 items-center justify-end gap-1.5">
              <button onClick={() => s.setPlayerViewMode('card')} title="Card view" className="hidden rounded-full p-2 text-rose-200 hover:bg-white/10 hover:text-white sm:block"><LayoutGrid size={17} /></button>
              <button onClick={() => setQueueOpen((v) => !v)} title="Queue" className="rounded-full p-2 text-rose-200 hover:bg-white/10 hover:text-white"><ListMusic size={17} /></button>
              <button onClick={s.openFullPlayer} title="Full screen player" className="rounded-full p-2 text-rose-200 hover:bg-white/10 hover:text-white"><Maximize2 size={17} /></button>
              <VolumeControl textClass="text-rose-200 hover:text-white" />
            </div>
          </div>
          <ErrorBanner />
        </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME 5: SUNSET SHADES (NEW) — Gold & Coral pill island
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'sunset-shades') {
    return (
      <>
        {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        <div
          ref={barRef}
          className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full text-white shadow-2xl transition-all duration-300"
          style={{
            background: 'linear-gradient(90deg, #7c2d12 0%, #c2410c 45%, #f97316 80%, #f59e0b 100%)',
            boxShadow: '0 12px 30px rgba(249, 115, 22, 0.4), 0 0 0 1px rgba(254, 215, 170, 0.25)',
          }}
        >
          <div className="group relative h-1.5 cursor-pointer">
            <span aria-hidden className="absolute inset-0 bg-orange-950/40" />
            <span aria-hidden className="absolute inset-y-0 left-0 bg-amber-300 shadow-[0_0_8px_#fbbf24]" style={{ width: `${pct}%` }} />
            <input type="range" min={0} max={s.duration || 0} step={0.1} value={s.position} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Seek" className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button onClick={s.openFullPlayer} className="group flex min-w-0 items-center gap-3 rounded-full text-left">
                <span className="relative shrink-0 overflow-hidden rounded-full border-2 border-amber-200/50 shadow-lg">
                  <Artwork src={current.artwork} alt="" className="h-11 w-11" rounded="rounded-full" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{current.title}</span>
                  <span className="block truncate text-xs text-orange-200">{current.artist}</span>
                </span>
              </button>
              <button onClick={() => toggleFavorite(current)} className={clsx('hidden shrink-0 rounded-full p-2 sm:block', fav ? 'text-amber-300' : 'text-white/50')} title={fav ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>

            <TransportControls btnClass="text-orange-100 hover:text-white hover:bg-white/10" playBg="bg-amber-400 text-orange-950 font-bold" />

            <div className="flex flex-1 items-center justify-end gap-1.5">
              <button onClick={() => s.setPlayerViewMode('card')} title="Card view" className="hidden rounded-full p-2 text-orange-100 hover:bg-white/10 hover:text-white sm:block"><LayoutGrid size={17} /></button>
              <button onClick={() => setQueueOpen((v) => !v)} title="Queue" className="rounded-full p-2 text-orange-100 hover:bg-white/10 hover:text-white"><ListMusic size={17} /></button>
              <button onClick={s.openFullPlayer} title="Full screen player" className="rounded-full p-2 text-orange-100 hover:bg-white/10 hover:text-white"><Maximize2 size={17} /></button>
              <VolumeControl textClass="text-orange-100 hover:text-white" />
            </div>
          </div>
          <ErrorBanner />
        </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME 6: ARC STUDIO (NEW) — Emerald Teal & Electric Cyan
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'arc-studio') {
    return (
      <>
        {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        <div
          ref={barRef}
          className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full text-white shadow-2xl transition-all duration-300"
          style={{
            background: 'linear-gradient(90deg, #022c22 0%, #064e3b 45%, #0f766e 85%, #06b6d4 100%)',
            boxShadow: '0 12px 30px rgba(6, 182, 212, 0.35), 0 0 0 1px rgba(103, 232, 249, 0.25)',
          }}
        >
          <div className="group relative h-1.5 cursor-pointer">
            <span aria-hidden className="absolute inset-0 bg-teal-950/40" />
            <span aria-hidden className="absolute inset-y-0 left-0 bg-cyan-300 shadow-[0_0_8px_#06b6d4]" style={{ width: `${pct}%` }} />
            <input type="range" min={0} max={s.duration || 0} step={0.1} value={s.position} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Seek" className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button onClick={s.openFullPlayer} className="group flex min-w-0 items-center gap-3 rounded-full text-left">
                <span className="relative shrink-0 overflow-hidden rounded-t-full rounded-b-xl border-2 border-cyan-300/40 shadow-lg">
                  <Artwork src={current.artwork} alt="" className="h-11 w-11" rounded="rounded-t-full rounded-b-xl" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{current.title}</span>
                  <span className="block truncate text-xs text-cyan-200">{current.artist}</span>
                </span>
              </button>
              <button onClick={() => toggleFavorite(current)} className={clsx('hidden shrink-0 rounded-full p-2 sm:block', fav ? 'text-cyan-300' : 'text-white/50')} title={fav ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>

            <TransportControls btnClass="text-teal-100 hover:text-white hover:bg-white/10" playBg="bg-cyan-400 text-teal-950 font-bold" />

            <div className="flex flex-1 items-center justify-end gap-1.5">
              <button onClick={() => s.setPlayerViewMode('card')} title="Card view" className="hidden rounded-full p-2 text-teal-100 hover:bg-white/10 hover:text-white sm:block"><LayoutGrid size={17} /></button>
              <button onClick={() => setQueueOpen((v) => !v)} title="Queue" className="rounded-full p-2 text-teal-100 hover:bg-white/10 hover:text-white"><ListMusic size={17} /></button>
              <button onClick={s.openFullPlayer} title="Full screen player" className="rounded-full p-2 text-teal-100 hover:bg-white/10 hover:text-white"><Maximize2 size={17} /></button>
              <VolumeControl textClass="text-teal-100 hover:text-white" />
            </div>
          </div>
          <ErrorBanner />
        </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME 7: COSMIC AURORA (NEW) — Midnight Indigo & Violet Aurora
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'cosmic-aurora') {
    return (
      <>
        {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        <div
          ref={barRef}
          className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full text-white shadow-2xl transition-all duration-300"
          style={{
            background: 'linear-gradient(90deg, #090d16 0%, #1e1b4b 50%, #4338ca 100%)',
            boxShadow: '0 12px 30px rgba(99, 102, 241, 0.4), 0 0 0 1px rgba(199, 210, 254, 0.25)',
          }}
        >
          <div className="group relative h-1.5 cursor-pointer">
            <span aria-hidden className="absolute inset-0 bg-indigo-950/40" />
            <span aria-hidden className="absolute inset-y-0 left-0 bg-indigo-300 shadow-[0_0_8px_#818cf8]" style={{ width: `${pct}%` }} />
            <input type="range" min={0} max={s.duration || 0} step={0.1} value={s.position} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Seek" className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button onClick={s.openFullPlayer} className="group flex min-w-0 items-center gap-3 rounded-full text-left">
                <span className="relative shrink-0 overflow-hidden rounded-full border-2 border-indigo-300/40 shadow-lg">
                  <Artwork src={current.artwork} alt="" className="h-11 w-11" rounded="rounded-full" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{current.title}</span>
                  <span className="block truncate text-xs text-indigo-200">{current.artist}</span>
                </span>
              </button>
              <button onClick={() => toggleFavorite(current)} className={clsx('hidden shrink-0 rounded-full p-2 sm:block', fav ? 'text-indigo-300' : 'text-white/50')} title={fav ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>

            <TransportControls btnClass="text-indigo-100 hover:text-white hover:bg-white/10" playBg="bg-indigo-400 text-slate-950 font-bold" />

            <div className="flex flex-1 items-center justify-end gap-1.5">
              <button onClick={() => s.setPlayerViewMode('card')} title="Card view" className="hidden rounded-full p-2 text-indigo-100 hover:bg-white/10 hover:text-white sm:block"><LayoutGrid size={17} /></button>
              <button onClick={() => setQueueOpen((v) => !v)} title="Queue" className="rounded-full p-2 text-indigo-100 hover:bg-white/10 hover:text-white"><ListMusic size={17} /></button>
              <button onClick={s.openFullPlayer} title="Full screen player" className="rounded-full p-2 text-indigo-100 hover:bg-white/10 hover:text-white"><Maximize2 size={17} /></button>
              <VolumeControl textClass="text-indigo-100 hover:text-white" />
            </div>
          </div>
          <ErrorBanner />
        </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME 6: GLASS PRO — Frosted pill island
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'glasspro') {
    return (
      <>
        {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        <div
          ref={barRef}
          className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full text-white shadow-2xl transition-all duration-300"
          style={{
            background: 'rgba(10, 15, 30, 0.82)',
            backdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 15px 35px rgba(0,0,0,0.5), 0 0 20px rgba(56, 189, 248, 0.15)',
          }}
        >
          <div className="group relative h-1.5 cursor-pointer">
            <span aria-hidden className="absolute inset-0 bg-white/10" />
            <span aria-hidden className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #38bdf8, #818cf8)' }} />
            <input type="range" min={0} max={s.duration || 0} step={0.1} value={s.position} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Seek" className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100" />
          </div>

          <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button onClick={s.openFullPlayer} className="group flex min-w-0 items-center gap-3 rounded-xl text-left">
                <span className="relative shrink-0 overflow-hidden rounded-lg" style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.2)' }}>
                  <Artwork src={current.artwork} alt="" className="h-11 w-11" rounded="rounded-lg" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white group-hover:text-sky-300">{current.title}</span>
                  <span className="block truncate text-xs text-white/50">{current.artist}</span>
                </span>
              </button>
              <button onClick={() => toggleFavorite(current)} className={clsx('hidden shrink-0 rounded-full p-2 sm:block', fav ? 'text-sky-300' : 'text-white/40')}>
                <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>

            <TransportControls btnClass="text-white/60 hover:text-white hover:bg-white/10" playBg="bg-sky-400 text-slate-950 font-bold" />

            <div className="flex flex-1 items-center justify-end gap-1.5">
              <button onClick={() => s.setPlayerViewMode('card')} title="Card view" className="hidden rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white sm:block"><LayoutGrid size={17} /></button>
              <button onClick={() => setQueueOpen((v) => !v)} title="Queue" className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white"><ListMusic size={17} /></button>
              <button onClick={s.openFullPlayer} title="Full screen player" className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white"><Maximize2 size={17} /></button>
              <VolumeControl textClass="text-white/50 hover:text-white" />
            </div>
          </div>
          <ErrorBanner />
        </div>
      </>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME 7: CLASSIC (default) — Floating pill island
  // ════════════════════════════════════════════════════════════════════════
  return (
    <>
      {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}

      <div
        ref={barRef}
        className="fixed left-3 right-3 sm:left-6 sm:right-6 bottom-[calc(60px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-40 mx-auto max-w-5xl overflow-hidden rounded-3xl sm:rounded-full border border-ink-800 glass shadow-2xl transition-all duration-300"
      >
        <div className="group relative h-1.5 cursor-pointer">
          <span aria-hidden className="absolute inset-0 rounded-t bg-ink-700" />
          <span aria-hidden className="absolute inset-y-0 left-0 rounded-t bg-accent" style={{ width: `${pct}%` }} />
          <input
            type="range"
            min={0}
            max={s.duration || 0}
            step={0.1}
            value={s.position}
            onChange={(e) => s.seek(Number(e.target.value))}
            aria-label="Seek"
            className="seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100"
          />
        </div>

        <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={s.openFullPlayer}
              className="group flex min-w-0 items-center gap-3 rounded-lg text-left"
              aria-label={`Open full player for ${current.title}`}
            >
              <span className="relative shrink-0 overflow-hidden rounded-lg">
                <Artwork src={current.artwork} alt="" className="h-11 w-11" rounded="rounded-lg" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-white group-hover:text-accent">
                  {current.title}
                </span>
                <span className="flex items-center gap-1.5 truncate text-xs text-ink-400">
                  {s.fromCache && <HardDriveDownload size={11} className="shrink-0 text-accent" />}
                  {current.artist}
                </span>
              </span>
            </button>
            <button
              onClick={() => toggleFavorite(current)}
              className={clsx('hidden shrink-0 rounded-full p-2 hover:bg-ink-800 sm:block', fav ? 'text-accent' : 'text-ink-400')}
              title={fav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
            </button>
          </div>

          <TransportControls />

          <div className="flex flex-1 items-center justify-end gap-1.5">
            <button
              onClick={() => s.setPlayerViewMode('card')}
              title="Switch to floating card view"
              className="hidden rounded-full p-2 text-ink-400 hover:bg-ink-800 hover:text-white sm:block"
            >
              <LayoutGrid size={17} />
            </button>
            <button
              onClick={s.openFullPlayer}
              title="Full screen player"
              className="rounded-full p-2 text-ink-400 hover:bg-ink-800 hover:text-white"
            >
              <Maximize2 size={17} />
            </button>
            <button
              onClick={() => setQueueOpen((v) => !v)}
              title="Queue"
              className={clsx('rounded-full p-2 hover:bg-ink-800', queueOpen ? 'text-accent' : 'text-ink-400')}
            >
              <ListMusic size={17} />
            </button>
            <VolumeControl />
          </div>
        </div>

        <ErrorBanner />
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
  const panelRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointer = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    const id = setTimeout(() => document.addEventListener('pointerdown', onPointer))
    return () => {
      clearTimeout(id)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  return (
    <aside
      ref={panelRef}
      aria-label="Play queue"
      className="fixed right-3 sm:right-6 z-40 flex max-h-[60vh] w-[calc(100vw-24px)] sm:w-96 flex-col rounded-2xl border border-ink-800 glass shadow-2xl"
      style={{ bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}
    >
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Up next · {queue.length}</h2>
        <div className="flex items-center gap-1">
          <button onClick={clearQueue} className="rounded-full px-2 py-1 text-xs text-ink-400 hover:text-white">
            Clear
          </button>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-400 hover:bg-ink-800 hover:text-white"
            aria-label="Close queue"
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <ul ref={listRef} className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {queue.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-ink-400">
            Nothing queued yet. Play a track and the rest of its list lands here.
          </li>
        )}
        {queue.map((t, i) => (
          <li
            key={`${keyOf(t)}-${i}`}
            className={clsx(
              'group flex items-center gap-2 rounded-lg px-2 py-1.5',
              i === index ? 'bg-ink-800' : 'hover:bg-ink-800/60',
            )}
          >
            <button
              onClick={() => void playQueue(queue, i)}
              aria-current={i === index || undefined}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <Artwork src={t.artwork} alt="" className="h-8 w-8" rounded="rounded" />
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate text-xs font-medium', i === index ? 'text-accent' : 'text-white')}>
                  {t.title}
                </span>
                <span className="block truncate text-[11px] text-ink-400">{t.artist}</span>
              </span>
              {i === index && <NowPlayingBars className="mr-1 shrink-0" />}
            </button>
            <button
              onClick={() => removeFromQueue(i)}
              aria-label={`Remove ${t.title} from queue`}
              className="rounded p-1 text-ink-400 opacity-0 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X size={13} />
            </button>
          </li>
        ))}
        {queue.length > 0 && (
          <li>
            <QueueTailLoader scrollRoot={listRef} />
          </li>
        )}
      </ul>

      <QueueSuggestions onClose={onClose} />
    </aside>
  )
}

/**
 * Taste-driven picks shown beneath the queue: songs the listener can add, and
 * playlists/albums they can open. Fetched fresh each time the panel opens and
 * re-derived when the library's taste signal changes.
 */
function QueueSuggestions({ onClose }: { onClose: () => void }) {
  const enqueue = usePlayer((s) => s.enqueue)
  const queue = usePlayer((s) => s.queue)
  const favCount = useLibrary((s) => s.favorites.length)
  const recentCount = useLibrary((s) => s.recent.length)

  const [tracks, setTracks] = useState<Track[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [added, setAdded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let active = true
    void getSuggestions(6)
      .then((s) => {
        if (!active) return
        const inQueue = new Set(usePlayer.getState().queue.map(keyOf))
        setTracks(s.tracks.filter((t) => !inQueue.has(keyOf(t))).slice(0, 4))
        setCollections(s.collections.slice(0, 6))
      })
      .catch(() => {
        /* suggestions are optional — the queue works without them */
      })
    return () => {
      active = false
    }
    // Re-fetch when taste changes (a new favorite / freshly played track).
  }, [favCount, recentCount])

  const visibleTracks = tracks.filter((t) => !queue.some((q) => keyOf(q) === keyOf(t)))
  if (!visibleTracks.length && !collections.length) return null

  return (
    <div className="border-t border-ink-800 p-3">
      {visibleTracks.length > 0 && (
        <section className="space-y-1">
          <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
            <Sparkles size={11} aria-hidden /> Suggested songs
          </p>
          {visibleTracks.map((t) => {
            const k = keyOf(t)
            const isAdded = added.has(k)
            return (
              <div key={k} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-ink-800/60">
                <Artwork src={t.artwork} alt="" className="h-8 w-8" rounded="rounded" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-white">{t.title}</span>
                  <span className="block truncate text-[11px] text-ink-400">{t.artist}</span>
                </span>
                <button
                  onClick={() => {
                    enqueue(t)
                    setAdded((prev) => new Set(prev).add(k))
                  }}
                  disabled={isAdded}
                  title={isAdded ? 'Added to queue' : 'Add to queue'}
                  aria-label={`${isAdded ? 'Added' : 'Add'} ${t.title} to queue`}
                  className={clsx(
                    'rounded-full p-1.5 transition',
                    isAdded ? 'text-accent' : 'text-ink-400 hover:bg-ink-700 hover:text-white',
                  )}
                >
                  {isAdded ? <ListMusic size={14} /> : <ListPlus size={14} />}
                </button>
              </div>
            )
          })}
        </section>
      )}

      {collections.length > 0 && (
        <section className="mt-3 space-y-1.5">
          <p className="px-1 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
            Playlists you may like
          </p>
          <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
            {collections.map((c) => (
              <Link
                key={`${c.source}-${c.id}`}
                to={`/playlist/${c.id}`}
                onClick={onClose}
                className="w-[76px] shrink-0"
                title={c.title}
              >
                <Artwork src={c.artwork} alt="" className="aspect-square w-full ring-1 ring-white/10" rounded="rounded-lg" />
                <span className="mt-1 block truncate text-[11px] text-ink-300">{c.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
