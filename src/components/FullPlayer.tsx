import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Share2, Music2, Video, FileText, Check, ListMusic,
  Download, Sparkles, Info, Loader2, Maximize2, Flower2, Sun,
} from 'lucide-react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { useDownloads } from '@/hooks/useDownloads'
import { fetchLyrics, type LyricsData } from '@/services/lyrics'
import { extractColorFromImage } from '@/lib/colorExtractor'
import { copyText } from '@/lib/clipboard'
import { formatDuration } from '@/lib/format'
import { Artwork, NowPlayingBars, QueueTailLoader, SeekRange } from './ui'
import { CastButton } from './CastButton'
import { keyOf } from '@/lib/db'
import { usePlayerTheme } from '@/contexts/PlayerThemeContext'

const INITIAL_BACKDROP = 'linear-gradient(180deg, rgba(30, 20, 50, 0.98) 0%, rgba(15, 10, 25, 1) 100%)'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function FullPlayer() {
  const s = usePlayer()
  const isFavorite = useLibrary((l) => l.isFavorite)
  const toggleFavorite = useLibrary((l) => l.toggleFavorite)
  const { playerTheme } = usePlayerTheme()

  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  const [loadingLyrics, setLoadingLyrics] = useState(false)
  const [activeTab, setActiveTab] = useState<'lyrics' | 'queue' | 'info'>('lyrics')
  const [showRightPanel, setShowRightPanel] = useState(true)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [mode, setMode] = useState<'song' | 'video'>('song')
  const [bgGradient, setBgGradient] = useState(INITIAL_BACKDROP)

  const lyricsContainerRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const queueListRef = useRef<HTMLUListElement>(null)
  const restoreFocusTo = useRef<Element | null>(null)

  const current = s.current
  const open = s.fullPlayerOpen && !!current
  const closeFullPlayer = s.closeFullPlayer

  const { status: downloadStatus, download, remove: removeDownload, supported: downloadSupported } =
    useDownloads(current)

  useEffect(() => {
    if (!current) return
    let active = true
    extractColorFromImage(current.artwork, current.id || current.title, (_rgb, gradient) => {
      if (active) setBgGradient(gradient)
    })
    return () => {
      active = false
    }
  }, [current?.id, current?.artwork, current?.title])

  useEffect(() => {
    if (!current) return
    const controller = new AbortController()
    setLoadingLyrics(true)
    setLyrics(null)

    void fetchLyrics(current.title, current.artist, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setLyrics(data)
        setLoadingLyrics(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadingLyrics(false)
      })

    return () => controller.abort()
  }, [current?.id, current?.title, current?.artist])

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1
    let found = -1
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (s.position >= lyrics.lines[i].time) found = i
      else break
    }
    return found
  }, [lyrics, s.position])

  useEffect(() => {
    const line = activeLineRef.current
    const box = lyricsContainerRef.current
    if (!line || !box || activeTab !== 'lyrics' || !showRightPanel) return

    const target = line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2
    box.scrollTo({
      top: Math.max(0, target),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [activeIndex, activeTab, showRightPanel])

  useEffect(() => {
    if (!open) return

    restoreFocusTo.current = document.activeElement
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeFullPlayer()
      }
    }
    document.addEventListener('keydown', onKey)
    dialogRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus()
    }
  }, [open, closeFullPlayer])

  const handleShare = useCallback(async () => {
    if (!current) return
    const url = `${window.location.origin}/search?q=${encodeURIComponent(`${current.title} ${current.artist}`)}`
    const data = { title: current.title, text: `${current.title} — ${current.artist}`, url }
    const done = (state: 'copied' | 'failed') => {
      setShareState(state)
      setTimeout(() => setShareState('idle'), 2500)
    }

    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data)
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }

    done((await copyText(url)) ? 'copied' : 'failed')
  }, [current])

  const togglePanel = (tab: 'lyrics' | 'queue' | 'info') => {
    if (showRightPanel && activeTab === tab) {
      setShowRightPanel(false)
    } else {
      setShowRightPanel(true)
      setActiveTab(tab)
    }
  }

  // Switching to a video-less track leaves the (disabled) Video pill selected
  // otherwise — the mode must follow what's actually available.
  const videoActive = s.videoActive
  useEffect(() => {
    if (!videoActive) setMode('song')
  }, [videoActive])

  if (!open || !current) return null

  const fav = isFavorite(current)
  const pct = s.duration ? (s.position / s.duration) * 100 : 0
  const videoAvailable = s.videoActive

  /*
    These are plain render helpers CALLED as functions (`{ScrubBar({})}`), not
    mounted as JSX components. Defined inside the component, their identity
    changes every render — and this dialog re-renders ~4×/s on timeupdates —
    so JSX component usage made React remount the whole subtree each tick:
    queue/lyrics scroll positions reset, drags dropped, observers rebuilt.
    Function calls inline their output into THIS component's element tree, so
    reconciliation sees stable elements. (Same defect PlayerBar already fixed
    by hoisting; these need the parent's state, so they stay as helpers.)
  */
  const ScrubBar = ({ className = '' }: { className?: string }) => (
    <div className={clsx('w-full space-y-2 px-2', className)}>
      <div className="group relative h-2 cursor-pointer rounded-full bg-white/20">
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
        <SeekRange />
      </div>
      <div className="flex items-center justify-between text-xs font-medium tabular-nums text-white/80">
        <span>{formatDuration(s.position)}</span>
        <span>{formatDuration(s.duration)}</span>
      </div>
    </div>
  )

  const Transport = ({ size = 'md' }: { size?: 'sm' | 'md' }) => (
    <div className={clsx('flex w-full items-center justify-center', size === 'md' ? 'gap-6 px-4 pt-1' : 'gap-4')}>
      <button
        onClick={s.toggleShuffle}
        aria-pressed={s.shuffle}
        className={clsx('rounded-full p-2.5 transition hover:bg-white/10', s.shuffle ? 'text-accent' : 'text-white/70')}
        title="Shuffle" aria-label="Shuffle"
      >
        <Shuffle size={size === 'md' ? 20 : 17} />
      </button>
      <button
        onClick={() => void s.prev()}
        className="rounded-full p-2.5 text-white transition hover:bg-white/10"
        title="Previous" aria-label="Previous track"
      >
        <SkipBack size={size === 'md' ? 26 : 22} fill="currentColor" />
      </button>
      <button
        onClick={s.toggle}
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-ink-950 shadow-2xl transition hover:scale-105 active:scale-95 glow-accent"
        title={s.playing ? 'Pause' : 'Play'} aria-label={s.playing ? 'Pause' : 'Play'}
      >
        {s.playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
      </button>
      <button
        onClick={() => void s.next()}
        className="rounded-full p-2.5 text-white transition hover:bg-white/10"
        title="Next" aria-label="Next track"
      >
        <SkipForward size={size === 'md' ? 26 : 22} fill="currentColor" />
      </button>
      <button
        onClick={s.cycleRepeat}
        className={clsx('rounded-full p-2.5 transition hover:bg-white/10', s.repeat !== 'off' ? 'text-accent' : 'text-white/70')}
        title={`Repeat: ${s.repeat}`}
        aria-label={`Repeat mode: ${s.repeat}`}
      >
        {s.repeat === 'one' ? <Repeat1 size={size === 'md' ? 20 : 17} /> : <Repeat size={size === 'md' ? 20 : 17} />}
      </button>
    </div>
  )

  const FavButton = () => (
    <button
      onClick={() => toggleFavorite(current)}
      aria-pressed={fav}
      className={clsx(
        'flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition',
        fav ? 'bg-accent/15 text-accent' : 'text-white/70 hover:bg-white/10 hover:text-white',
      )}
      title={fav ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Heart size={18} fill={fav ? 'currentColor' : 'none'} />
      {fav ? 'In your favorites' : 'Add to favorites'}
    </button>
  )

  const ModeBar = () => (
    <div
      role="group"
      aria-label="Playback mode"
      className="flex items-center rounded-full border border-white/10 bg-black/50 p-1 backdrop-blur-md"
    >
      <button
        onClick={() => setMode('song')}
        aria-pressed={mode === 'song'}
        className={clsx(
          'flex items-center gap-1.5 rounded-full px-4 py-1 text-xs font-semibold transition',
          mode === 'song' ? 'bg-white text-ink-950 shadow' : 'text-white/70 hover:text-white',
        )}
      >
        <Music2 size={13} />Song
      </button>
      <button
        onClick={() => { setMode('video'); if (!s.videoExpanded) s.toggleVideoExpanded() }}
        disabled={!videoAvailable}
        aria-pressed={mode === 'video'}
        title={videoAvailable ? 'Show the video' : 'This track has no video'}
        className={clsx(
          'flex items-center gap-1.5 rounded-full px-4 py-1 text-xs font-semibold transition',
          'disabled:cursor-not-allowed disabled:opacity-40',
          mode === 'video' ? 'bg-white text-ink-950 shadow' : 'text-white/70 hover:text-white',
        )}
      >
        <Video size={13} />Video
      </button>
    </div>
  )

  const ShareResult = () => (
    <>
      <p role="status" className="sr-only">
        {shareState === 'copied' ? 'Link copied to clipboard' : shareState === 'failed' ? 'Could not copy the link' : ''}
      </p>
      {shareState === 'copied' && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
          <Check size={13} /> Link copied to clipboard
        </p>
      )}
      {shareState === 'failed' && (
        <p className="text-xs text-accent-soft">Couldn't copy the link — your browser blocked clipboard access.</p>
      )}
    </>
  )

  // ── Right panel (lyrics / queue / info) ──────────────────────────────────
  const RightPanel = ({ className = '' }: { className?: string }) =>
    showRightPanel ? (
      <div className={clsx('relative flex flex-col overflow-hidden rounded-3xl border border-white/15 bg-black/40 p-5 shadow-2xl backdrop-blur-2xl sm:p-6', className)}>
        <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
          <div role="tablist" aria-label="Track details" className="flex items-center gap-2">
            {([
              { id: 'lyrics', label: 'Lyrics', Icon: Sparkles },
              { id: 'queue', label: `Queue (${s.queue.length})`, Icon: ListMusic },
              { id: 'info', label: 'Info', Icon: Info },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition',
                  activeTab === id ? 'bg-accent text-ink-950 shadow' : 'text-white/70 hover:text-white',
                )}
              >
                <Icon size={13} />{label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setShowRightPanel(false)
            }}
            className="z-30 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white active:scale-95"
            title="Hide this panel"
            aria-label="Hide lyrics and queue panel"
          >
            <ChevronDown size={20} className="rotate-90" />
          </button>
        </div>

        {activeTab === 'lyrics' && (
          <div ref={lyricsContainerRef} className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
            {loadingLyrics ? (
              <div className="flex h-full flex-col items-center justify-center space-y-3 text-white/70">
                <Loader2 size={24} className="animate-spin text-accent" />
                <p className="text-sm font-medium">Fetching lyrics…</p>
              </div>
            ) : lyrics && lyrics.lines.length > 0 ? (
              <>
                {!lyrics.synced && (
                  <p className="pb-2 text-center text-xs text-white/70">Only unsynced lyrics were found for this track.</p>
                )}
                {lyrics.lines.map((line, idx) => {
                  const isActive = idx === activeIndex
                  const seekable = lyrics.synced && line.time > 0
                  const className = clsx(
                    'block w-full origin-left rounded-xl px-3 py-1.5 text-left font-sans text-lg leading-snug transition-all duration-300 sm:text-2xl lg:text-3xl',
                    isActive ? 'scale-[1.02] bg-white/20 font-extrabold text-white' : 'font-medium text-white/55',
                    seekable && !isActive && 'hover:text-white',
                  )
                  const captureRef = isActive ? (el: HTMLElement | null) => { activeLineRef.current = el } : undefined
                  return seekable ? (
                    <button key={`${line.time}-${idx}`} ref={captureRef} onClick={() => s.seek(line.time)} aria-current={isActive || undefined} className={clsx(className, 'cursor-pointer')}>{line.text}</button>
                  ) : (
                    <p key={`${line.time}-${idx}`} ref={captureRef} className={className}>{line.text}</p>
                  )
                })}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center space-y-2 text-center text-white/70">
                <FileText size={36} className="text-white/40" />
                <p className="font-semibold text-white">No lyrics available</p>
                <p className="max-w-xs text-xs">We couldn't find lyrics for this track. Playback is unaffected.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'queue' && (
          <ul ref={queueListRef} className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto py-2 pr-2">
            {s.queue.map((t, idx) => {
              // key-based, not index-based: after removing the playing track
              // the index no longer matches what's audible; the key always does
              const isCurrent = !!current && keyOf(t) === keyOf(current)
              return (
                <li key={`${keyOf(t)}-${idx}`}>
                  <button
                    onClick={() => void s.jumpTo(idx)}
                    aria-current={isCurrent || undefined}
                    className={clsx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition', isCurrent ? 'bg-white/20' : 'hover:bg-white/10')}
                  >
                    <Artwork src={t.artwork} alt="" className="h-10 w-10 shrink-0" rounded="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className={clsx('truncate text-sm font-semibold', isCurrent ? 'text-accent' : 'text-white')}>{t.title}</p>
                      <p className="truncate text-xs text-white/70">{t.artist}</p>
                    </div>
                    {isCurrent ? <NowPlayingBars /> : <span className="text-xs tabular-nums text-white/70">{formatDuration(t.duration)}</span>}
                  </button>
                </li>
              )
            })}
            {s.queue.length > 0 && <li><QueueTailLoader scrollRoot={queueListRef} /></li>}
          </ul>
        )}

        {activeTab === 'info' && (
          <dl className="flex-1 space-y-4 overflow-y-auto p-2 text-sm text-white/80">
            {[
              ['Title', current.title],
              ['Artist', current.artist],
              ['Source', current.source],
              ['Length', formatDuration(current.duration)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-xs tracking-wider text-white/70 uppercase">{label}</dt>
                <dd className="mt-1 text-base font-bold text-white">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    ) : null

  const MobileFooter = ({ className = '' }: { className?: string }) => (
    <footer
      className={clsx(
        'relative z-20 flex items-center justify-around border-t border-white/10 bg-black/40 pt-3 backdrop-blur-xl lg:hidden',
        className,
      )}
      style={{
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)',
      }}
    >
      <button
        onClick={() => togglePanel('queue')}
        aria-pressed={activeTab === 'queue' && showRightPanel}
        className={clsx('flex min-h-11 items-center gap-2 px-3 text-xs font-semibold transition', activeTab === 'queue' && showRightPanel ? 'text-accent' : 'text-white/70')}
      >
        <ListMusic size={17} />Queue
      </button>
      <CastButton variant="labeled" />
      {downloadSupported && (
        <button
          onClick={() => (downloadStatus === 'done' ? void removeDownload() : void download())}
          aria-busy={downloadStatus === 'downloading' || undefined}
          className={clsx('flex min-h-11 items-center gap-2 px-3 text-xs font-semibold transition', downloadStatus === 'done' ? 'text-accent' : 'text-white/70')}
        >
          {downloadStatus === 'downloading' ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
          {downloadStatus === 'done' ? 'Saved' : 'Download'}
        </button>
      )}
      <button
        onClick={() => togglePanel('info')}
        aria-pressed={activeTab === 'info' && showRightPanel}
        className={clsx('flex min-h-11 items-center gap-2 px-3 text-xs font-semibold transition', activeTab === 'info' && showRightPanel ? 'text-accent' : 'text-white/70')}
      >
        <Info size={17} />Info
      </button>
    </footer>
  )

  // ════════════════════════════════════════════════════════════════════════
  // THEME: CHERRY BLOSSOM
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'cherry-blossom') {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Now playing: ${current.title}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: 'linear-gradient(135deg, #2e050e 0%, #4a0e17 40%, #881337 75%, #9f1239 100%)' }}
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4 backdrop-blur-sm" style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20"><ChevronDown size={22} /></button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-rose-200 uppercase"><Flower2 size={15} className="text-rose-400" /> Cherry Blossom</span>
          <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"><FileText size={18} /></button>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-around overflow-y-auto px-6 pb-6 pt-2">
          <div className={clsx('relative aspect-square transition-all duration-300', showRightPanel ? 'w-52 sm:w-64' : 'w-64 sm:w-80 lg:w-96')}>
            <div className="absolute inset-0 rounded-full bg-rose-500/30 blur-2xl animate-pulse" />
            <div className="relative overflow-hidden rounded-full border-4 border-rose-300/30 shadow-2xl">
              <Artwork src={current.artwork} alt="" className="h-full w-full" rounded="rounded-full" />
            </div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-xs font-semibold tracking-widest text-rose-300 uppercase">{current.artist}</p>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-white">{current.title}</h1>
          </div>

          {ScrubBar({ className: showRightPanel ? '' : 'max-w-md' })}
          {Transport({})}

          <div className="flex items-center gap-3">
            {FavButton()}
            <button onClick={() => void handleShare()} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20">
              {shareState === 'copied' ? <Check size={14} /> : <Share2 size={14} />} {shareState === 'copied' ? 'Copied' : 'Share'}
            </button>
          </div>

          {!showRightPanel && (
            <button
              onClick={() => setShowRightPanel(true)}
              className="flex items-center gap-2 rounded-full border border-rose-300/30 bg-rose-500/20 px-5 py-2 text-xs font-semibold text-rose-100 backdrop-blur-md transition hover:bg-rose-500/30 hover:scale-105 active:scale-95"
            >
              <Sparkles size={14} className="text-rose-300" /> Show Lyrics & Queue
            </button>
          )}

          {showRightPanel && RightPanel({ className: 'w-full max-w-md h-64 border-rose-500/20 bg-rose-950/40' })}
        </div>
        {MobileFooter({ className: 'border-rose-500/20 bg-rose-950/40' })}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME: SUNSET SHADES
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'sunset-shades') {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Now playing: ${current.title}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: 'linear-gradient(135deg, #3b1207 0%, #7c2d12 40%, #c2410c 70%, #f97316 100%)' }}
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4 backdrop-blur-sm" style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20"><ChevronDown size={22} /></button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-amber-200 uppercase"><Sun size={15} className="text-amber-400" /> Sunset Shades</span>
          <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"><FileText size={18} /></button>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-around overflow-y-auto px-6 pb-6 pt-2">
          <div className={clsx('relative aspect-square transition-all duration-300', showRightPanel ? 'w-52 sm:w-64' : 'w-64 sm:w-80 lg:w-96')}>
            <div className="absolute inset-0 rounded-3xl bg-amber-500/30 blur-2xl" />
            <div className="relative overflow-hidden rounded-3xl border-4 border-amber-300/30 shadow-2xl">
              <Artwork src={current.artwork} alt="" className="h-full w-full" rounded="rounded-3xl" />
            </div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-xs font-semibold tracking-widest text-amber-200 uppercase">{current.artist}</p>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-white">{current.title}</h1>
          </div>

          {ScrubBar({ className: showRightPanel ? '' : 'max-w-md' })}
          {Transport({})}

          <div className="flex items-center gap-3">
            {FavButton()}
            <button onClick={() => void handleShare()} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20">
              {shareState === 'copied' ? <Check size={14} /> : <Share2 size={14} />} {shareState === 'copied' ? 'Copied' : 'Share'}
            </button>
          </div>

          {!showRightPanel && (
            <button
              onClick={() => setShowRightPanel(true)}
              className="flex items-center gap-2 rounded-full border border-amber-300/30 bg-orange-500/20 px-5 py-2 text-xs font-semibold text-amber-100 backdrop-blur-md transition hover:bg-orange-500/30 hover:scale-105 active:scale-95"
            >
              <Sparkles size={14} className="text-amber-300" /> Show Lyrics & Queue
            </button>
          )}

          {showRightPanel && RightPanel({ className: 'w-full max-w-md h-64 border-orange-500/20 bg-orange-950/40' })}
        </div>
        {MobileFooter({ className: 'border-orange-500/20 bg-orange-950/40' })}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME: ARC STUDIO
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'arc-studio') {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Now playing: ${current.title}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: 'linear-gradient(135deg, #022c22 0%, #064e3b 40%, #0f766e 70%, #06b6d4 100%)' }}
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4 backdrop-blur-sm" style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20"><ChevronDown size={22} /></button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-cyan-200 uppercase"><Sparkles size={15} className="text-cyan-400" /> Arc Studio</span>
          <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"><FileText size={18} /></button>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-around overflow-y-auto px-6 pb-6 pt-2">
          <div className={clsx('relative aspect-[4/5] transition-all duration-300', showRightPanel ? 'w-52 sm:w-64' : 'w-60 sm:w-72 lg:w-80')}>
            <div className="absolute inset-0 rounded-t-[100px] rounded-b-3xl bg-cyan-500/25 blur-2xl" />
            <div className="relative overflow-hidden rounded-t-[100px] rounded-b-3xl border-4 border-cyan-300/40 shadow-2xl">
              <Artwork src={current.artwork} alt="" className="h-full w-full object-cover" rounded="rounded-t-[100px] rounded-b-3xl" />
            </div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-xs font-semibold tracking-widest text-cyan-200 uppercase">{current.artist}</p>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-white">{current.title}</h1>
          </div>

          {ScrubBar({ className: showRightPanel ? '' : 'max-w-md' })}
          {Transport({})}

          <div className="flex items-center gap-3">
            {FavButton()}
            <button onClick={() => void handleShare()} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20">
              {shareState === 'copied' ? <Check size={14} /> : <Share2 size={14} />} {shareState === 'copied' ? 'Copied' : 'Share'}
            </button>
          </div>

          {!showRightPanel && (
            <button
              onClick={() => setShowRightPanel(true)}
              className="flex items-center gap-2 rounded-full border border-cyan-300/30 bg-teal-500/20 px-5 py-2 text-xs font-semibold text-cyan-100 backdrop-blur-md transition hover:bg-teal-500/30 hover:scale-105 active:scale-95"
            >
              <Sparkles size={14} className="text-cyan-300" /> Show Lyrics & Queue
            </button>
          )}

          {showRightPanel && RightPanel({ className: 'w-full max-w-md h-64 border-cyan-500/20 bg-teal-950/40' })}
        </div>
        {MobileFooter({ className: 'border-cyan-500/20 bg-teal-950/40' })}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME: COSMIC AURORA
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'cosmic-aurora') {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Now playing: ${current.title}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: 'linear-gradient(135deg, #090d16 0%, #1e1b4b 45%, #4338ca 75%, #6366f1 100%)' }}
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4 backdrop-blur-sm" style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20"><ChevronDown size={22} /></button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-indigo-200 uppercase"><Sparkles size={15} className="text-indigo-400" /> Cosmic Aurora</span>
          <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"><FileText size={18} /></button>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-around overflow-y-auto px-6 pb-6 pt-2">
          <div className={clsx('relative aspect-square transition-all duration-300', showRightPanel ? 'w-52 sm:w-64' : 'w-64 sm:w-80 lg:w-96')}>
            <div className="absolute inset-0 rounded-full bg-indigo-500/35 blur-3xl animate-pulse" />
            <div className="relative overflow-hidden rounded-full border-4 border-indigo-300/40 shadow-2xl glow-accent">
              <Artwork src={current.artwork} alt="" className="h-full w-full" rounded="rounded-full" />
            </div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-xs font-semibold tracking-widest text-indigo-200 uppercase">{current.artist}</p>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-white">{current.title}</h1>
          </div>

          {ScrubBar({ className: showRightPanel ? '' : 'max-w-md' })}
          {Transport({})}

          <div className="flex items-center gap-3">
            {FavButton()}
            <button onClick={() => void handleShare()} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20">
              {shareState === 'copied' ? <Check size={14} /> : <Share2 size={14} />} {shareState === 'copied' ? 'Copied' : 'Share'}
            </button>
          </div>

          {!showRightPanel && (
            <button
              onClick={() => setShowRightPanel(true)}
              className="flex items-center gap-2 rounded-full border border-indigo-300/30 bg-indigo-500/20 px-5 py-2 text-xs font-semibold text-indigo-100 backdrop-blur-md transition hover:bg-indigo-500/30 hover:scale-105 active:scale-95"
            >
              <Sparkles size={14} className="text-indigo-300" /> Show Lyrics & Queue
            </button>
          )}

          {showRightPanel && RightPanel({ className: 'w-full max-w-md h-64 border-indigo-500/20 bg-indigo-950/40' })}
        </div>
        {MobileFooter({ className: 'border-indigo-500/20 bg-indigo-950/40' })}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME: MINIMAL
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'minimal') {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Now playing: ${current.title}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-gray-950 text-white outline-none"
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full p-2 text-gray-400 hover:text-white"><ChevronDown size={24} /></button>
          <span className="text-[11px] font-semibold tracking-[0.2em] text-gray-500 uppercase">Minimal</span>
          <button onClick={() => void handleShare()} className="rounded-full p-2 text-gray-400 hover:text-white">
            {shareState === 'copied' ? <Check size={20} /> : <Share2 size={20} />}
          </button>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-start gap-6 overflow-y-auto px-6 py-4">
          <div className="flex w-full max-w-4xl flex-col items-center gap-4 lg:flex-row lg:items-center lg:justify-around">
            <div className="relative aspect-square w-48 shrink-0 overflow-hidden rounded-2xl shadow-2xl sm:w-60">
              <Artwork src={current.artwork} alt="" className="h-full w-full" rounded="rounded-2xl" />
            </div>

            <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center lg:items-start lg:text-left">
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight">{current.title}</h1>
                <p className="text-sm text-gray-400">{current.artist}</p>
              </div>

              <div className="w-full space-y-2">
                <div className="group relative h-1 cursor-pointer rounded-full bg-gray-800">
                  <div aria-hidden className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${pct}%` }} />
                  <SeekRange />
                </div>
                <div className="flex items-center justify-between text-[11px] tabular-nums text-gray-500">
                  <span>{formatDuration(s.position)}</span>
                  <span>{formatDuration(s.duration)}</span>
                </div>
              </div>

              <div className="flex w-full items-center justify-between">
                <button onClick={s.toggleShuffle} className={clsx('p-2', s.shuffle ? 'text-white' : 'text-gray-600')}><Shuffle size={18} /></button>
                <button onClick={() => void s.prev()} className="p-2 text-white"><SkipBack size={22} fill="currentColor" /></button>
                <button onClick={s.toggle} className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-950 font-bold shadow-lg">
                  {s.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
                </button>
                <button onClick={() => void s.next()} className="p-2 text-white"><SkipForward size={22} fill="currentColor" /></button>
                <button onClick={s.cycleRepeat} className={clsx('p-2', s.repeat !== 'off' ? 'text-white' : 'text-gray-600')}><Repeat size={18} /></button>
              </div>

              <div className="flex items-center gap-3">
                {FavButton()}
                <button onClick={() => togglePanel('lyrics')} className={clsx('rounded-full px-3.5 py-1.5 text-xs font-semibold transition', showRightPanel ? 'bg-white text-gray-950' : 'bg-gray-800 text-gray-400')}>
                  Lyrics & Queue
                </button>
              </div>
            </div>
          </div>

          {showRightPanel && (
            RightPanel({ className: 'w-full max-w-4xl h-[400px] lg:h-[500px] border-gray-800 bg-gray-900/60' })
          )}
        </div>

        {MobileFooter({ className: 'border-gray-800 bg-gray-950' })}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME: CLASSIC / NEUMORPHIC / VIBRANT / GLASS PRO
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${current.title}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0b0914] text-white outline-none"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 transition-[background] duration-700" style={{ background: bgGradient }}>
        {current.artwork && (
          <img src={current.artwork} alt="" className="h-full w-full scale-125 object-cover opacity-25 blur-3xl mix-blend-overlay" />
        )}
      </div>

      <header className="relative z-20 flex items-center justify-between border-b border-white/10 bg-black/30 px-4 py-3 backdrop-blur-xl sm:px-6" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 0.75rem)' }}>
        <button onClick={closeFullPlayer} className="rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-white" title="Minimize player">
          <ChevronDown size={24} />
        </button>
        {ModeBar()}
        <div className="flex items-center gap-1">
          <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} className={clsx('rounded-full p-2 transition hover:bg-white/10 lg:hidden', activeTab === 'lyrics' && showRightPanel ? 'text-accent' : 'text-white/70')}>
            <FileText size={21} />
          </button>
          <button onClick={() => void handleShare()} className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white lg:hidden" title="Share track">
            {shareState === 'copied' ? <Check size={21} className="text-accent" /> : <Share2 size={21} />}
          </button>
          <button onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {}); else void document.exitFullscreen().catch(() => {}) }} className="hidden rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white lg:block">
            <Maximize2 size={20} />
          </button>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-center gap-6 overflow-y-auto p-4 sm:p-8 lg:grid-cols-12 lg:gap-10">
        <div className={clsx('mx-auto flex w-full flex-col items-center justify-center space-y-5 text-center transition-all duration-300', showRightPanel ? 'max-w-md lg:col-span-5' : 'max-w-xl lg:col-span-12')}>
          <div className="hidden w-full max-w-sm items-center justify-center gap-5 border-b border-white/10 pb-2 lg:flex">
            <button onClick={() => setShowRightPanel((v) => !v)} aria-pressed={showRightPanel} className={clsx('flex h-11 w-11 items-center justify-center rounded-full shadow-xl transition hover:scale-105 active:scale-95', showRightPanel ? 'bg-white text-ink-950 ring-4 ring-white/20 glow-accent' : 'bg-white/20 text-white hover:bg-white/30')}>
              <FileText size={19} />
            </button>
            <CastButton />
            <button onClick={() => void handleShare()} className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
              {shareState === 'copied' ? <Check size={19} className="text-accent" /> : <Share2 size={19} />}
            </button>
            {downloadSupported && (
              <button onClick={() => (downloadStatus === 'done' ? void removeDownload() : void download())} className={clsx('rounded-full p-2 transition hover:bg-white/10', downloadStatus === 'done' ? 'text-accent' : 'text-white/70 hover:text-white')}>
                {downloadStatus === 'downloading' ? <Loader2 size={19} className="animate-spin text-accent" /> : <Download size={19} />}
              </button>
            )}
          </div>
          {ShareResult()}
          <div className={clsx('relative aspect-square w-full overflow-hidden rounded-3xl border border-white/20 shadow-2xl transition-all duration-300 glow-accent', showRightPanel ? 'max-w-[270px] sm:max-w-[310px]' : 'max-w-[340px] sm:max-w-[420px]')}>
            <Artwork src={current.artwork} alt="" className="h-full w-full" rounded="rounded-3xl" />
          </div>
          <div className="w-full space-y-1 px-2 text-center">
            <p className="truncate text-xs font-semibold tracking-widest text-white/80 uppercase">{current.artist}</p>
            <h1 className="font-display line-clamp-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">{current.title}</h1>
          </div>
          {ScrubBar({})}
          {Transport({})}
          <div className="flex w-full max-w-xs items-center justify-center pt-1">{FavButton()}</div>
          {!showRightPanel && (
            <button
              onClick={() => setShowRightPanel(true)}
              className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-xs font-semibold backdrop-blur-md transition hover:bg-white/20 hover:scale-105 active:scale-95 text-white"
            >
              <Sparkles size={14} className="text-accent" /> Show Lyrics & Queue
            </button>
          )}
        </div>
        {RightPanel({ className: 'h-[420px] lg:col-span-7 lg:h-[580px]' })}
      </div>
      {MobileFooter({})}
    </div>
  )
}
