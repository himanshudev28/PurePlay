import { Heart, Play, Shuffle } from 'lucide-react'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { TrackRow } from '@/components/TrackRow'
import { EmptyState, Button } from '@/components/ui'

export default function Favorites() {
  const favorites = useLibrary((s) => s.favorites)
  const playQueue = usePlayer((s) => s.playQueue)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)
  const shuffle = usePlayer((s) => s.shuffle)

  const shuffleAll = () => {
    if (!shuffle) toggleShuffle()
    void playQueue(favorites, Math.floor(Math.random() * favorites.length))
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
            <Heart size={26} className="text-accent" fill="currentColor" />
            Favorites
          </h1>
          <p className="mt-1 text-sm text-ink-400">{favorites.length} songs</p>
        </div>
        {favorites.length > 0 && (
          <div className="flex gap-2">
            <Button variant="accent" onClick={() => void playQueue(favorites, 0)}>
              <Play size={15} fill="currentColor" />
              Play
            </Button>
            <Button variant="outline" onClick={shuffleAll}>
              <Shuffle size={15} />
              Shuffle
            </Button>
          </div>
        )}
      </header>

      {favorites.length === 0 ? (
        <EmptyState
          icon={<Heart size={30} />}
          title="No favorites yet"
          hint="Tap the heart on any track to save it here. Favorites are stored on this device."
        />
      ) : (
        <div className="space-y-0.5">
          {favorites.map((t, i) => (
            <TrackRow key={`${t.source}-${t.id}`} track={t} index={i} queue={favorites} />
          ))}
        </div>
      )}
    </div>
  )
}
