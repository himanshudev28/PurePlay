export interface ThemeColor {
  id: string
  name: string
  /** primary accent — actions, current selection, state indicators */
  accent: string
  /** lighter step, used for text on accent-tinted surfaces (error notes, hovers) */
  soft: string
  /** darkened step, used as a background tint behind `soft` text */
  dim: string
  /** `r, g, b` channels so glows and tints can compose at any alpha */
  rgb: string
}

export const THEMES: ThemeColor[] = [
  { id: 'sunset', name: 'Sunset Orange', accent: '#ff6b4a', soft: '#ff8a6d', dim: '#4a2118', rgb: '255, 107, 74' },
  { id: 'emerald', name: 'Emerald Wave', accent: '#10b981', soft: '#34d399', dim: '#0b3b2c', rgb: '16, 185, 129' },
  { id: 'purple', name: 'Electric Purple', accent: '#8b5cf6', soft: '#a78bfa', dim: '#2b1b52', rgb: '139, 92, 246' },
  { id: 'blue', name: 'Ocean Blue', accent: '#3b82f6', soft: '#60a5fa', dim: '#12294f', rgb: '59, 130, 246' },
  { id: 'pink', name: 'Neon Rose', accent: '#ec4899', soft: '#f472b6', dim: '#4a1236', rgb: '236, 72, 153' },
  { id: 'amber', name: 'Cyber Amber', accent: '#f59e0b', soft: '#fbbf24', dim: '#4a2f05', rgb: '245, 158, 11' },
]

export const DEFAULT_THEME_ID = 'sunset'

const STORAGE_KEY = 'lf:theme'

export function resolveTheme(themeId: string | null | undefined): ThemeColor {
  return THEMES.find((t) => t.id === themeId) ?? THEMES[0]
}

/**
 * Writes the full accent family, not just `--color-accent`.
 *
 * Previously only the base accent and its channels were swapped, so picking
 * "Emerald Wave" left every `accent-soft` label and `accent-dim` background
 * (error notes, the playback failure bar) rendering in the default orange.
 */
export function applyTheme(themeId: string) {
  const t = resolveTheme(themeId)
  const root = document.documentElement.style
  root.setProperty('--color-accent', t.accent)
  root.setProperty('--color-accent-soft', t.soft)
  root.setProperty('--color-accent-dim', t.dim)
  root.setProperty('--color-accent-rgb', t.rgb)

  // keep the browser chrome (address bar, task switcher) in step with the theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#070708')

  try {
    localStorage.setItem(STORAGE_KEY, t.id)
  } catch {
    // private-mode / quota — the theme still applies for this session
  }
}

export function getSavedThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

export function initTheme() {
  applyTheme(getSavedThemeId())
}
