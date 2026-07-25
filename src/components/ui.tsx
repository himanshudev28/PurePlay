import clsx from 'clsx'
import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Music, Loader2 } from 'lucide-react'
import { usePlayer } from '@/store/player'
import { formatDuration } from '@/lib/format'

/**
 * The seek input used by every player surface.
 *
 * Two problems with a bare `value={position} onChange={seek}` range input:
 * the thumb snaps back mid-drag whenever a timeupdate lands (YouTube's poll
 * makes this constant), and a single drag fires dozens of engine seeks. This
 * holds a local value while the pointer is down and commits ONE seek on
 * release; keyboard arrows still commit immediately.
 */
export function SeekRange({ className }: { className?: string }) {
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const seek = usePlayer((s) => s.seek)
  const [drag, setDrag] = useState<number | null>(null)
  const dragging = useRef(false)

  const commit = () => {
    dragging.current = false
    setDrag((v) => {
      if (v !== null) seek(v)
      return null
    })
  }

  const value = drag ?? position
  return (
    <input
      type="range"
      min={0}
      max={duration || 0}
      step={0.1}
      value={value}
      onPointerDown={() => {
        dragging.current = true
      }}
      onPointerUp={commit}
      onPointerCancel={commit}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (dragging.current) setDrag(v)
        else seek(v)
      }}
      aria-label="Seek"
      aria-valuetext={`${formatDuration(value)} of ${formatDuration(duration)}`}
      className={clsx(
        'seek-bar absolute inset-0 h-full w-full cursor-pointer opacity-0 group-hover:opacity-100',
        className,
      )}
    />
  )
}

/**
 * Marks the row/card that is currently playing.
 *
 * This replaces the accent left-border that used to flag the active track: a
 * coloured stripe is decoration a user has to learn, three bars moving in time
 * with the audio say "playing" on sight. Static (but still visible) under
 * `prefers-reduced-motion`, and hidden from screen readers because the row
 * already announces its state in text.
 */
export function NowPlayingBars({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx('flex h-3.5 w-3 items-end gap-[2px]', className)}>
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent" />
    </span>
  )
}

export function Artwork({
  src,
  alt,
  className,
  rounded = 'rounded-xl',
}: {
  src?: string
  alt: string
  className?: string
  rounded?: string
}) {
  const [broken, setBroken] = useState(false)

  // a recycled card can get a new src — clear the previous failure
  useEffect(() => setBroken(false), [src])

  return (
    <div className={clsx('relative shrink-0 overflow-hidden bg-ink-800', rounded, className)}>
      {src && !broken ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-400">
          <Music size={20} aria-hidden />
        </div>
      )}
    </div>
  )
}

/**
 * Loads more of the radio tail when it scrolls into view at the end of a queue
 * list. This is a convenience for someone browsing "Up next" — playback
 * continuity does NOT depend on it. The store prefetches from the playhead, so
 * the queue stays full whether or not anyone ever opens this panel.
 *
 * `rootMargin` fires it slightly before the sentinel is actually visible, so
 * the new rows are usually in place by the time the user reaches the bottom.
 */
export function QueueTailLoader({ scrollRoot }: { scrollRoot?: React.RefObject<HTMLElement | null> }) {
  const extendQueue = usePlayer((s) => s.extendQueue)
  const extending = usePlayer((s) => s.queueExtending)
  const exhausted = usePlayer((s) => s.queueExhausted)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || exhausted) return
    const observer = new IntersectionObserver(
      (entries) => {
        // extendQueue is a no-op while a fetch is already in flight, so a fast
        // scroll can't stack up duplicate requests
        if (entries[0]?.isIntersecting) void extendQueue()
      },
      { root: scrollRoot?.current ?? null, rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [extendQueue, exhausted, scrollRoot])

  if (exhausted) {
    return (
      <p className="py-4 text-center text-[11px] text-ink-400">
        That’s everything we could find for this mix.
      </p>
    )
  }

  return (
    <div ref={ref} className="flex items-center justify-center gap-2 py-4 text-[11px] text-ink-400">
      {extending ? (
        <>
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Finding more songs…
        </>
      ) : (
        // a real control, so keyboard users and a failed observer both have a
        // way to pull the next batch
        <button onClick={() => void extendQueue()} className="rounded-full px-3 py-1 hover:text-white">
          Load more
        </button>
      )}
    </div>
  )
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-white">{title}</h2>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('rounded-lg skeleton-shimmer', className)} />
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-ink-800 bg-ink-900/50 px-6 py-16 text-center">
      {icon && <div className="text-ink-400">{icon}</div>}
      <p className="font-medium text-ink-200">{title}</p>
      {hint && <p className="max-w-[60ch] text-sm text-ink-400">{hint}</p>}
      {action}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'solid',
  size = 'md',
  className,
  disabled,
  loading = false,
  type = 'button',
  title,
  ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'solid' | 'ghost' | 'outline' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  disabled?: boolean
  /** shows a spinner and blocks input without collapsing the button's width */
  loading?: boolean
  type?: 'button' | 'submit'
  title?: string
  ariaLabel?: string
}) {
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'relative inline-flex items-center justify-center gap-2 rounded-full font-medium',
        'transition-[background-color,color,border-color,transform] duration-200',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'active:scale-95',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variant === 'solid' && 'bg-white text-ink-950 hover:bg-ink-200',
        /*
          text-ink-950, not text-white. Every accent in the theme set is a
          mid-to-light hue, so white on the filled accent measures 2.15:1
          (amber) to 4.24:1 (purple) — all below the 4.5:1 AA floor. Near-black
          ink measures 4.75:1 to 9.4:1 across the same six themes, and it stays
          correct on the lighter `accent-soft` hover fill too.
        */
        variant === 'accent' && 'bg-accent text-ink-950 hover:bg-accent-soft glow-accent',
        variant === 'outline' && 'border border-ink-700 text-ink-200 hover:border-ink-600 hover:text-white',
        variant === 'ghost' && 'text-ink-300 hover:bg-ink-800 hover:text-white',
        className,
      )}
    >
      {/* keep the label mounted so the button doesn't resize mid-action */}
      <span className={clsx('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
      {loading && <Loader2 size={16} className="absolute animate-spin" />}
    </button>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-xl border border-accent-dim bg-accent-dim/30 px-4 py-3 text-sm"
    >
      <span className="text-accent-soft">{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
