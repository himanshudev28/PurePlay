import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Make the phone's Back gesture close a full-screen overlay.
 *
 * The full player is not a route — it is state on the player store — so a
 * swipe-back or a Back press did nothing at all while it was up: the browser
 * had no entry to pop, so the gesture either left the player sitting there or
 * (worse) walked out of the page underneath it. On Android and on iOS Safari's
 * edge swipe that reads as a frozen screen, because the one gesture everybody
 * uses to leave a screen is the one that does nothing.
 *
 * So while the overlay is up, it owns a history entry of its own:
 *
 *   open        push an entry with the same URL, tagged in router state
 *   Back        that entry pops, the tag disappears, and we close the overlay
 *   close (X)   we pop the entry ourselves, so Back doesn't need two presses
 *
 * The URL never changes — this is a modal, not a page, and it should not be
 * linkable or survive a reload. `pushed` tracks whether *this* session added
 * the entry, so a reload with a stale tagged entry can't send anyone backwards.
 */
export function useOverlayHistory(open: boolean, close: () => void, id = 'overlay') {
  const navigate = useNavigate()
  const location = useLocation()
  const pushed = useRef(false)
  /*
    True once the pushed entry has actually been *observed* in the location.

    Without it the overlay closed itself the instant it opened: the push effect
    sets `pushed` and calls navigate, then the watch effect runs in the same
    commit — before the router has re-rendered — sees an untagged location, and
    reads that as a Back press. Only a tag that appeared and then went away is a
    Back press.
  */
  const armed = useRef(false)

  // Keep the closer current without re-running the effects that use it.
  const closeRef = useRef(close)
  closeRef.current = close

  const here = location.pathname + location.search + location.hash
  const tagged = (location.state as { overlay?: string } | null)?.overlay === id

  useEffect(() => {
    if (open && !pushed.current) {
      pushed.current = true
      navigate(here, { state: { ...(location.state as object | null), overlay: id } })
    }
    // `here` deliberately absent: navigating elsewhere while the overlay is up
    // must not push a second entry, and the effect below already closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Back was pressed — our entry is gone, so the overlay goes with it.
  useEffect(() => {
    if (!open || !pushed.current) return
    if (tagged) {
      armed.current = true
      return
    }
    if (armed.current) {
      pushed.current = false
      armed.current = false
      closeRef.current()
    }
  }, [open, tagged])

  // Closed from inside (the chevron, Escape). Drop the entry we added, or the
  // next Back press would only undo a modal that is already gone.
  useEffect(() => {
    if (!open && pushed.current) {
      pushed.current = false
      armed.current = false
      navigate(-1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
