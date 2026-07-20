import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ListMusic, Plus, Trash2, Play } from 'lucide-react'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { TrackRow } from '@/components/TrackRow'
import { SectionHeader, EmptyState, Button, Artwork } from '@/components/ui'

export default function Library() {
  const { playlists, recent, createPlaylist, deletePlaylist } = useLibrary()
  const playQueue = usePlayer((s) => s.playQueue)
  const [newName, setNewName] = useState('')

  const create = () => {
    const name = newName.trim()
    if (!name) return
    createPlaylist(name)
    setNewName('')
  }

  return (
    <div className="space-y-10">
      <section>
        <SectionHeader title="Your playlists" />
        <div className="mb-5 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="New playlist name"
            className="flex-1 rounded-full border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
          <Button variant="accent" onClick={create} disabled={!newName.trim()}>
            <Plus size={15} />
            Create
          </Button>
        </div>

        {playlists.length === 0 ? (
          <EmptyState
            icon={<ListMusic size={30} />}
            title="No playlists yet"
            hint="Create one above, then add songs from the ⋯ menu on any track."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {playlists.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3 transition hover:border-ink-700"
              >
                <Artwork src={p.tracks[0]?.artwork} alt={p.name} className="h-14 w-14" rounded="rounded-lg" />
                <Link to={`/playlist/local:${p.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{p.name}</p>
                  <p className="text-xs text-ink-400">{p.tracks.length} tracks</p>
                </Link>
                <button
                  onClick={() => p.tracks.length && void playQueue(p.tracks, 0)}
                  disabled={!p.tracks.length}
                  className="rounded-full p-2 text-ink-300 hover:bg-ink-800 hover:text-white disabled:opacity-30"
                  title="Play"
                >
                  <Play size={15} fill="currentColor" />
                </button>
                <button
                  onClick={() => deletePlaylist(p.id)}
                  className="rounded-full p-2 text-ink-400 opacity-0 transition hover:bg-ink-800 hover:text-white group-hover:opacity-100"
                  title="Delete playlist"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title="Recently played"
          action={
            recent.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => void playQueue(recent, 0)}>
                Play all
              </Button>
            ) : undefined
          }
        />
        {recent.length === 0 ? (
          <EmptyState title="Nothing played yet" hint="Tracks you listen to will show up here." />
        ) : (
          <div className="space-y-0.5">
            {recent.map((t, i) => (
              <TrackRow key={`${t.source}-${t.id}`} track={t} index={i} queue={recent} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
