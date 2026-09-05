import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Shell } from '@/components/Shell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PlaybackHost } from '@/components/PlaybackHost'
import { PlayerBar } from '@/components/PlayerBar'
import { FullPlayer } from '@/components/FullPlayer'
import { CardPlayer } from '@/components/CardPlayer'
import { RoomStatus } from '@/components/RoomStatus'
import { ShortcutsHelp } from '@/components/ShortcutsHelp'
import Home from '@/routes/Home'
import { EmptyState } from '@/components/ui'
import { PlayerThemeProvider } from '@/contexts/PlayerThemeContext'
import { usePlayer } from '@/store/player'

/*
  Home is the landing page, so it stays in the entry chunk — code-splitting the
  first thing everyone sees only adds a round trip. Every other page is fetched
  on the way to it, which keeps out of the cold start the ten route trees (and
  the icon sets, lyric parsers and game logic they drag along) that a session
  may well never open.

  The everyday ones are warmed on idle below, so navigation still lands
  instantly; Room and Heardle are left to load on demand.
*/
const Search = lazy(() => import('@/routes/Search'))
const Library = lazy(() => import('@/routes/Library'))
const Favorites = lazy(() => import('@/routes/Favorites'))
const Downloads = lazy(() => import('@/routes/Downloads'))
const Playlist = lazy(() => import('@/routes/Playlist'))
const ArtistPage = lazy(() => import('@/routes/ArtistPage'))
const Room = lazy(() => import('@/routes/Room'))
const Heardle = lazy(() => import('@/routes/Heardle'))
const SettingsPage = lazy(() => import('@/routes/Settings'))

const APP_NAME = 'PurePlay — Free Music Streaming, Ad-Free'

/**
 * The browser tab says what is playing.
 *
 * Small thing, but it is how someone finds this tab again among twenty others,
 * and it is what a pinned tab or a taskbar preview shows.
 */
function DocumentTitle() {
  const current = usePlayer((s) => s.current)
  const playing = usePlayer((s) => s.playing)

  useEffect(() => {
    document.title = current
      ? `${playing ? '▶' : '❚❚'} ${current.title} — ${current.artist}`
      : APP_NAME
  }, [current, playing])

  return null
}

/**
 * Land at the top of a newly opened page.
 *
 * Without this the browser keeps the previous page's scroll offset, so tapping
 * an artist from halfway down Home opened their page already scrolled into the
 * middle of the track list — which reads as a broken page, not a preserved
 * position.
 */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])
  return null
}

/**
 * The routed pages, wrapped so a render error in one of them shows a recovery
 * card instead of blanking the app. Keyed on the pathname: navigating to a
 * different page clears a previous page's error automatically.
 */
/**
 * Pull the route chunks in once the browser is idle.
 *
 * Splitting the routes trades a cold-start cost for a first-navigation one, and
 * a spinner between pages would be a worse deal than the parse it saved. This
 * pays the fetch back during the dead time after the home feed settles, so by
 * the time a tab is tapped the chunk is usually already in memory.
 */
function useRoutePrefetch() {
  useEffect(() => {
    const warm = () => {
      void import('@/routes/Search')
      void import('@/routes/Library')
      void import('@/routes/Favorites')
      void import('@/routes/Playlist')
      void import('@/routes/ArtistPage')
      void import('@/routes/Downloads')
      void import('@/routes/Settings')
    }
    const idle = window.requestIdleCallback
    if (idle) {
      const id = idle(warm, { timeout: 4000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = setTimeout(warm, 2500)
    return () => clearTimeout(t)
  }, [])
}

function Pages() {
  const { pathname } = useLocation()
  useRoutePrefetch()
  return (
    <ErrorBoundary resetKey={pathname}>
      {/* `null`, not a spinner: a warmed chunk resolves in the same frame, and
          flashing a loader over a page that is about to appear reads as slower
          than the blank moment it replaces. */}
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/library" element={<Library />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/playlist/:playlistId" element={<Playlist />} />
          <Route path="/artist/:artistId" element={<ArtistPage />} />
          <Route path="/room" element={<Room />} />
          <Route path="/heardle" element={<Heardle />} />
          <Route path="*" element={<EmptyState title="Page not found" hint="That route doesn't exist." />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <PlayerThemeProvider>
      <BrowserRouter>
        <ScrollToTop />
        <DocumentTitle />
        {/* Outside the boundary on purpose: a broken page must not stop the audio. */}
        <PlaybackHost />
        <Shell>
          <Pages />
        </Shell>
        <RoomStatus />
        <PlayerBar />
        <CardPlayer />
        <FullPlayer />
        {/* Installs the keyboard map as well as rendering the `?` sheet. */}
        <ShortcutsHelp />
      </BrowserRouter>
    </PlayerThemeProvider>
  )
}
