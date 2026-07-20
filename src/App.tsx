import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Shell } from '@/components/Shell'
import { PlaybackHost } from '@/components/PlaybackHost'
import { PlayerBar } from '@/components/PlayerBar'
import Home from '@/routes/Home'
import Search from '@/routes/Search'
import Library from '@/routes/Library'
import Favorites from '@/routes/Favorites'
import Downloads from '@/routes/Downloads'
import Playlist from '@/routes/Playlist'
import ArtistPage from '@/routes/ArtistPage'
import Room from '@/routes/Room'
import Heardle from '@/routes/Heardle'
import { EmptyState } from '@/components/ui'

export default function App() {
  return (
    <BrowserRouter>
      <PlaybackHost />
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/library" element={<Library />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/playlist/:playlistId" element={<Playlist />} />
          <Route path="/artist/:artistId" element={<ArtistPage />} />
          <Route path="/room" element={<Room />} />
          <Route path="/heardle" element={<Heardle />} />
          <Route path="*" element={<EmptyState title="Page not found" hint="That route doesn't exist." />} />
        </Routes>
      </Shell>
      <PlayerBar />
    </BrowserRouter>
  )
}
