import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import {
  getPlayerTheme,
  savePlayerTheme,
  getSyncAccentWithTheme,
  saveSyncAccentWithTheme,
  applyThemeCssVars,
  type PlayerThemeId,
} from '@/lib/playerTheme'

interface PlayerThemeContextValue {
  playerTheme: PlayerThemeId
  setPlayerTheme: (id: PlayerThemeId) => void
  syncAccent: boolean
  setSyncAccent: (enabled: boolean) => void
}

const PlayerThemeContext = createContext<PlayerThemeContextValue | null>(null)

export function PlayerThemeProvider({ children }: { children: ReactNode }) {
  const [playerTheme, setPlayerThemeState] = useState<PlayerThemeId>(getPlayerTheme)
  const [syncAccent, setSyncAccentState] = useState<boolean>(getSyncAccentWithTheme)

  useEffect(() => {
    applyThemeCssVars(playerTheme, syncAccent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setPlayerTheme = (id: PlayerThemeId) => {
    setPlayerThemeState(id)
    savePlayerTheme(id)
    applyThemeCssVars(id, syncAccent)
  }

  const setSyncAccent = (enabled: boolean) => {
    setSyncAccentState(enabled)
    saveSyncAccentWithTheme(enabled)
    applyThemeCssVars(playerTheme, enabled)
  }

  return (
    <PlayerThemeContext.Provider
      value={{
        playerTheme,
        setPlayerTheme,
        syncAccent,
        setSyncAccent,
      }}
    >
      {children}
    </PlayerThemeContext.Provider>
  )
}

export function usePlayerTheme(): PlayerThemeContextValue {
  const ctx = useContext(PlayerThemeContext)
  if (!ctx) throw new Error('usePlayerTheme must be used inside PlayerThemeProvider')
  return ctx
}
