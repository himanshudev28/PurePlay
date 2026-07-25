/**
 * Service worker registration + update prompt.
 *
 * Registered only in production: in dev the SW would serve a stale shell and
 * fight Vite's HMR.
 */
export function registerServiceWorker(onUpdateReady?: () => void) {
  if (!('serviceWorker' in navigator)) return
  // enforce what the doc comment promises — in dev the SW caches the shell and
  // fights Vite's HMR
  if (!import.meta.env.PROD) return

  const register = () => {
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
  }

  // `load` may already have fired by the time this deferred module runs — a
  // listener added after the fact never fires and the SW never registers
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

/** True when the app is running as an installed PWA rather than a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates display-mode
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/* ── Install prompt capture ────────────────────────────────────────────────
   `beforeinstallprompt` fires ONCE, early, on initial load. useInstallPrompt
   only mounts on the Settings page, so by the time the user opens Settings the
   event is long gone and the Install button is dead. Capture it globally at
   startup instead and hold it, so the button works whenever Settings opens. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

/** Call once at app startup (before React renders) so no event is missed. */
export function initInstallCapture() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export const getInstallPrompt = () => deferredPrompt
export const clearInstallPrompt = () => {
  deferredPrompt = null
  notify()
}
export function onInstallPromptChange(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
