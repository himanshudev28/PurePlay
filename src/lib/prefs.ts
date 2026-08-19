/**
 * User preferences that outlive a session.
 *
 * The audio-quality picker in Settings wrote `lf:quality` to localStorage and
 * nothing ever read it — the stream resolver always reached for the highest
 * bitrate. Routing both sides through here keeps the setting honest.
 */

export const QUALITIES = ['320', '160', '96'] as const
export type Quality = (typeof QUALITIES)[number]

export const DEFAULT_QUALITY: Quality = '320'

const QUALITY_KEY = 'lf:quality'

const isQuality = (v: unknown): v is Quality => QUALITIES.includes(v as Quality)

export function getQuality(): Quality {
  try {
    const saved = localStorage.getItem(QUALITY_KEY)
    return isQuality(saved) ? saved : DEFAULT_QUALITY
  } catch {
    return DEFAULT_QUALITY
  }
}

export function setQuality(q: Quality) {
  try {
    localStorage.setItem(QUALITY_KEY, q)
  } catch {
    // private mode / quota — the choice still applies to this session
  }
}

const VOLUME_KEY = 'lf:volume'

export function getVolume(): number {
  try {
    const raw = Number(localStorage.getItem(VOLUME_KEY))
    // `Number(null)` and `Number('')` are both 0, so a missing or blank entry
    // used to start the app silently muted.
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.8
  } catch {
    return 0.8
  }
}

export function setVolume(v: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(v))
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ layout */

export const HOME_LAYOUTS = ['grid', 'classic'] as const
export type HomeLayout = (typeof HOME_LAYOUTS)[number]

/**
 * The card grid is the default home: a dense wall of playable cards with a
 * "Quick picks" block at the very top, so the first thing on screen is
 * something to press rather than a single oversized hero.
 * "classic" keeps the original hero-and-shelves page for anyone who prefers it.
 */
export const DEFAULT_HOME_LAYOUT: HomeLayout = 'grid'

const HOME_LAYOUT_KEY = 'lf:home-layout'

const isHomeLayout = (v: unknown): v is HomeLayout => HOME_LAYOUTS.includes(v as HomeLayout)

/**
 * localStorage isn't reactive, so the Settings toggle and the Home page it
 * controls are kept in step by a tiny pub/sub — the same shape `useDownloads`
 * uses for IndexedDB.
 */
const layoutListeners = new Set<() => void>()

export function getHomeLayout(): HomeLayout {
  try {
    const saved = localStorage.getItem(HOME_LAYOUT_KEY)
    return isHomeLayout(saved) ? saved : DEFAULT_HOME_LAYOUT
  } catch {
    return DEFAULT_HOME_LAYOUT
  }
}

export function setHomeLayout(layout: HomeLayout) {
  try {
    localStorage.setItem(HOME_LAYOUT_KEY, layout)
  } catch {
    // private mode / quota — the choice still applies to this session
  }
  layoutListeners.forEach((fn) => fn())
}

export function subscribeHomeLayout(fn: () => void): () => void {
  layoutListeners.add(fn)
  return () => {
    layoutListeners.delete(fn)
  }
}
