import { useCallback, useEffect, useState } from 'react'
import {
  Palette, Gauge, HardDrive, Smartphone, Check, Loader2, Layers,
} from 'lucide-react'
import clsx from 'clsx'
import { THEMES, applyTheme, getSavedThemeId } from '@/lib/theme'
import { getQuality, setQuality, type Quality } from '@/lib/prefs'
import { storageUsage, listDownloads, removeDownload } from '@/lib/db'
import { notifyDownloadsChanged } from '@/hooks/useDownloads'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { formatBytes } from '@/lib/format'
import { usePlayerTheme } from '@/contexts/PlayerThemeContext'
import { PLAYER_THEMES, type PlayerThemeId } from '@/lib/playerTheme'

const QUALITIES: { id: Quality; label: string; desc: string }[] = [
  { id: '320', label: 'High (320 kbps)', desc: 'Best audio quality; uses more data.' },
  { id: '160', label: 'Medium (160 kbps)', desc: 'Balanced quality and data usage.' },
  { id: '96', label: 'Data Saver (96 kbps)', desc: 'Uses minimal data; best for weak connections.' },
]

export default function Settings() {
  const [activeTheme, setActiveTheme] = useState(getSavedThemeId)
  const [quality, setQualityState] = useState<Quality>(getQuality)
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt()
  const { playerTheme, setPlayerTheme, syncAccent, setSyncAccent } = usePlayerTheme()

  const [usage, setUsage] = useState<{ used: number; quota: number; tracks: number } | null>(null)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  const refreshUsage = useCallback(async () => {
    const [{ used, quota }, downloads] = await Promise.all([storageUsage(), listDownloads()])
    setUsage({ used, quota, tracks: downloads.length })
  }, [])

  useEffect(() => {
    void refreshUsage()
  }, [refreshUsage])

  const handleSelectTheme = (id: string) => {
    setActiveTheme(id)
    applyTheme(id)
  }

  const handleQualityChange = (q: Quality) => {
    setQualityState(q)
    setQuality(q)
  }

  const handlePlayerThemeChange = (id: PlayerThemeId) => {
    setPlayerTheme(id)
    // With "sync accent" on, picking a player theme rewrites the saved accent —
    // re-read it so the Accent radiogroup above doesn't keep showing the old
    // choice as checked.
    setActiveTheme(getSavedThemeId())
  }

  const handleClearCache = async () => {
    const count = usage?.tracks ?? 0
    const message = count
      ? `Delete ${count} downloaded track${count === 1 ? '' : 's'} and the offline app cache? You can download them again later.`
      : 'Clear the offline app cache?'
    if (!window.confirm(message)) return

    setClearing(true)
    try {
      if ('caches' in window) {
        // only OUR caches — the service worker deliberately namespaces them
        // (sw.js), and deleting every cache on the origin would evict storage
        // belonging to anything else served from it
        const keys = await caches.keys()
        await Promise.all(
          keys.filter((k) => k.startsWith('shell-') || k.startsWith('assets-')).map((k) => caches.delete(k)),
        )
      }
      const downloads = await listDownloads()
      await Promise.all(downloads.map((d) => removeDownload(d.track)))
      notifyDownloadsChanged()
      await refreshUsage()
      setCleared(true)
      setTimeout(() => setCleared(false), 3000)
    } catch (e) {
      console.error('[settings] clearing storage failed:', e)
    } finally {
      setClearing(false)
    }
  }

  /** Preview colour swatches for each player theme */
  const PLAYER_THEME_COLORS: Record<string, string[]> = {
    classic:           ['#1e1432', '#8b5cf6', '#0b0914'],
    neumorphic:        ['#d6cfc4', '#b8a990', '#e8e0d5'],
    vibrant:           ['#3b0764', '#a855f7', '#7c3aed'],
    minimal:           ['#111827', '#3b82f6', '#1f2937'],
    glasspro:          ['#0c1a2e', '#38bdf8', '#1e3a5f'],
    'cherry-blossom':  ['#2e050e', '#881337', '#f43f5e'],
    'sunset-shades':   ['#481708', '#c2410c', '#f97316'],
    'arc-studio':      ['#022c22', '#0f766e', '#06b6d4'],
    'cosmic-aurora':   ['#090d16', '#312e81', '#818cf8'],
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-ink-400">Theme, playback quality, offline storage, and app install.</p>
      </header>

      <Section
        icon={<Palette size={20} />}
        title="Accent colour"
        description="Used for primary actions, current selection, and highlight accents."
      >
        <div
          role="radiogroup"
          aria-label="Accent colour"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {THEMES.map((t) => {
            const isSelected = activeTheme === t.id
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelectTheme(t.id)}
                className={clsx(
                  'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                  isSelected
                    ? 'border-accent bg-accent/10'
                    : 'border-ink-800 bg-ink-950/40 hover:border-ink-600',
                )}
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: t.accent }}
                >
                  {isSelected && <Check size={14} className="text-white drop-shadow" />}
                </span>
                <span className="text-sm font-medium text-white">{t.name}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        icon={<Layers size={20} />}
        title="Player appearance & App theme"
        description="Choose the visual style for the player and entire app UI."
      >
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-4 rounded-xl border border-ink-800 bg-ink-950/40 p-4 cursor-pointer hover:border-ink-600 transition">
            <div className="space-y-0.5">
              <span className="text-sm font-semibold text-white">Sync accent colour with theme</span>
              <p className="text-xs text-ink-400">Automatically update accent colors to complement the chosen player theme.</p>
            </div>
            <input
              type="checkbox"
              checked={syncAccent}
              onChange={(e) => {
                setSyncAccent(e.target.checked)
                setActiveTheme(getSavedThemeId())
              }}
              className="h-5 w-5 rounded border-ink-700 text-accent focus:ring-accent accent-accent cursor-pointer"
            />
          </label>

          <div
            role="radiogroup"
            aria-label="Player appearance"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {PLAYER_THEMES.map((t) => {
              const isSelected = playerTheme === t.id
              const colors = PLAYER_THEME_COLORS[t.id] ?? ['#333', '#666', '#999']
              return (
                <button
                  key={t.id}
                  id={`player-theme-${t.id}`}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => handlePlayerThemeChange(t.id)}
                  className={clsx(
                    'flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors',
                    isSelected
                      ? 'border-accent bg-accent/10 ring-2 ring-accent/30'
                      : 'border-ink-800 bg-ink-950/40 hover:border-ink-600',
                  )}
                >
                  <span aria-hidden className="relative flex h-10 w-full overflow-hidden rounded-lg">
                    {colors.map((c, i) => (
                      <span key={i} className="flex-1" style={{ backgroundColor: c }} />
                    ))}
                    {isSelected && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Check size={18} className="text-white drop-shadow" />
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="text-xl leading-none">{t.preview}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{t.name}</span>
                      <span className="block text-xs text-ink-400 line-clamp-2">{t.description}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Section>

      <Section
        icon={<Gauge size={20} />}
        title="Streaming quality"
        description="Select default audio quality for playback."
      >
        <div role="radiogroup" aria-label="Streaming quality" className="space-y-2">
          {QUALITIES.map((q) => {
            const isSelected = quality === q.id
            return (
              <button
                key={q.id}
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleQualityChange(q.id)}
                className={clsx(
                  'flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors',
                  isSelected
                    ? 'border-accent bg-accent/10'
                    : 'border-ink-800 bg-ink-950/40 hover:border-ink-600',
                )}
              >
                <div>
                  <p className="text-sm font-semibold text-white">{q.label}</p>
                  <p className="text-xs text-ink-400">{q.desc}</p>
                </div>
                {isSelected && <Check size={18} className="shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        icon={<HardDrive size={20} />}
        title="Offline storage & cache"
        description="Manage cached audio files and offline storage."
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-ink-800 bg-ink-950/40 p-4">
            <div>
              <p className="text-sm font-semibold text-white">Storage usage</p>
              <p className="text-xs text-ink-400">
                {usage
                  ? `${formatBytes(usage.used)} used (${usage.tracks} track${usage.tracks === 1 ? '' : 's'})`
                  : 'Calculating…'}
              </p>
            </div>
            <button
              onClick={() => void handleClearCache()}
              disabled={clearing}
              className="rounded-lg bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition"
            >
              {clearing ? <Loader2 size={14} className="animate-spin" /> : cleared ? 'Cleared!' : 'Clear storage'}
            </button>
          </div>
        </div>
      </Section>

      <Section
        icon={<Smartphone size={20} />}
        title="App installation & PWA"
        description="Install PurePlay on your device for a fast, native app experience."
      >
        {isInstalled ? (
          <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
            <Check size={16} /> PurePlay is installed on this device.
          </p>
        ) : canInstall ? (
          <button
            onClick={() => void promptInstall()}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-bold text-ink-950 shadow-lg hover:scale-105 transition"
          >
            <Smartphone size={16} /> Install PurePlay App
          </button>
        ) : (
          /* No install prompt is available here (iOS Safari, Firefox) — a
             primary button that does nothing on tap is worse than honest
             instructions, so the manual path IS the content. */
          <p className="text-xs text-ink-300">
            Your browser doesn't offer one-tap install. Open the browser menu and choose{' '}
            <strong className="text-white">"Add to Home Screen"</strong> (iOS Safari) or{' '}
            <strong className="text-white">"Install App"</strong> to install PurePlay.
          </p>
        )}
      </Section>
    </div>
  )
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-ink-800 bg-ink-900/60 p-5 backdrop-blur-xl sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-accent/10 p-2 text-accent">{icon}</div>
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="text-xs text-ink-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}
