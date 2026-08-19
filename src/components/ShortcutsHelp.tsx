import { useCallback, useEffect, useState } from 'react'
import { Keyboard, X } from 'lucide-react'
import { useKeyboardShortcuts, SHORTCUTS } from '@/hooks/useKeyboardShortcuts'

/**
 * The keyboard map, and the sheet that explains it.
 *
 * A shortcut nobody can discover may as well not exist, so the same component
 * that installs the handlers also owns the `?` sheet that lists them — and the
 * list is generated from the map itself, so a key that works is a key that is
 * documented.
 *
 * Rendered at the app root; invisible until asked for.
 */
/** Event name the Settings entry uses to raise the sheet without a shared store. */
const OPEN_EVENT = 'pureplay:shortcuts'

/** Open the shortcuts sheet from anywhere (Settings uses this). */
export function openShortcutsHelp() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  const show = useCallback(() => setOpen(true), [])

  useKeyboardShortcuts(show)

  useEffect(() => {
    window.addEventListener(OPEN_EVENT, show)
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [show])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        aria-label="Close keyboard shortcuts"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-ink-900/95 p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <Keyboard size={18} className="text-accent" aria-hidden />
          <h2 className="font-display text-lg font-bold text-white">Keyboard shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="ml-auto rounded-full p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group}>
              <h3 className="mb-2 text-[11px] font-bold tracking-wider text-ink-400 uppercase">
                {group}
              </h3>
              <dl className="space-y-1">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 odd:bg-white/[0.03]"
                  >
                    <dt className="text-sm text-ink-200">{s.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white"
                        >
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="mt-4 text-xs text-ink-400">
          Shortcuts pause while you are typing in a search or text field.
        </p>
      </div>
    </div>
  )
}
