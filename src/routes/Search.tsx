import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon, Loader2, TrendingUp, Music, Mic2, Headphones, Guitar } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { SearchResults } from '@/types'
import { source } from '@/services'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // debounced search; an in-flight request is aborted when the query changes
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(EMPTY)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      source
        .search(q, controller.signal)
        .then((r) => {
          setResults(r)
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
  const total = results.tracks.length + results.artists.length + results.collections.length
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
    </div>
  )
}
