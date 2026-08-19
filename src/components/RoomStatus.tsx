import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Crown, Lock, Radio, WifiOff, X } from 'lucide-react'
import clsx from 'clsx'
import { useRoom } from '@/store/room'
import { usePlayer } from '@/store/player'

/** Toasts clear themselves; the store only records what happened and when. */
const TOAST_MS = 3600

/**
 * Room feedback that has to be visible from anywhere in the app.
 *
 * The room deliberately survives navigation, so everything it does — someone
 * joining, the host locking the controls, a blocked play press — can happen on
 * a page with no room UI on it at all. Without this, a listener pressing Play
 * on the search page got silence and no explanation.
 */
export function RoomStatus() {
  const roomId = useRoom((s) => s.roomId)
  const isHost = useRoom((s) => s.isHost)
  const canControl = useRoom((s) => s.canControl)
  const hostAway = useRoom((s) => s.hostAway)
  const toast = useRoom((s) => s.toast)
  const clearToast = useRoom((s) => s.clearToast)
  const hasTrack = usePlayer((s) => s.current !== null)
  const viewMode = usePlayer((s) => s.playerViewMode)
  const { pathname } = useLocation()

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clearToast, TOAST_MS)
    return () => clearTimeout(t)
  }, [toast, clearToast])

  // sit above the player bar when there is one
  const bottom = hasTrack && viewMode === 'bar' ? 'bottom-[150px] sm:bottom-[112px]' : 'bottom-[88px] sm:bottom-6'
  const onRoomPage = pathname.startsWith('/room')

  return (
    <>
      {roomId && !onRoomPage && (
        <Link
          to={`/room?id=${roomId}`}
          title={isHost ? 'You are hosting this room' : 'You are listening in a room'}
          className="fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:border-accent lg:top-4 lg:right-4"
        >
          {hostAway ? (
            <WifiOff size={12} className="text-amber-300" />
          ) : isHost ? (
            <Crown size={12} className="text-accent" />
          ) : (
            <Radio size={12} className="text-accent" />
          )}
          <span className="font-mono tracking-[0.15em]">{roomId}</span>
          {!canControl && <Lock size={11} className="text-ink-400" />}
        </Link>
      )}

      {toast && (
        <div
          role="status"
          className={clsx(
            'fixed left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-full border border-ink-700 bg-ink-900/95 px-4 py-2 text-xs text-white shadow-xl backdrop-blur',
            bottom,
          )}
        >
          <span className="truncate">{toast.text}</span>
          <button onClick={clearToast} aria-label="Dismiss" className="shrink-0 text-ink-400 hover:text-white">
            <X size={12} />
          </button>
        </div>
      )}
    </>
  )
}
