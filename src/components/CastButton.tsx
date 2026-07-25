import { useEffect, useRef, useState } from 'react'
import { Cast, Loader2 } from 'lucide-react'
import clsx from 'clsx'

/**
 * Minimal shape of the Remote Playback API. Declared locally rather than
 * leaning on lib.dom, which types `remote` inconsistently across TS versions.
 */
interface RemotePlaybackLike {
  state: 'connecting' | 'connected' | 'disconnected'
  prompt: () => Promise<void>
  watchAvailability: (cb: (available: boolean) => void) => Promise<number>
  cancelWatchAvailability: (id?: number) => Promise<void>
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: (type: string, cb: () => void) => void
}

interface AirPlayElement extends HTMLAudioElement {
  webkitShowPlaybackTargetPicker: () => void
}

const getAudio = () => document.querySelector('audio')
const getRemote = (el: HTMLAudioElement | null): RemotePlaybackLike | null =>
  el && 'remote' in el ? (el as HTMLAudioElement & { remote: RemotePlaybackLike }).remote : null
const hasAirPlay = (el: HTMLAudioElement | null): el is AirPlayElement =>
  !!el && 'webkitShowPlaybackTargetPicker' in el

type Status = 'idle' | 'connecting' | 'connected' | 'none-found'

/**
 * Opens the browser's own device picker (Chrome/Edge Remote Playback, Safari
 * AirPlay). Both are hard requirements — neither can be polyfilled, and no API
 * lets a page enumerate cast targets itself.
 *
 * The previous version claimed to be "scanning for nearby devices" via a
 * blocking `alert()` when no API was present. It never scanned anything, and
 * it showed a success check mark on every path — including the ones where the
 * call threw or the user cancelled the picker.
 */
export function CastButton({
  variant = 'icon',
  className,
}: {
  variant?: 'icon' | 'labeled'
  className?: string
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [available, setAvailable] = useState<boolean | null>(null)
  const watchId = useRef<number | null>(null)

  // Reflect the real connection state instead of inferring it from the click.
  useEffect(() => {
    const el = getAudio()
    const remote = getRemote(el)
    if (!remote) {
      setAvailable(hasAirPlay(el))
      return
    }

    const sync = () =>
      setStatus(
        remote.state === 'connected'
          ? 'connected'
          : remote.state === 'connecting'
            ? 'connecting'
            : 'idle',
      )

    sync()
    remote.addEventListener('connect', sync)
    remote.addEventListener('connecting', sync)
    remote.addEventListener('disconnect', sync)

    void remote
      .watchAvailability((isAvailable) => setAvailable(isAvailable))
      .then((id) => {
        watchId.current = id
      })
      .catch(() => setAvailable(true)) // availability monitoring is optional

    return () => {
      remote.removeEventListener('connect', sync)
      remote.removeEventListener('connecting', sync)
      remote.removeEventListener('disconnect', sync)
      if (watchId.current !== null) {
        void remote.cancelWatchAvailability(watchId.current).catch(() => {})
      }
    }
  }, [])

  const flashNoneFound = () => {
    setStatus('none-found')
    setTimeout(() => setStatus('idle'), 4000)
  }

  const handleCast = async () => {
    const el = getAudio()

    // Safari's AirPlay picker first — it's a synchronous call that always opens.
    if (hasAirPlay(el)) {
      try {
        el.webkitShowPlaybackTargetPicker()
        return
      } catch {
        /* fall through */
      }
    }

    const remote = getRemote(el)
    if (remote) {
      // We already know there are no reachable devices — prompt() would just
      // reject with NotFoundError and the click would look dead. Say so instead.
      if (available === false) {
        flashNoneFound()
        return
      }
      try {
        setStatus('connecting')
        // resolves once the user picks a device, rejects when they cancel
        await remote.prompt()
      } catch {
        // cancelled, or no device chosen — we already returned above when we
        // knew there were none, so just settle back to idle
        setStatus('idle')
      }
      return
    }

    // No picker API exists in this browser at all.
    flashNoneFound()
  }

  const el = getAudio()
  // Distinguish "browser can't cast" from "browser can, but found nothing".
  const hasPicker = !!getRemote(el) || hasAirPlay(el)
  const unsupported = available === false
  const noticeText = hasPicker
    ? 'No Cast or AirPlay devices found on your network.'
    : 'This browser has no casting picker. Try Chrome, Edge, or Safari.'
  const label =
    status === 'connected'
      ? 'Connected — change playback device'
      : status === 'connecting'
        ? 'Choosing a device…'
        : unsupported
          ? 'No cast devices found on this network'
          : 'Cast to TV or wireless speakers'

  const Icon = status === 'connecting' ? Loader2 : Cast
  const spin = status === 'connecting' ? 'animate-spin' : undefined

  return (
    <div className="relative">
      <button
        onClick={() => void handleCast()}
        disabled={status === 'connecting'}
        title={label}
        aria-label={label}
        aria-pressed={status === 'connected'}
        className={clsx(
          'transition disabled:opacity-60',
          variant === 'labeled'
            ? 'flex items-center gap-2 text-xs font-semibold'
            : 'rounded-full p-2',
          status === 'connected'
            ? variant === 'labeled'
              ? 'text-accent'
              : 'bg-accent/20 text-accent'
            : 'text-white/70 hover:text-white' + (variant === 'icon' ? ' hover:bg-white/10' : ''),
          className,
        )}
      >
        <Icon size={variant === 'labeled' ? 17 : 19} className={spin} />
        {variant === 'labeled' && 'Cast'}
      </button>

      {/* Shown and announced when a cast attempt finds nothing to connect to. */}
      {status === 'none-found' && (
        <span
          role="status"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-center text-xs text-ink-200 shadow-xl"
        >
          {noticeText}
        </span>
      )}
    </div>
  )
}
