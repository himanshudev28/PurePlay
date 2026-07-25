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
      {/* the page had no h1 at all — screen-reader users landed on two h2s
          with nothing naming the page itself */}
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">Library</h1>

      <section>
        <SectionHeader title="Your playlists" />
        <div className="mb-5 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="New playlist name"
            // min-w-0 so the input can shrink below its placeholder's
            // min-content width instead of pushing Create off a 320px screen
            className="min-w-0 flex-1 rounded-full border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
          <Button variant="accent" onClick={create} disabled={!newName.trim()} className="shrink-0">
            <Plus size={15} />
            Create
          </Button>
        </div>

        {playlists.length === 0 ? (
          <EmptyState
            icon={<ListMusic size={30} />}
            title="No playlists yet"
            // the old hint pointed at a "⋯ menu" that never existed — that
            // button enqueued the track directly and never touched playlists
            hint="Name one above and hit Create. You can open it from here once it exists."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {playlists.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3 transition hover:border-ink-700"
              >
                <Artwork src={p.tracks[0]?.artwork} alt="" className="h-14 w-14" rounded="rounded-lg" />
                {/* the whole block is the link target, so clicking the cover
                    works too — previously only the two lines of text did */}
                <Link to={`/playlist/local:${p.id}`} className="min-w-0 flex-1 rounded-lg">
                  <p className="truncate font-medium text-white">{p.name}</p>
                  <p className="text-xs text-ink-400">
                    {p.tracks.length} track{p.tracks.length === 1 ? '' : 's'}
                  </p>
                </Link>
                <button
                  onClick={() => p.tracks.length && void playQueue(p.tracks, 0)}
                  disabled={!p.tracks.length}
                  className="rounded-full p-2 text-ink-300 hover:bg-ink-800 hover:text-white disabled:opacity-30"
                  title={p.tracks.length ? `Play ${p.name}` : 'This playlist is empty'}
                  aria-label={`Play ${p.name}`}
                >
                  <Play size={15} fill="currentColor" />
                </button>
                <button
                  // deleting was immediate and unrecoverable — playlists live
                  // only in this browser, so there is nothing to restore from
                  onClick={() => {
                    if (window.confirm(`Delete the playlist “${p.name}”? This can’t be undone.`)) {
                      deletePlaylist(p.id)
                    }
                  }}
                  className="rounded-full p-2 text-ink-400 opacity-0 transition hover:bg-ink-800 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
                  title="Delete playlist"
                  aria-label={`Delete playlist ${p.name}`}
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
