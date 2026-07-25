import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Shell } from '@/components/Shell'
import { PlaybackHost } from '@/components/PlaybackHost'
import { PlayerBar } from '@/components/PlayerBar'
import { FullPlayer } from '@/components/FullPlayer'
import { CardPlayer } from '@/components/CardPlayer'
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

export default function App() {
  return (
    <PlayerThemeProvider>
      <BrowserRouter>
        <PlaybackHost />
        <Shell>
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
        </Shell>
        <PlayerBar />
        <CardPlayer />
        <FullPlayer />
      </BrowserRouter>
    </PlayerThemeProvider>
  )
}
