import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Play, Shuffle, Search as SearchIcon } from 'lucide-react'
import type { Track, Artist } from '@/types'
import { source } from '@/services'
import { usePlayer } from '@/store/player'
import { TrackRow } from '@/components/TrackRow'
import { Artwork, Button, Skeleton, ErrorNote, EmptyState } from '@/components/ui'
import { formatCount } from '@/lib/format'

/**
 * Everything needed to render the page, from whichever lookup managed to
 * answer. `viaSearch` records that the tracks came from a name search rather
 * than the artist's own catalog entry, so the page can say so instead of
 * quietly presenting search results as an official discography.
 */
interface Loaded {
  artist: Artist
  tracks: Track[]
  viaSearch: boolean
}

export default function ArtistPage() {
  const { artistId = '' } = useParams()
  const [params] = useSearchParams()
  // Passed by ArtistCard. The only thing that still identifies the artist when
  // the id lookup fails, which is exactly when the page used to come up blank.
  const hintedName = params.get('name')?.trim() || ''

  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const playQueue = usePlayer((s) => s.playQueue)
  const playShuffled = usePlayer((s) => s.playShuffled)

  useEffect(() => {
    // guard against a slow response for a previous artist landing last
    let live = true
    setLoading(true)
    setError(null)

    const byName = async (): Promise<Loaded | null> => {
      if (!hintedName) return null
      const tracks = source.searchTracks
        ? await source.searchTracks(hintedName, 40)
        : (await source.search(hintedName)).tracks
      if (!tracks.length) return null
      return {
        // A synthetic entry: enough to head the page, borrowing the artwork of
        // the artist's own top result for the avatar.
        artist: {
          id: artistId,
          name: hintedName,
          avatar: tracks[0]?.artwork,
          source: tracks[0]?.source ?? source.id,
        },
        tracks,
        viaSearch: true,
      }
    }

    void (async () => {
      try {
        const r = artistId ? await source.artist(artistId).catch(() => null) : null
        // An artist entry with no songs is as useless as no entry at all — keep
        // the real profile but fill the track list from the name search.
        if (r?.artist && r.tracks.length) {
          if (live) setData({ ...r, viaSearch: false })
        } else {
          const fallback = await byName()
          if (!live) return
          if (fallback) {
            setData(r?.artist ? { ...fallback, artist: r.artist } : fallback)
          } else if (r?.artist) {
            setData({ artist: r.artist, tracks: [], viaSearch: false })
          } else {
            setError('We couldn’t load this artist from the catalog.')
          }
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load this artist')
      } finally {
        if (live) setLoading(false)
      }
    })()

    return () => {
      live = false
    }
  }, [artistId, hintedName, attempt])

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

  if (!data) {
    return (
      <div className="space-y-4">
        <ErrorNote
          message={error ?? 'Artist not found'}
          onRetry={() => setAttempt((n) => n + 1)}
        />
        {hintedName && (
          <EmptyState
            title={hintedName}
            hint="The catalog didn't return a page for this artist. Searching by name usually finds their songs."
            action={
              <Link to={`/search?q=${encodeURIComponent(hintedName)}`}>
                <Button variant="accent" size="sm">
                  <SearchIcon size={14} />
                  Search for {hintedName}
                </Button>
              </Link>
            }
          />
        )}
      </div>
    )
  }

  const { artist, tracks, viaSearch } = data

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:text-left">
        <Artwork src={artist.avatar} alt="" className="h-32 w-32 shadow-2xl sm:h-40 sm:w-40" rounded="rounded-full" />
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

      {viaSearch && (
        <p className="text-xs text-ink-400">
          The catalog didn&rsquo;t return an official page for {artist.name} — these are their songs
          as found by search.
        </p>
      )}

      {tracks.length === 0 ? (
        <EmptyState
          title="No tracks listed"
          hint={`${artist.name} is in the catalog, but the source didn't return any songs for them.`}
          action={
            <Link to={`/search?q=${encodeURIComponent(artist.name)}`}>
              <Button variant="outline" size="sm">
                <SearchIcon size={14} />
                Search instead
              </Button>
            </Link>
          }
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
