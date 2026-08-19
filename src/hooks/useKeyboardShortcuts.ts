import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayer } from '@/store/player'

/**
 * The keyboard map, in the order the help sheet lists it.
 *
 * Exported so the sheet and the handler can never drift: every row a listener
 * can read about is a row this file actually implements.
 */
export const SHORTCUTS: Array<{ group: string; keys: string[]; label: string }> = [
  { group: 'Playback', keys: ['Space', 'K'], label: 'Play or pause' },
  { group: 'Playback', keys: ['→'], label: 'Forward 5 seconds' },
  { group: 'Playback', keys: ['←'], label: 'Back 5 seconds' },
  { group: 'Playback', keys: ['L'], label: 'Forward 10 seconds' },
  { group: 'Playback', keys: ['J'], label: 'Back 10 seconds' },
  { group: 'Playback', keys: ['N', '⇧ →'], label: 'Next track' },
  { group: 'Playback', keys: ['P', '⇧ ←'], label: 'Previous track' },
  { group: 'Sound', keys: ['↑'], label: 'Volume up' },
  { group: 'Sound', keys: ['↓'], label: 'Volume down' },
  { group: 'Sound', keys: ['M'], label: 'Mute or unmute' },
  { group: 'Queue', keys: ['S'], label: 'Shuffle on or off' },
  { group: 'Queue', keys: ['R'], label: 'Cycle repeat' },
  { group: 'Getting around', keys: ['F'], label: 'Open or close the full player' },
  { group: 'Getting around', keys: ['⌘ K', 'Ctrl K'], label: 'Search' },
  { group: 'Getting around', keys: ['/'], label: 'Search' },
  { group: 'Getting around', keys: ['?'], label: 'Show this list' },
  { group: 'Getting around', keys: ['Esc'], label: 'Close the player or a menu' },
]

/**
 * Event the search page listens for, so the shortcut can put the cursor in the
 * box whether or not that page is already open. Without it, pressing the key a
 * second time — already on /search — navigated to the page it was on and did
 * nothing visible.
 */
export const FOCUS_SEARCH_EVENT = 'pureplay:focus-search'

/** Typing somewhere? Then every key belongs to that field, not to the player. */
function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

/** Open the search page and put the cursor in its box. */
function focusSearch(navigate: (to: string) => void) {
  navigate('/search')
  // After the navigation has committed, so a page that is only now mounting
  // still has its input to focus.
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT)))
}

const VOLUME_STEP = 0.05
const SEEK_SMALL = 5
const SEEK_LARGE = 10

/**
 * Laptop transport controls.
 *
 * Mounted once, at the app root. Everything here is a bare key — no Ctrl or
 * Cmd — because those belong to the browser, so any modifier press falls
 * straight through to it. Keys are read from `e.key` rather than `e.code` so a
 * non-QWERTY layout gets the letters printed on its own keycaps, with Space
 * the one exception: it is the same physical key everywhere and `e.code` is
 * what distinguishes it from a typed space.
 */
export function useKeyboardShortcuts(onShowHelp: () => void) {
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()

      /*
        Cmd/Ctrl+K is the one chord worth taking from the browser: it is what
        every app with a search box has trained people to press, and it has to
        work from inside a text field too — that is half its point.
      */
      if ((e.metaKey || e.ctrlKey) && !e.altKey && key === 'k') {
        e.preventDefault()
        focusSearch(navigate)
        return
      }

      if (isTyping(e.target)) return
      // Let the browser keep the rest of its chords (Cmd+R, Ctrl+F, Alt+←, …).
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const p = usePlayer.getState()
      const el = e.target as HTMLElement | null

      // Space on a focused control activates that control — pressing it on the
      // Play button must not also toggle playback underneath and cancel itself.
      if (e.code === 'Space') {
        if (el && (el.tagName === 'BUTTON' || el.tagName === 'A')) return
        e.preventDefault()
        p.toggle()
        return
      }

      switch (key) {
        case 'k':
          e.preventDefault()
          p.toggle()
          return
        case 'arrowright':
          e.preventDefault()
          if (e.shiftKey) void p.next()
          else p.seek(Math.min(p.duration || Infinity, p.position + SEEK_SMALL))
          return
        case 'arrowleft':
          e.preventDefault()
          if (e.shiftKey) void p.prev()
          else p.seek(Math.max(0, p.position - SEEK_SMALL))
          return
        case 'l':
          p.seek(Math.min(p.duration || Infinity, p.position + SEEK_LARGE))
          return
        case 'j':
          p.seek(Math.max(0, p.position - SEEK_LARGE))
          return
        case 'n':
          void p.next()
          return
        case 'p':
          void p.prev()
          return
        case 'arrowup':
          e.preventDefault()
          p.setVolume(Math.min(1, p.volume + VOLUME_STEP))
          return
        case 'arrowdown':
          e.preventDefault()
          p.setVolume(Math.max(0, p.volume - VOLUME_STEP))
          return
        case 'm':
          p.toggleMute()
          return
        case 's':
          p.toggleShuffle()
          return
        case 'r':
          p.cycleRepeat()
          return
        case 'f':
          // Nothing to open without a track — and toggling it would flash an
          // empty overlay.
          if (p.current) p.toggleFullPlayer()
          return
        case '/':
          e.preventDefault()
          focusSearch(navigate)
          return
        case '?':
          e.preventDefault()
          onShowHelp()
          return
        default:
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, onShowHelp])
}
