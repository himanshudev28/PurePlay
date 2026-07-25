import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Play, Shuffle } from 'lucide-react'
import type { Track, Artist } from '@/types'
import { source } from '@/services'
import { usePlayer } from '@/store/player'
import { TrackRow } from '@/components/TrackRow'
import { Artwork, Button, Skeleton, ErrorNote, EmptyState } from '@/components/ui'
import { formatCount } from '@/lib/format'

export default function ArtistPage() {
  const { artistId = '' } = useParams()
  const [artist, setArtist] = useState<Artist | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const playQueue = usePlayer((s) => s.playQueue)
  const playShuffled = usePlayer((s) => s.playShuffled)

  useEffect(() => {
    // guard against a slow response for a previous artist landing last
    let live = true
    setLoading(true)
    setError(null)
    source
      .artist(artistId)
      .then((r) => {
        if (!live) return
        if (!r) {
          setError('Artist not found')
          return
        }
        setArtist(r.artist)
        setTracks(r.tracks)
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false))

    return () => {
      live = false
    }
  }, [artistId])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-44 w-full rounded-2xl" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (error || !artist) return <ErrorNote message={error ?? 'Artist not found'} />

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:text-left">
        <Artwork src={artist.avatar} alt="" className="h-40 w-40 shadow-2xl" rounded="rounded-full" />
        <div className="min-w-0 flex-1">
          {/* sm:text-5xl here vs sm:text-4xl on the playlist page was the same
              heading role rendering at two different sizes */}
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
            {artist.name}
          </h1>
          <p className="mt-2 text-sm text-ink-400">
            Artist
            {artist.followers ? ` · ${formatCount(artist.followers)} followers` : ''}
            {` · ${tracks.length} track${tracks.length === 1 ? '' : 's'}`}
          </p>
          {artist.bio && <p className="mt-2 line-clamp-3 max-w-[65ch] text-sm text-ink-400">{artist.bio}</p>}
          {tracks.length > 0 && (
            <div className="mt-5 flex justify-center gap-2 sm:justify-start">
              <Button variant="accent" onClick={() => void playQueue(tracks, 0)}>
                <Play size={15} fill="currentColor" />
                Play
              </Button>
              <Button variant="outline" onClick={() => void playShuffled(tracks)}>
                <Shuffle size={15} />
                Shuffle
              </Button>
            </div>
          )}
        </div>
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          title="No tracks listed"
          hint={`${artist.name} is in the catalog, but the source didn't return any songs for them.`}
        />
      ) : (
        <div className="space-y-0.5">
          {tracks.map((t, i) => (
            <TrackRow key={`${t.source}-${t.id}`} track={t} index={i} queue={tracks} />
          ))}
        </div>
      )}
    </div>
  )
}
