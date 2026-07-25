import { applyTheme } from './theme'

/**
 * Player UI appearance themes.
 *
 * Each theme changes the visual presentation of the FullPlayer overlay,
 * PlayerBar, and CardPlayer, and propagates its color system across the
 * entire application (Shell, page backgrounds, cards, typography).
 */

export const PLAYER_THEMES = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Dark glassmorphism with dynamic artwork backdrop',
    preview: '🎵',
    accent: '#8b5cf6',
    accentThemeId: 'purple',
  },
  {
    id: 'neumorphic',
    name: 'Neumorphic',
    description: 'Light soft-shadow style with circular artwork',
    preview: '☁️',
    accent: '#b8a990',
    accentThemeId: 'amber',
  },
  {
    id: 'vibrant',
    name: 'Vibrant',
    description: 'Bold purple gradient with high-contrast controls',
    preview: '✨',
    accent: '#a855f7',
    accentThemeId: 'purple',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean dark design with full-width lyrics & crisp hero art',
    preview: '⬛',
    accent: '#3b82f6',
    accentThemeId: 'blue',
  },
  {
    id: 'glasspro',
    name: 'Glass Pro',
    description: 'Premium frosted glass with cinematic backdrop',
    preview: '💎',
    accent: '#38bdf8',
    accentThemeId: 'blue',
  },
  {
    id: 'cherry-blossom',
    name: 'Cherry Blossom',
    description: 'Deep crimson & rose bloom with soft blush glows',
    preview: '🌸',
    accent: '#f43f5e',
    accentThemeId: 'pink',
  },
  {
    id: 'sunset-shades',
    name: 'Sunset Shades',
    description: 'Warm gold, apricot & coral sunset gradient',
    preview: '🌅',
    accent: '#f97316',
    accentThemeId: 'sunset',
  },
  {
    id: 'arc-studio',
    name: 'Arc Studio',
    description: 'Curved arch art frame with emerald teal & cyan glow',
    preview: '🌀',
    accent: '#06b6d4',
    accentThemeId: 'emerald',
  },
  {
    id: 'cosmic-aurora',
    name: 'Cosmic Aurora',
    description: 'Floating orb artwork with midnight indigo & violet aurora',
    preview: '🌌',
    accent: '#818cf8',
    accentThemeId: 'purple',
  },
  {
    id: 'midnight-ember',
    name: 'Midnight Ember',
    description: 'Deep navy palette with a coral ember accent (ColorHunt)',
    preview: '🔥',
    accent: '#e94560',
    accentThemeId: 'ember',
  },
  {
    id: 'emerald-gold',
    name: 'Emerald Gold',
    description: 'Dark forest green with royal gold highlights (ColorHunt)',
    preview: '🌿',
    accent: '#f5c542',
    accentThemeId: 'gold',
  },
] as const

export type PlayerThemeId = (typeof PLAYER_THEMES)[number]['id']

export const DEFAULT_PLAYER_THEME: PlayerThemeId = 'classic'

const PLAYER_THEME_KEY = 'lf:player-theme'
const SYNC_ACCENT_KEY = 'lf:sync-accent-with-theme'

const isPlayerThemeId = (v: unknown): v is PlayerThemeId =>
  PLAYER_THEMES.some((t) => t.id === v)

export function getPlayerTheme(): PlayerThemeId {
  try {
    const saved = localStorage.getItem(PLAYER_THEME_KEY)
    return isPlayerThemeId(saved) ? saved : DEFAULT_PLAYER_THEME
  } catch {
    return DEFAULT_PLAYER_THEME
  }
}

export function savePlayerTheme(id: PlayerThemeId) {
  try {
    localStorage.setItem(PLAYER_THEME_KEY, id)
  } catch {
    // private mode fallback
  }
}

export function getSyncAccentWithTheme(): boolean {
  try {
    const saved = localStorage.getItem(SYNC_ACCENT_KEY)
    return saved === null ? true : saved === 'true'
  } catch {
    return true
  }
}

export function saveSyncAccentWithTheme(enabled: boolean) {
  try {
    localStorage.setItem(SYNC_ACCENT_KEY, String(enabled))
  } catch {
    // private mode fallback
  }
}

export type ThemeCssVars = {
  '--shell-bg': string
  '--shell-sidebar-bg': string
  '--shell-topbar-bg': string
  '--shell-border': string
  '--shell-nav-text': string
  '--shell-nav-hover-bg': string
  '--shell-nav-active': string
  '--color-ink-950': string
  '--color-ink-900': string
  '--color-ink-850': string
  '--color-ink-800': string
  '--color-ink-700': string
  '--color-ink-400': string
  '--color-ink-300': string
  '--color-ink-200': string
  '--shell-color-scheme': 'dark' | 'light'
}

export const THEME_CSS_VARS: Record<PlayerThemeId, ThemeCssVars> = {
  classic: {
    '--shell-bg': '#070708',
    '--shell-sidebar-bg': '#0c0c0e',
    '--shell-topbar-bg': 'rgba(12,12,14,0.75)',
    '--shell-border': '#17171b',
    '--shell-nav-text': '#9a9aab',
    '--shell-nav-hover-bg': 'rgba(23,23,27,0.60)',
    '--shell-nav-active': 'var(--color-accent)',
    '--color-ink-950': '#070708',
    '--color-ink-900': '#0c0c0e',
    '--color-ink-850': '#121215',
    '--color-ink-800': '#17171b',
    '--color-ink-700': '#232329',
    '--color-ink-400': '#82828f',
    '--color-ink-300': '#9a9aab',
    '--color-ink-200': '#c6c6d2',
    '--shell-color-scheme': 'dark',
  },
  neumorphic: {
    '--shell-bg': '#e8e2d8',
    '--shell-sidebar-bg': '#ddd8ce',
    '--shell-topbar-bg': 'rgba(214,207,196,0.92)',
    '--shell-border': '#c8c0b4',
    '--shell-nav-text': '#78706a',
    '--shell-nav-hover-bg': 'rgba(184,169,144,0.30)',
    '--shell-nav-active': '#443c34',
    '--color-ink-950': '#e8e2d8',
    '--color-ink-900': '#ddd8ce',
    '--color-ink-850': '#d4ceb4',
    '--color-ink-800': '#c8c0b4',
    '--color-ink-700': '#b8a990',
    '--color-ink-400': '#685d52',
    '--color-ink-300': '#544940',
    '--color-ink-200': '#29241f',
    '--shell-color-scheme': 'light',
  },
  vibrant: {
    '--shell-bg': '#1a0433',
    '--shell-sidebar-bg': '#1e0838',
    '--shell-topbar-bg': 'rgba(30,8,56,0.85)',
    '--shell-border': 'rgba(139,92,246,0.25)',
    '--shell-nav-text': 'rgba(233,213,255,0.65)',
    '--shell-nav-hover-bg': 'rgba(139,92,246,0.20)',
    '--shell-nav-active': '#c4b5fd',
    '--color-ink-950': '#1a0433',
    '--color-ink-900': '#220842',
    '--color-ink-850': '#2b0b52',
    '--color-ink-800': '#361066',
    '--color-ink-700': '#4c1d95',
    '--color-ink-400': '#c4b5fd',
    '--color-ink-300': '#ddd6fe',
    '--color-ink-200': '#f3e8ff',
    '--shell-color-scheme': 'dark',
  },
  minimal: {
    '--shell-bg': '#0a0a0a',
    '--shell-sidebar-bg': '#111111',
    '--shell-topbar-bg': 'rgba(10,10,10,0.90)',
    '--shell-border': '#222222',
    '--shell-nav-text': '#777777',
    '--shell-nav-hover-bg': 'rgba(255,255,255,0.06)',
    '--shell-nav-active': '#ffffff',
    '--color-ink-950': '#0a0a0a',
    '--color-ink-900': '#111111',
    '--color-ink-850': '#161616',
    '--color-ink-800': '#1e1e1e',
    '--color-ink-700': '#2a2a2a',
    '--color-ink-400': '#888888',
    '--color-ink-300': '#aaaaaa',
    '--color-ink-200': '#e5e5e5',
    '--shell-color-scheme': 'dark',
  },
  glasspro: {
    // A cinematic gradient so the frosted-glass panels have colour to blur over
    // (see the [data-player-theme="glasspro"] rules in index.css).
    '--shell-bg':
      'radial-gradient(1200px 600px at 15% -10%, #1e3a8a 0%, transparent 55%), radial-gradient(1000px 700px at 100% 0%, #0e7490 0%, transparent 50%), linear-gradient(160deg, #0a0f1f 0%, #0b1226 55%, #070b16 100%)',
    '--shell-sidebar-bg': 'rgba(15,23,42,0.45)',
    '--shell-topbar-bg': 'rgba(15,23,42,0.35)',
    '--shell-border': 'rgba(255,255,255,0.12)',
    '--shell-nav-text': 'rgba(203,225,255,0.7)',
    '--shell-nav-hover-bg': 'rgba(255,255,255,0.10)',
    '--shell-nav-active': '#38bdf8',
    // Dark translucent surfaces so panels read as frosted glass over the
    // gradient while text stays high-contrast (index.css adds the blur).
    '--color-ink-950': '#080c18',
    '--color-ink-900': 'rgba(17,26,48,0.55)',
    '--color-ink-850': 'rgba(22,32,58,0.58)',
    '--color-ink-800': 'rgba(38,52,82,0.60)',
    '--color-ink-700': 'rgba(56,74,110,0.60)',
    '--color-ink-400': '#a5c4e0',
    '--color-ink-300': '#cbd5e1',
    '--color-ink-200': '#f8fafc',
    '--shell-color-scheme': 'dark',
  },
  'cherry-blossom': {
    '--shell-bg': '#2e050e',
    '--shell-sidebar-bg': '#3b0813',
    '--shell-topbar-bg': 'rgba(59,8,19,0.85)',
    '--shell-border': 'rgba(244,63,94,0.25)',
    '--shell-nav-text': 'rgba(254,205,211,0.65)',
    '--shell-nav-hover-bg': 'rgba(244,63,94,0.20)',
    '--shell-nav-active': '#fecdd3',
    '--color-ink-950': '#2e050e',
    '--color-ink-900': '#3b0813',
    '--color-ink-850': '#4a0e17',
    '--color-ink-800': '#5c1220',
    '--color-ink-700': '#881337',
    '--color-ink-400': '#fca5a5',
    '--color-ink-300': '#fecdd3',
    '--color-ink-200': '#fff0f3',
    '--shell-color-scheme': 'dark',
  },
  'sunset-shades': {
    '--shell-bg': '#3b1207',
    '--shell-sidebar-bg': '#481708',
    '--shell-topbar-bg': 'rgba(72,23,8,0.85)',
    '--shell-border': 'rgba(249,115,22,0.25)',
    '--shell-nav-text': 'rgba(254,215,170,0.65)',
    '--shell-nav-hover-bg': 'rgba(249,115,22,0.20)',
    '--shell-nav-active': '#ffedd5',
    '--color-ink-950': '#3b1207',
    '--color-ink-900': '#481708',
    '--color-ink-850': '#571c0a',
    '--color-ink-800': '#7c2d12',
    '--color-ink-700': '#9a3412',
    '--color-ink-400': '#fdba74',
    '--color-ink-300': '#fed7aa',
    '--color-ink-200': '#ffedd5',
    '--shell-color-scheme': 'dark',
  },
  'arc-studio': {
    '--shell-bg': '#022c22',
    '--shell-sidebar-bg': '#064e3b',
    '--shell-topbar-bg': 'rgba(6,78,59,0.85)',
    '--shell-border': 'rgba(6,182,212,0.25)',
    '--shell-nav-text': 'rgba(167,243,208,0.65)',
    '--shell-nav-hover-bg': 'rgba(6,182,212,0.20)',
    '--shell-nav-active': '#67e8f9',
    '--color-ink-950': '#022c22',
    '--color-ink-900': '#064e3b',
    '--color-ink-850': '#047857',
    '--color-ink-800': '#0f766e',
    '--color-ink-700': '#115e59',
    '--color-ink-400': '#a7f3d0',
    '--color-ink-300': '#c7d2fe',
    '--color-ink-200': '#ecfeff',
    '--shell-color-scheme': 'dark',
  },
  'cosmic-aurora': {
    '--shell-bg': '#090d16',
    '--shell-sidebar-bg': '#0f172a',
    '--shell-topbar-bg': 'rgba(15,23,42,0.85)',
    '--shell-border': 'rgba(99,102,241,0.25)',
    '--shell-nav-text': 'rgba(199,210,254,0.65)',
    '--shell-nav-hover-bg': 'rgba(99,102,241,0.20)',
    '--shell-nav-active': '#a5b4fc',
    '--color-ink-950': '#090d16',
    '--color-ink-900': '#0f172a',
    '--color-ink-850': '#1e1b4b',
    '--color-ink-800': '#312e81',
    '--color-ink-700': '#4338ca',
    '--color-ink-400': '#818cf8',
    '--color-ink-300': '#c7d2fe',
    '--color-ink-200': '#e0e7ff',
    '--shell-color-scheme': 'dark',
  },
  // ── ColorHunt palettes ────────────────────────────────────────────────────
  'midnight-ember': {
    '--shell-bg': '#14142a',
    '--shell-sidebar-bg': '#1a1a2e',
    '--shell-topbar-bg': 'rgba(26,26,46,0.85)',
    '--shell-border': 'rgba(233,69,96,0.22)',
    '--shell-nav-text': 'rgba(199,201,224,0.62)',
    '--shell-nav-hover-bg': 'rgba(15,52,96,0.45)',
    '--shell-nav-active': '#e94560',
    '--color-ink-950': '#0f0f1e',
    '--color-ink-900': '#14142a',
    '--color-ink-850': '#1a1a2e',
    '--color-ink-800': '#16213e',
    '--color-ink-700': '#253b6e',
    '--color-ink-400': '#9aa0c5',
    '--color-ink-300': '#c4c8e6',
    '--color-ink-200': '#eef0ff',
    '--shell-color-scheme': 'dark',
  },
  'emerald-gold': {
    '--shell-bg': '#0c241b',
    '--shell-sidebar-bg': '#0f2d22',
    '--shell-topbar-bg': 'rgba(15,45,34,0.85)',
    '--shell-border': 'rgba(245,197,66,0.22)',
    '--shell-nav-text': 'rgba(200,224,210,0.62)',
    '--shell-nav-hover-bg': 'rgba(20,80,60,0.42)',
    '--shell-nav-active': '#f5c542',
    '--color-ink-950': '#071a12',
    '--color-ink-900': '#0c241b',
    '--color-ink-850': '#0f2d22',
    '--color-ink-800': '#14432f',
    '--color-ink-700': '#1c5c40',
    '--color-ink-400': '#8bb3a0',
    '--color-ink-300': '#b8d8c6',
    '--color-ink-200': '#eafff3',
    '--shell-color-scheme': 'dark',
  },
}

/** Write theme CSS vars to :root so every component across all pages reacts */
export function applyThemeCssVars(id: PlayerThemeId, syncAccent = getSyncAccentWithTheme()) {
  const theme = PLAYER_THEMES.find((t) => t.id === id) || PLAYER_THEMES[0]
  const vars = THEME_CSS_VARS[theme.id] || THEME_CSS_VARS.classic
  const root = document.documentElement

  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value)
  }

  root.style.colorScheme = vars['--shell-color-scheme']
  root.setAttribute('data-theme-scheme', vars['--shell-color-scheme'])
  // Lets index.css target a specific theme (e.g. the Glass Pro frosting rules).
  root.setAttribute('data-player-theme', theme.id)

  if (syncAccent && theme.accentThemeId) {
    applyTheme(theme.accentThemeId)
  }
}
