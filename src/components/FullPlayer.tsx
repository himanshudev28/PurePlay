import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Share2, Music2, Video, FileText, Check, ListMusic,
  Download, Sparkles, Info, Loader2, Maximize2, Flower2, Sun, MoreVertical, Trash2,
  Moon, ChevronRight, HardDriveDownload,
} from 'lucide-react'
import clsx from 'clsx'
import { usePlayer, usePlayerChrome } from '@/store/player'
import { useIsFavorite, useLibrary } from '@/store/library'
import { useDownloads } from '@/hooks/useDownloads'
import { fetchLyrics, type LyricsData } from '@/services/lyrics'
import { extractColorFromImage } from '@/lib/colorExtractor'
import { copyText } from '@/lib/clipboard'
import { formatDuration } from '@/lib/format'
import {
  Artwork, DurationLabel, NowPlayingBars, PositionLabel, QueueTailLoader, SeekRange, TransportLock,
  useSeekProgressVar, useTransportLocked,
} from './ui'
import { CastButton } from './CastButton'
import { keyOf } from '@/lib/db'
import { usePlayerTheme } from '@/contexts/PlayerThemeContext'
import { useOverlayHistory } from '@/hooks/useOverlayHistory'

const INITIAL_BACKDROP = 'linear-gradient(180deg, rgba(30, 20, 50, 0.98) 0%, rgba(15, 10, 25, 1) 100%)'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function FullPlayer() {
  const s = usePlayerChrome()
  // the progress fills below paint from `--seek-pct`, written straight to the
  // document — this dialog is far too big to rebuild four times a second
  useSeekProgressVar()
  const transportLocked = useTransportLocked()
  const toggleFavorite = useLibrary((l) => l.toggleFavorite)
  // hook, so it must run before the `open` bail-out below
  const fav = useIsFavorite(s.current)
  const { playerTheme } = usePlayerTheme()

  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  const [loadingLyrics, setLoadingLyrics] = useState(false)
  const [activeTab, setActiveTab] = useState<'lyrics' | 'queue' | 'info'>('lyrics')
  const [showRightPanel, setShowRightPanel] = useState(true)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [mode, setMode] = useState<'song' | 'video'>('song')
  const [bgGradient, setBgGradient] = useState(INITIAL_BACKDROP)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)

  const lyricsContainerRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const queueListRef = useRef<HTMLUListElement>(null)
  const restoreFocusTo = useRef<Element | null>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  /*
    Read by the dialog's Escape handler, which is registered once when the
    player opens. A plain `menuOpen` dependency there would tear down and
    re-register the listener on every menu toggle; the ref lets one stable
    handler ask "is the menu up?" at the moment the key is pressed.
  */
  const menuOpenRef = useRef(false)
  menuOpenRef.current = menuOpen

  const current = s.current
  const open = s.fullPlayerOpen && !!current
  const closeFullPlayer = s.closeFullPlayer

  // Back / the edge-swipe gesture dismisses the player, like any other screen.
  useOverlayHistory(open, closeFullPlayer, 'full-player')

  const {
    status: downloadStatus, download, remove: removeDownload, supported: downloadSupported,
    saveStatus, saveToDevice,
  } = useDownloads(current)

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

  /*
    Synced lyrics are the only part of this dialog that has to follow the
    playhead, so they are also the only reason to subscribe to it — and only
    while a synced set is actually loaded. The selector collapses to a constant
    otherwise, so an unsynced track — most of them — schedules no renders here
    at all.
  */
  const followsLyrics = !!lyrics?.synced
  /*
    Quantised to the quarter-second the engines already report on, so the
    highlight lands exactly where it did before — never ahead of the audio —
    while identical ticks stop scheduling identical renders.
  */
  const lyricTime = usePlayer((st) => (followsLyrics ? Math.floor(st.position * 4) / 4 : 0))

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1
    let found = -1
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (lyricTime >= lyrics.lines[i].time) found = i
      else break
    }
    return found
  }, [lyrics, lyricTime])

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
      if (e.key !== 'Escape') return
      e.stopPropagation()
      // Escape dismisses one layer at a time: the menu first, the player only
      // once nothing is open on top of it.
      if (menuOpenRef.current) setMenuOpen(false)
      else closeFullPlayer()
    }
    document.addEventListener('keydown', onKey)
    dialogRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus()
    }
  }, [open, closeFullPlayer])

  // Dismiss the actions menu on an outside press, and whenever the context it
  // was opened against changes out from under it.
  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: PointerEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const id = setTimeout(() => document.addEventListener('pointerdown', onPointer))
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [menuOpen])

  useEffect(() => setMenuOpen(false), [current?.id, open])
  useEffect(() => {
    if (!menuOpen) setSleepOpen(false)
  }, [menuOpen])

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

  /*
    Drive the shared video frame (it lives in PlaybackHost and can't be moved
    here without reloading it). Undocking on close matters as much as docking:
    otherwise the frame stays parked over the middle of the page after the full
    player is dismissed.
  */
  const setVideoDocked = s.setVideoDocked
  useEffect(() => {
    setVideoDocked(open && mode === 'video' && videoActive)
    return () => setVideoDocked(false)
  }, [open, mode, videoActive, setVideoDocked])

  if (!open || !current) return null

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
          style={{ width: 'var(--seek-pct, 0%)' }}
        />
        <SeekRange />
      </div>
      <div className="flex items-center justify-between text-xs font-medium tabular-nums text-white/80">
        <PositionLabel />
        <DurationLabel />
      </div>
    </div>
  )

  const Transport = ({ size = 'md' }: { size?: 'sm' | 'md' }) => (
    <div className={clsx('relative flex w-full items-center justify-center', size === 'md' ? 'gap-6 px-4 pt-1' : 'gap-4')}>
      <TransportLock className="absolute top-0 right-2" />
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
        className={clsx('rounded-full p-2.5 text-white transition hover:bg-white/10', transportLocked && 'opacity-45')}
        title={transportLocked ? 'The host controls playback' : 'Previous'} aria-label="Previous track"
      >
        <SkipBack size={size === 'md' ? 26 : 22} fill="currentColor" />
      </button>
      <button
        onClick={s.toggle}
        className={clsx('flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-ink-950 shadow-2xl transition hover:scale-105 active:scale-95 glow-accent', transportLocked && 'opacity-45')}
        title={transportLocked ? 'The host controls playback' : s.playing ? 'Pause' : 'Play'} aria-label={s.playing ? 'Pause' : 'Play'}
      >
        {s.playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
      </button>
      <button
        onClick={() => void s.next()}
        className={clsx('rounded-full p-2.5 text-white transition hover:bg-white/10', transportLocked && 'opacity-45')}
        title={transportLocked ? 'The host controls playback' : 'Next'} aria-label="Next track"
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
        onClick={() => setMode('video')}
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

  /*
    Queue, Cast, Download and Info used to be a permanent bar pinned across the
    bottom of the player on phones. Four always-visible controls is a lot of
    vertical space to spend on actions taken once a session, and on a short
    screen it was the artwork and the lyrics that gave up the room. They live
    behind one ⋯ button in the top-right corner now.
  */
  const MenuItem = ({
    icon: Icon, label, onClick, active = false, trailing, spinning = false, keepOpen = false,
  }: {
    icon: typeof ListMusic
    label: string
    onClick: () => void
    active?: boolean
    trailing?: ReactNode
    spinning?: boolean
    /** For rows that open something inside the menu rather than acting. */
    keepOpen?: boolean
  }) => (
    <button
      role="menuitem"
      onClick={() => {
        if (!keepOpen) setMenuOpen(false)
        onClick()
      }}
      className={clsx(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/10',
        active ? 'text-accent' : 'text-white/85 hover:text-white',
      )}
    >
      <Icon size={17} className={clsx('shrink-0', spinning && 'animate-spin')} />
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </button>
  )

  /*
    How long is left, in whole minutes, rounded up — "1 min" has to keep saying
    something until the music actually stops, and a rounded-down "0 min" reads
    as a timer that already fired.
  */
  const sleepLabel = (): string | null => {
    const t = s.sleepTimer
    if (!t) return null
    if (t.mode === 'track') return 'End of song'
    const left = Math.max(0, Math.ceil(((t.endsAt ?? 0) - Date.now()) / 60_000))
    return `${left} min left`
  }

  const SLEEP_OPTIONS: Array<{ label: string; value: number | 'track' }> = [
    { label: 'End of this song', value: 'track' },
    { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 },
    { label: '45 minutes', value: 45 },
    { label: '1 hour', value: 60 },
  ]

  const SleepMenu = () => {
    const active = s.sleepTimer
    return (
      <>
        {MenuItem({
          icon: Moon,
          label: 'Sleep timer',
          active: !!active,
          // Stays open: picking a duration is the next step, and closing the
          // menu to reopen it one row lower is a pointless round trip.
          onClick: () => setSleepOpen((v) => !v),
          keepOpen: true,
          trailing: active ? (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent">
              {sleepLabel()}
            </span>
          ) : (
            <ChevronRight
              size={15}
              className={clsx('text-white/40 transition-transform', sleepOpen && 'rotate-90')}
            />
          ),
        })}

        {sleepOpen && (
          <div className="mb-1 ml-3 space-y-0.5 border-l border-white/10 pl-2">
            {SLEEP_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                role="menuitem"
                onClick={() => {
                  s.setSleepTimer(opt.value)
                  setSleepOpen(false)
                  setMenuOpen(false)
                }}
                className={clsx(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition hover:bg-white/10',
                  (opt.value === 'track' ? active?.mode === 'track' : false)
                    ? 'text-accent'
                    : 'text-white/80 hover:text-white',
                )}
              >
                {opt.label}
                {opt.value === 'track' && active?.mode === 'track' && <Check size={14} />}
              </button>
            ))}
            {active && (
              <button
                role="menuitem"
                onClick={() => {
                  s.setSleepTimer(null)
                  setSleepOpen(false)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                Turn off timer
              </button>
            )}
          </div>
        )}
      </>
    )
  }

  const MoreMenu = ({ className = '' }: { className?: string }) => (
    <div ref={moreMenuRef} className={clsx('relative', className)}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="More actions"
        aria-label="More actions"
        className={clsx(
          'rounded-full p-2.5 transition',
          menuOpen ? 'bg-white/25 text-white' : 'bg-white/10 text-white/90 hover:bg-white/20',
        )}
      >
        <MoreVertical size={18} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Track actions"
          className="absolute top-full right-0 z-50 mt-2 w-60 rounded-2xl border border-white/15 bg-black/60 p-1.5 shadow-2xl backdrop-blur-2xl"
        >
          {MenuItem({
            icon: ListMusic,
            label: 'Queue',
            active: activeTab === 'queue' && showRightPanel,
            onClick: () => togglePanel('queue'),
            trailing: (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-white/70">
                {s.queue.length}
              </span>
            ),
          })}
          {MenuItem({
            icon: Sparkles,
            label: 'Lyrics',
            active: activeTab === 'lyrics' && showRightPanel,
            onClick: () => togglePanel('lyrics'),
          })}
          {MenuItem({
            icon: Info,
            label: 'Track info',
            active: activeTab === 'info' && showRightPanel,
            onClick: () => togglePanel('info'),
          })}

          <div className="mx-2 my-1 h-px bg-white/10" aria-hidden />

          {SleepMenu()}

          <div className="mx-2 my-1 h-px bg-white/10" aria-hidden />

          <CastButton variant="menu" />
          {downloadSupported &&
            MenuItem({
              icon:
                downloadStatus === 'downloading' ? Loader2 : downloadStatus === 'done' ? Trash2 : Download,
              spinning: downloadStatus === 'downloading',
              label:
                downloadStatus === 'downloading'
                  ? 'Downloading…'
                  : downloadStatus === 'done'
                    ? 'Remove download'
                    : 'Keep offline in app',
              active: downloadStatus === 'done',
              onClick: () => (downloadStatus === 'done' ? void removeDownload() : void download()),
            })}
          {/*
            Two different saves, named for where the file ends up. The offline
            one is invisible outside the app, which is exactly what people hit
            it expecting *not* to be the case.
          */}
          {downloadSupported &&
            MenuItem({
              icon: saveStatus === 'saving' ? Loader2 : HardDriveDownload,
              spinning: saveStatus === 'saving',
              label:
                saveStatus === 'saving'
                  ? 'Saving file…'
                  : saveStatus === 'saved'
                    ? 'Saved to your device'
                    : saveStatus === 'shared'
                      ? 'Sent to your device'
                      : saveStatus === 'error'
                        ? 'Could not save — try again'
                        : 'Save to device',
              active: saveStatus === 'saved' || saveStatus === 'shared',
              // Stays open so the outcome is visible: the whole complaint about
              // the other download is that nothing said where the file went.
              keepOpen: true,
              onClick: () => void saveToDevice(),
            })}
          {MenuItem({
            icon: shareState === 'copied' ? Check : Share2,
            label: shareState === 'copied' ? 'Link copied' : 'Share',
            active: shareState === 'copied',
            onClick: () => void handleShare(),
          })}
        </div>
      )}
    </div>
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
        className="animate-player-in fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: 'linear-gradient(135deg, #2e050e 0%, #4a0e17 40%, #881337 75%, #9f1239 100%)' }}
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4 backdrop-blur-sm" style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20"><ChevronDown size={22} /></button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-rose-200 uppercase"><Flower2 size={15} className="text-rose-400" /> Cherry Blossom</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} title="Lyrics" className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"><FileText size={18} /></button>
            {MoreMenu({})}
          </div>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-around overflow-y-auto px-6 pt-2 pb-safe">
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
        className="animate-player-in fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: 'linear-gradient(135deg, #3b1207 0%, #7c2d12 40%, #c2410c 70%, #f97316 100%)' }}
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4 backdrop-blur-sm" style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20"><ChevronDown size={22} /></button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-amber-200 uppercase"><Sun size={15} className="text-amber-400" /> Sunset Shades</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} title="Lyrics" className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"><FileText size={18} /></button>
            {MoreMenu({})}
          </div>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-around overflow-y-auto px-6 pt-2 pb-safe">
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
        className="animate-player-in fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: 'linear-gradient(135deg, #022c22 0%, #064e3b 40%, #0f766e 70%, #06b6d4 100%)' }}
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4 backdrop-blur-sm" style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20"><ChevronDown size={22} /></button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-cyan-200 uppercase"><Sparkles size={15} className="text-cyan-400" /> Arc Studio</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} title="Lyrics" className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"><FileText size={18} /></button>
            {MoreMenu({})}
          </div>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-around overflow-y-auto px-6 pt-2 pb-safe">
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
        className="animate-player-in fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: 'linear-gradient(135deg, #090d16 0%, #1e1b4b 45%, #4338ca 75%, #6366f1 100%)' }}
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4 backdrop-blur-sm" style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20"><ChevronDown size={22} /></button>
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-indigo-200 uppercase"><Sparkles size={15} className="text-indigo-400" /> Cosmic Aurora</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} title="Lyrics" className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"><FileText size={18} /></button>
            {MoreMenu({})}
          </div>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-around overflow-y-auto px-6 pt-2 pb-safe">
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
        className="animate-player-in fixed inset-0 z-50 flex flex-col overflow-hidden bg-gray-950 text-white outline-none"
      >
        <header className="relative z-20 flex items-center justify-between px-5 py-4" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 1rem)' }}>
          <button onClick={closeFullPlayer} className="rounded-full p-2 text-gray-400 hover:text-white"><ChevronDown size={24} /></button>
          <span className="text-[11px] font-semibold tracking-[0.2em] text-gray-500 uppercase">Minimal</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => togglePanel('lyrics')} aria-pressed={activeTab === 'lyrics' && showRightPanel} title="Lyrics" className="rounded-full p-2 text-gray-400 hover:text-white">
              <FileText size={20} />
            </button>
            {MoreMenu({})}
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-start gap-6 overflow-y-auto px-4 pt-4 sm:px-6 pb-safe">
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
                  <div aria-hidden className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: 'var(--seek-pct, 0%)' }} />
                  <SeekRange />
                </div>
                <div className="flex items-center justify-between text-[11px] tabular-nums text-gray-500">
                  <PositionLabel />
                  <DurationLabel />
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
            RightPanel({ className: 'w-full max-w-4xl h-[clamp(260px,46dvh,400px)] lg:h-[clamp(340px,66dvh,500px)] border-gray-800 bg-gray-900/60' })
          )}
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME: MIDNIGHT EMBER / EMERALD GOLD — "Gradient Hero" (centred, framed art)
  // ════════════════════════════════════════════════════════════════════════
  const heroCfg = {
    'midnight-ember': {
      bg: 'linear-gradient(160deg, #0f0f1e 0%, #16213e 55%, #1a1a2e 100%)',
      label: 'Midnight Ember',
      glow: 'bg-[#e94560]/30',
      ring: 'ring-[#e94560]/45',
      kicker: 'text-rose-200',
      chip: 'border-[#e94560]/40 bg-[#e94560]/15 text-rose-100 hover:bg-[#e94560]/25',
      panel: 'border-[#e94560]/20 bg-[#1a1a2e]/70',
    },
    'emerald-gold': {
      bg: 'linear-gradient(160deg, #071a12 0%, #0f2d22 55%, #14432f 100%)',
      label: 'Emerald Gold',
      glow: 'bg-[#f5c542]/25',
      ring: 'ring-[#f5c542]/45',
      kicker: 'text-amber-200',
      chip: 'border-[#f5c542]/40 bg-[#f5c542]/15 text-amber-100 hover:bg-[#f5c542]/25',
      panel: 'border-[#f5c542]/20 bg-[#0f2d22]/70',
    },
    vibrant: {
      bg: 'linear-gradient(160deg, #1a0433 0%, #3b0764 50%, #6d28d9 100%)',
      label: 'Vibrant',
      glow: 'bg-fuchsia-500/30',
      ring: 'ring-fuchsia-400/50',
      kicker: 'text-fuchsia-200',
      chip: 'border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25',
      panel: 'border-fuchsia-500/20 bg-[#2b0b52]/70',
    },
  } as const

  if (playerTheme in heroCfg) {
    const cfg = heroCfg[playerTheme as keyof typeof heroCfg]
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Now playing: ${current.title}`}
        tabIndex={-1}
        className="player-surface animate-player-in fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: cfg.bg }}
      >
        {/* soft artwork bloom */}
        {current.artwork && (
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30">
            <img src={current.artwork} alt="" className="h-full w-full scale-125 object-cover blur-3xl" />
          </div>
        )}

        <header
          className="relative z-20 flex items-center justify-between px-5 py-4"
          style={{ paddingTop: 'max(env(safe-area-inset-top,0px), 1rem)' }}
        >
          <button onClick={closeFullPlayer} className="rounded-full bg-white/10 p-2.5 text-white/90 transition hover:bg-white/20">
            <ChevronDown size={22} />
          </button>
          <span className={clsx('text-xs font-bold tracking-[0.2em] uppercase', cfg.kicker)}>{cfg.label}</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => togglePanel('lyrics')}
              aria-pressed={activeTab === 'lyrics' && showRightPanel}
              title="Lyrics"
              className="rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"
            >
              <FileText size={18} />
            </button>
            {MoreMenu({})}
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-around gap-5 overflow-y-auto px-4 pt-2 sm:px-6 pb-safe">
          {/* Framed square artwork with a coloured bloom */}
          <div className={clsx('relative aspect-square transition-all duration-300', showRightPanel ? 'w-52 sm:w-60' : 'w-64 sm:w-80')}>
            <div className={clsx('absolute -inset-6 rounded-[2rem] blur-3xl', cfg.glow)} />
            <div className={clsx('relative h-full w-full overflow-hidden rounded-3xl shadow-2xl ring-4 glow-accent', cfg.ring)}>
              <Artwork src={current.artwork} alt="" className="h-full w-full" rounded="rounded-3xl" />
            </div>
          </div>

          <div className="space-y-1 text-center">
            <p className={clsx('text-xs font-semibold tracking-widest uppercase', cfg.kicker)}>{current.artist}</p>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl [text-wrap:balance] line-clamp-2">
              {current.title}
            </h1>
          </div>

          {ScrubBar({ className: showRightPanel ? '' : 'max-w-md' })}
          {Transport({})}

          <div className="flex items-center gap-3">
            {FavButton()}
            <button
              onClick={() => void handleShare()}
              className={clsx('flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition', cfg.chip)}
            >
              {shareState === 'copied' ? <Check size={14} /> : <Share2 size={14} />} {shareState === 'copied' ? 'Copied' : 'Share'}
            </button>
          </div>

          {!showRightPanel && (
            <button
              onClick={() => setShowRightPanel(true)}
              className={clsx('flex items-center gap-2 rounded-full border px-5 py-2 text-xs font-semibold backdrop-blur-md transition hover:scale-105 active:scale-95', cfg.chip)}
            >
              <Sparkles size={14} /> Show Lyrics & Queue
            </button>
          )}

          {showRightPanel && RightPanel({ className: clsx('w-full max-w-md h-64', cfg.panel) })}
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME: GLASS PRO — every surface is a pane of liquid glass
  // ════════════════════════════════════════════════════════════════════════
  if (playerTheme === 'glasspro') {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Now playing: ${current.title}`}
        tabIndex={-1}
        className="player-surface animate-player-in fixed inset-0 z-50 flex flex-col overflow-hidden text-white outline-none"
        style={{ background: '#05070f' }}
      >
        {/* Backdrop, in two layers: the track's own colour bloom, then the same
            drifting aurora the rest of the app sits on, so the panes here
            refract the identical material they do behind the overlay. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-[background] duration-700"
          style={{ background: bgGradient }}
        >
          {current.artwork && (
            <img src={current.artwork} alt="" className="h-full w-full scale-125 object-cover opacity-30 blur-3xl" />
          )}
        </div>
        <div aria-hidden className="lg-aurora lg-aurora--overlay" />

        <header
          data-shell="topbar"
          className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-3 sm:px-6"
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 0.75rem)' }}
        >
          <button
            onClick={closeFullPlayer}
            className="rounded-full bg-white/10 p-2 text-white/85 transition hover:bg-white/20 hover:text-white"
            title="Minimize player"
            aria-label="Minimize player"
          >
            <ChevronDown size={22} />
          </button>
          {ModeBar()}
          <div className="flex items-center gap-1">
            <button
              onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {}); else void document.exitFullscreen().catch(() => {}) }}
              className="hidden rounded-full p-2 text-white/75 transition hover:bg-white/10 hover:text-white lg:block"
              title="Toggle browser fullscreen"
            >
              <Maximize2 size={19} />
            </button>
            {MoreMenu({})}
          </div>
        </header>

        {/*
          min-h-0 is what lets this scroll: a flex child defaults to
          min-height:auto, which refuses to shrink below its content, so on a
          landscape phone the controls used to push out past the viewport
          instead of the column scrolling.
        */}
        <div className="relative z-10 mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 items-start gap-5 overflow-y-auto p-3 sm:p-6 lg:grid-cols-12 lg:items-center lg:gap-8 lg:p-8 pb-safe">
          <div
            className={clsx(
              'mx-auto flex w-full flex-col items-center gap-4 text-center transition-all duration-300',
              showRightPanel ? 'max-w-md lg:col-span-5' : 'max-w-xl lg:col-span-12',
            )}
          >
            <div className="hidden w-full max-w-sm items-center justify-center gap-4 rounded-full bg-white/10 px-4 py-2 lg:flex">
              <button
                onClick={() => setShowRightPanel((v) => !v)}
                aria-pressed={showRightPanel}
                title="Lyrics & queue"
                className={clsx('flex h-10 w-10 items-center justify-center rounded-full transition hover:scale-105 active:scale-95', showRightPanel ? 'bg-white text-ink-950 shadow-lg' : 'bg-white/15 text-white hover:bg-white/25')}
              >
                <FileText size={18} />
              </button>
              <CastButton />
              <button onClick={() => void handleShare()} className="rounded-full p-2 text-white/75 transition hover:bg-white/15 hover:text-white" title="Share track">
                {shareState === 'copied' ? <Check size={18} className="text-accent" /> : <Share2 size={18} />}
              </button>
              {downloadSupported && (
                <button
                  onClick={() => (downloadStatus === 'done' ? void removeDownload() : void download())}
                  title={downloadStatus === 'done' ? 'Remove download' : 'Download for offline'}
                  className={clsx('rounded-full p-2 transition hover:bg-white/15', downloadStatus === 'done' ? 'text-accent' : 'text-white/75 hover:text-white')}
                >
                  {downloadStatus === 'downloading' ? <Loader2 size={18} className="animate-spin text-accent" /> : <Download size={18} />}
                </button>
              )}
            </div>
            {ShareResult()}

            {/* Artwork mounted behind glass: a bevelled frame, and a specular
                streak raking across the art itself. */}
            <div
              className={clsx(
                'lg-glass relative aspect-square w-full rounded-[2rem] p-3 transition-all duration-300',
                showRightPanel ? 'max-w-[264px] sm:max-w-[300px]' : 'max-w-[320px] sm:max-w-[400px]',
              )}
            >
              <div className="relative h-full w-full overflow-hidden rounded-[1.35rem] shadow-2xl">
                <Artwork src={current.artwork} alt="" className="h-full w-full" rounded="rounded-[1.35rem]" />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(147deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.08) 22%, rgba(255,255,255,0) 44%)',
                    mixBlendMode: 'overlay',
                  }}
                />
              </div>
            </div>

            <div className="w-full space-y-1 px-2">
              <p className="truncate text-[11px] font-semibold tracking-[0.22em] text-sky-200/80 uppercase">{current.artist}</p>
              <h1 className="font-display line-clamp-2 text-xl font-extrabold tracking-tight text-white [text-wrap:balance] sm:text-3xl">
                {current.title}
              </h1>
            </div>

            {/* Scrubber and transport share one glass console. */}
            <div className="lg-glass w-full rounded-[1.75rem] px-2 py-4 sm:px-4">
              {ScrubBar({})}
              {Transport({})}
            </div>

            <div className="flex w-full items-center justify-center">{FavButton()}</div>

            {!showRightPanel && (
              <button
                onClick={() => setShowRightPanel(true)}
                className="lg-glass flex items-center gap-2 rounded-full px-5 py-2 text-xs font-semibold text-white transition hover:scale-105 active:scale-95"
              >
                <Sparkles size={14} className="text-accent" /> Show Lyrics &amp; Queue
              </button>
            )}
          </div>

          {RightPanel({ className: 'h-[clamp(260px,46dvh,440px)] lg:col-span-7 lg:h-[clamp(360px,72dvh,600px)]' })}
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // THEME: CLASSIC / NEUMORPHIC
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${current.title}`}
      tabIndex={-1}
      // player-surface: this is a dark immersive overlay on EVERY theme, so the
      // light-scheme (neumorphic) overrides that darken .text-white etc. must be
      // undone inside it — otherwise the title/controls go dark-on-dark. (see index.css)
      className="player-surface animate-player-in fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0b0914] text-white outline-none"
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
          <button onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {}); else void document.exitFullscreen().catch(() => {}) }} title="Toggle browser fullscreen" className="hidden rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white lg:block">
            <Maximize2 size={20} />
          </button>
          {MoreMenu({})}
        </div>
      </header>

      <div className="relative z-10 mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 items-start gap-6 overflow-y-auto p-4 sm:p-8 lg:grid-cols-12 lg:items-center lg:gap-10 pb-safe">
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
        {RightPanel({ className: 'h-[clamp(260px,46dvh,420px)] lg:col-span-7 lg:h-[clamp(360px,72dvh,580px)]' })}
      </div>
    </div>
  )
}
