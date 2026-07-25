import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // iOS Safari reports standalone on `navigator`, not via the media query
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) setIsInstalled(true)

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    // this listener was registered anonymously and never removed, so every
    // mount (including StrictMode's double-invoke) leaked another one
    const onInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = async () => {
    if (!deferredPrompt) return false
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setIsInstalled(true)
        return true
      }
      return false
    } finally {
      // the event is single-use either way — keeping it would show a prompt
      // that the browser silently refuses to display a second time
      setDeferredPrompt(null)
    }
  }

  return { canInstall: !!deferredPrompt, isInstalled, promptInstall }
}
