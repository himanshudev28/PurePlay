import { useCallback, useSyncExternalStore } from 'react'

const supported = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/**
 * A live boolean for a CSS media query.
 *
 * Layout that only differs cosmetically belongs in Tailwind breakpoints; this
 * is for the cases where the two widths want genuinely *different markup* —
 * rendering both and hiding one with `sm:hidden` would double the DOM (and the
 * subscriptions each row makes to the player store) on every shelf.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!supported()) return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )

  const get = useCallback(
    () => (supported() ? window.matchMedia(query).matches : fallback),
    [query, fallback],
  )

  return useSyncExternalStore(subscribe, get, () => fallback)
}

/** True at phone widths — below Tailwind's `sm` breakpoint. */
export function useIsCompact(): boolean {
  return useMediaQuery('(max-width: 639px)')
}
