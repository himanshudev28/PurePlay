import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Shell } from '@/components/Shell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PlaybackHost } from '@/components/PlaybackHost'
import { PlayerBar } from '@/components/PlayerBar'
import { FullPlayer } from '@/components/FullPlayer'
import { CardPlayer } from '@/components/CardPlayer'
import { RoomStatus } from '@/components/RoomStatus'
import Home from '@/routes/Home'
import Search from '@/routes/Search'
import Library from '@/routes/Library'
import Favorites from '@/routes/Favorites'
import Downloads from '@/routes/Downloads'
import Playlist from '@/routes/Playlist'
import ArtistPage from '@/routes/ArtistPage'
import Room from '@/routes/Room'
import Heardle from '@/routes/Heardle'
import Settings from '@/routes/Settings'
import { EmptyState } from '@/components/ui'
import { PlayerThemeProvider } from '@/contexts/PlayerThemeContext'
import { usePlayer } from '@/store/player'

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
function Pages() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/library" element={<Library />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/playlist/:playlistId" element={<Playlist />} />
        <Route path="/artist/:artistId" element={<ArtistPage />} />
        <Route path="/room" element={<Room />} />
        <Route path="/heardle" element={<Heardle />} />
        <Route path="*" element={<EmptyState title="Page not found" hint="That route doesn't exist." />} />
      </Routes>
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
      </BrowserRouter>
    </PlayerThemeProvider>
  )
}
