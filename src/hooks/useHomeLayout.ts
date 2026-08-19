import { useSyncExternalStore } from 'react'
import { getHomeLayout, subscribeHomeLayout, DEFAULT_HOME_LAYOUT, type HomeLayout } from '@/lib/prefs'

/**
 * The chosen home layout, re-rendering whoever reads it the moment Settings
 * changes it — so the toggle is visibly live rather than needing a reload.
 */
export function useHomeLayout(): HomeLayout {
  return useSyncExternalStore(subscribeHomeLayout, getHomeLayout, () => DEFAULT_HOME_LAYOUT)
}
