import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Play, Shuffle } from 'lucide-react'
import type { Track, Collection } from '@/types'
import { source } from '@/services'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { TrackRow } from '@/components/TrackRow'
import { Artwork, Button, Skeleton, ErrorNote, EmptyState } from '@/components/ui'
import { keyOf } from '@/lib/db'

export default function Playlist() {
  const { playlistId = '' } = useParams()
  const [collection, setCollection] = useState<Collection | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const playQueue = usePlayer((s) => s.playQueue)
  const playShuffled = usePlayer((s) => s.playShuffled)
  const { playlists, removeFromPlaylist } = useLibrary()

  // "local:<uuid>" ids resolve from the user's own playlists, not the catalog
  const localId = playlistId.startsWith('local:') ? playlistId.slice(6) : null
  const local = localId ? playlists.find((p) => p.id === localId) : undefined

  useEffect(() => {
    if (localId) {
      setLoading(false)
      return
    }
    // navigating between playlists quickly could let a slow response land
    // after a newer one and render the wrong collection
    let live = true
    setLoading(true)
    setError(null)
    source
      .collection(playlistId)
      .then((r) => {
        if (!live) return
        if (!r) {
          setError('Playlist not found')
          return
        }
        setCollection(r.collection)
        setTracks(r.tracks)
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false))

    return () => {
      live = false
    }
  }, [playlistId, localId])

  const title = local?.name ?? collection?.title ?? ''
  const list = local?.tracks ?? tracks
  const artwork = local?.tracks[0]?.artwork ?? collection?.artwork

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-52 w-full rounded-2xl" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (error) return <ErrorNote message={error} />
  if (localId && !local) return <EmptyState title="Playlist not found" hint="It may have been deleted." />

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <Artwork src={artwork} alt="" className="h-44 w-44 shadow-2xl" rounded="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
            {title}
          </h1>
          {collection?.description && (
            <p className="mt-2 line-clamp-2 max-w-[65ch] text-sm text-ink-400">{collection.description}</p>
          )}
          {/* the tracked-uppercase "PLAYLIST" kicker above the title said
              nothing the page didn't already say; the metadata line does */}
          <p className="mt-2 text-sm text-ink-400">
            {local ? 'Your playlist' : 'Playlist'}
            {collection?.owner && ` · ${collection.owner}`}
            {` · ${list.length} track${list.length === 1 ? '' : 's'}`}
          </p>
          {list.length > 0 && (
            <div className="mt-5 flex gap-2">
              <Button variant="accent" onClick={() => void playQueue(list, 0)}>
                <Play size={15} fill="currentColor" />
                Play
              </Button>
              <Button variant="outline" onClick={() => void playShuffled(list)}>
                <Shuffle size={15} />
                Shuffle
              </Button>
            </div>
          )}
        </div>
      </header>

      {list.length === 0 ? (
        <EmptyState title="This playlist is empty" hint="Add songs from search or the home page." />
      ) : (
        <div className="space-y-0.5">
          {list.map((t, i) => (
            <TrackRow
              key={`${t.source}-${t.id}`}
              track={t}
              index={i}
              queue={list}
              onRemove={local ? () => removeFromPlaylist(local.id, keyOf(t)) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
