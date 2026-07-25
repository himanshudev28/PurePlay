import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon, Loader2, TrendingUp, Music, Mic2, Headphones, Guitar } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { SearchResults, Track } from '@/types'
import { source } from '@/services'
import { ytmusic } from '@/services/ytmusic'
import { TrackRow } from '@/components/TrackRow'
import { ArtistCard, CollectionCard } from '@/components/Cards'
import { SectionHeader, EmptyState, ErrorNote } from '@/components/ui'

const EMPTY: SearchResults = { tracks: [], artists: [], collections: [] }

/** Quick-search chips shown when the search bar is empty. */
const QUICK_SEARCHES = [
  { label: 'Bollywood Hits', icon: Music, query: 'Bollywood Hits' },
  { label: 'Arijit Singh', icon: Mic2, query: 'Arijit Singh' },
  { label: 'Punjabi', icon: Guitar, query: 'Punjabi Hits' },
  { label: 'Romance', icon: TrendingUp, query: 'Hindi Romance' },
  { label: 'Trending', icon: TrendingUp, query: 'Trending' },
  { label: 'Lo-Fi', icon: Headphones, query: 'Hindi Lofi' },
  { label: 'Telugu', icon: Music, query: 'Telugu Hits' },
  { label: 'Pop', icon: Music, query: 'Pop Hits' },
]

export default function Search() {
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [ytTracks, setYtTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Don't pop the mobile keyboard when arriving via a shared ?q= link —
    // the visitor wants to read results, not retype the query.
    if (!initial) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Back/forward changes ?q= without going through the input — resync it, or
  // the visible query and the visible results disagree after a back navigation.
  useEffect(() => {
    setQuery((prev) => (prev.trim() === initial.trim() ? prev : initial))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  // debounced search; an in-flight request is aborted when the query changes
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(EMPTY)
      setYtTracks([])
      setLoading(false)
      setError(null)
      return
    }

    // Clear the previous query's results and error up front — otherwise stale
    // rows sit under the new query for the debounce+network window, and a
    // stale error banner outlives the search that caused it.
    setResults(EMPTY)
    setYtTracks([])
    setError(null)

    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      // The combined /search endpoint returns only ~3 songs; /search/songs
      // (searchTracks) honours a real limit. Pull the full song list from there
      // and keep artists + playlists from the combined search.
      const tracksP = source.searchTracks
        ? source.searchTracks(q, 40, controller.signal).catch(() => null)
        : Promise.resolve(null)

      // YouTube Music runs alongside (never rejects) for its larger catalog —
      // its results play through the iframe engine, JioSaavn's in the background.
      ytmusic.searchTracks(q, controller.signal).then((yt) => {
        if (!controller.signal.aborted) setYtTracks(yt)
      })

      Promise.all([source.search(q, controller.signal), tracksP])
        .then(([r, fullTracks]) => {
          setResults({ ...r, tracks: fullTracks && fullTracks.length ? fullTracks : r.tracks })
          setError(null)
        })
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setError(e.message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // keep ?q= in sync so searches are shareable / survive reload
  useEffect(() => {
    const t = setTimeout(() => {
      setParams(query.trim() ? { q: query.trim() } : {}, { replace: true })
    }, 500)
    return () => clearTimeout(t)
  }, [query, setParams])

  // an error already explains itself — "No results" alongside it reads as if the
  // search succeeded and simply found nothing
  const total =
    results.tracks.length + results.artists.length + results.collections.length + ytTracks.length
  const empty = !loading && !error && query.trim().length > 0 && total === 0

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Search</h1>

      {/* search input */}
      <div className="relative">
        <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Songs, artists, playlists…"
          className="w-full rounded-full border border-ink-700 bg-ink-900 py-3.5 pr-12 pl-12 text-base text-white placeholder:text-ink-400 focus:border-accent focus:outline-none transition-colors"
        />
        {loading && (
          <Loader2
            size={17}
            aria-hidden
            className="absolute top-1/2 right-4 -translate-y-1/2 animate-spin text-accent"
          />
        )}
      </div>

      {/* Results arrive without any page change, so screen readers get nothing
          unless the count is announced explicitly. */}
      <p role="status" aria-live="polite" className="sr-only">
        {loading ? 'Searching…' : query.trim() ? `${total} result${total === 1 ? '' : 's'} for ${query.trim()}` : ''}
      </p>

      {error && <ErrorNote message={error} />}

      {/* quick-search chips when empty */}
      {!query.trim() && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {QUICK_SEARCHES.map(({ label, icon: Icon, query: q }) => (
              <button
                key={label}
                onClick={() => setQuery(q)}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/60 px-3.5 py-2 text-xs font-medium text-ink-200 transition hover:border-accent/50 hover:bg-accent/10 hover:text-white active:scale-95"
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
          <EmptyState
            icon={<SearchIcon size={32} />}
            title="Search the catalog"
            hint={`Currently searching ${source.name}. Results stream in as you type.`}
          />
        </div>
      )}

      {empty && <EmptyState title="No results" hint={`Nothing matched "${query}". Try a different spelling.`} />}

      {results.artists.length > 0 && (
        <section>
          <SectionHeader title="Artists" />
          <div className="shelf">
            {results.artists.map((a) => (
              <ArtistCard key={`${a.source}-${a.id}`} artist={a} />
            ))}
          </div>
        </section>
      )}

      {results.collections.length > 0 && (
        <section>
          <SectionHeader title="Playlists" />
          <div className="shelf">
            {results.collections.map((c) => (
              <CollectionCard key={`${c.source}-${c.id}`} collection={c} />
            ))}
          </div>
        </section>
      )}

      {results.tracks.length > 0 && (
        <section>
          <SectionHeader title="Songs" />
          <div className="space-y-0.5">
            {results.tracks.map((t, i) => (
              <TrackRow key={`${t.source}-${t.id}`} track={t} index={i} queue={results.tracks} />
            ))}
          </div>
        </section>
      )}

      {ytTracks.length > 0 && (
        <section>
          <SectionHeader title="From YouTube Music" />
          <p className="mb-3 -mt-3 text-xs text-ink-400">
            A wider catalog — these play in the video player (not in the background).
          </p>
          <div className="space-y-0.5">
            {ytTracks.map((t, i) => (
              <TrackRow key={`yt-${t.id}`} track={t} index={i} queue={ytTracks} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
