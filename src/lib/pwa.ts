/**
 * Service worker registration + update prompt.
 *
 * Registered only in production: in dev the SW would serve a stale shell and
 * fight Vite's HMR.
 */
export function registerServiceWorker(onUpdateReady?: () => void) {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const incoming = reg.installing
          if (!incoming) return
          incoming.addEventListener('statechange', () => {
            // a new SW is waiting *and* an old one is in control -> real update
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdateReady?.()
            }
          })
        })
      })
      .catch(() => {
        // an unregistrable SW must never break the app
      })
  })
}

/** True when the app is running as an installed PWA rather than a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates display-mode
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
