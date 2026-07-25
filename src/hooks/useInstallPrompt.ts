import { useEffect, useState } from 'react'
import {
  getInstallPrompt,
  clearInstallPrompt,
  onInstallPromptChange,
  isStandalone,
} from '@/lib/pwa'

/**
 * Reads the globally-captured `beforeinstallprompt` (see initInstallCapture in
 * pwa.ts). Capturing at startup rather than in this hook matters: the event
 * fires once, early, and this hook only mounts on the Settings page — a
 * per-mount listener would always miss it, leaving the Install button dead.
 */
export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(() => !!getInstallPrompt())
  const [isInstalled, setIsInstalled] = useState(isStandalone)

  useEffect(() => {
    // sync in case the event arrived (or install completed) between renders
    setCanInstall(!!getInstallPrompt())
    setIsInstalled(isStandalone())
    return onInstallPromptChange(() => {
      setCanInstall(!!getInstallPrompt())
      setIsInstalled(isStandalone())
    })
  }, [])

  const promptInstall = async () => {
    const evt = getInstallPrompt()
    if (!evt) return false
    try {
      await evt.prompt()
      const choice = await evt.userChoice
      if (choice.outcome === 'accepted') setIsInstalled(true)
      return choice.outcome === 'accepted'
    } finally {
      // the event is single-use — the browser refuses to show it twice
      clearInstallPrompt()
    }
  }

  return { canInstall, isInstalled, promptInstall }
}
