import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon, Loader2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { SearchResults } from '@/types'
import { source } from '@/services'
import { TrackRow } from '@/components/TrackRow'
import { ArtistCard, CollectionCard } from '@/components/Cards'
import { SectionHeader, EmptyState, ErrorNote } from '@/components/ui'

const EMPTY: SearchResults = { tracks: [], artists: [], collections: [] }

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
  const empty =
    !loading &&
    !error &&
    query.trim() &&
    !results.tracks.length &&
    !results.artists.length &&
    !results.collections.length

  return (
    <div className="space-y-8">
      <div className="relative">
        <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Songs, artists, playlists…"
          className="w-full rounded-full border border-ink-700 bg-ink-900 py-3.5 pr-12 pl-12 text-base text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
        />
        {loading && (
          <Loader2 size={17} className="absolute top-1/2 right-4 -translate-y-1/2 animate-spin text-accent" />
        )}
      </div>

      {error && <ErrorNote message={error} />}

      {!query.trim() && (
        <EmptyState
          icon={<SearchIcon size={32} />}
          title="Search the catalog"
          hint={`Currently searching ${source.name}. Results stream in as you type.`}
        />
      )}

      {empty && <EmptyState title="No results" hint={`Nothing matched “${query}”. Try a different spelling.`} />}

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
