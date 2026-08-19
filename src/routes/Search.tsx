import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search as SearchIcon, Loader2, TrendingUp, Music, Mic2, Headphones, Guitar, Sparkles,
  PartyPopper, HeartCrack, Dumbbell,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { SearchResults, Track } from '@/types'
import { source } from '@/services'
import { ytmusic } from '@/services/ytmusic'
import { TrackRow } from '@/components/TrackRow'
import { ArtistCard, CollectionCard } from '@/components/Cards'
import { SectionHeader, EmptyState, ErrorNote, Button } from '@/components/ui'
import { rankByQuery } from '@/lib/match'
import { detectMood } from '@/lib/mood'
import { searchMoodTracks, searchMoodCollections } from '@/services/moodSearch'
import { identityOf } from '@/services/recommendations'

const EMPTY: SearchResults = { tracks: [], artists: [], collections: [] }

/** How many songs each page of results asks for. */
const PAGE_SIZE = 40

/** Per seed query of a mood — four seeds, so a page is ~80 before deduping. */
const MOOD_PER_QUERY = 20

/**
 * Fold out the same recording appearing twice.
 *
 * Catalogs list a song once per album, compilation and re-release it appeared
 * on, so a search for a popular track can spend its first ten rows on ten
 * copies of it — which is what made everything else look missing.
 */
function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>()
  return tracks.filter((t) => {
    const id = identityOf(t)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Quick-search chips shown when the search bar is empty. The mood ones
 *  double as a hint that the box takes feelings, not just titles. */
const QUICK_SEARCHES = [
  { label: 'Bollywood Hits', icon: Music, query: 'Bollywood Hits' },
  { label: 'Arijit Singh', icon: Mic2, query: 'Arijit Singh' },
  { label: 'Punjabi', icon: Guitar, query: 'Punjabi Hits' },
  { label: 'Party', icon: PartyPopper, query: 'party songs' },
  { label: 'Breakup', icon: HeartCrack, query: 'breakup songs' },
  { label: 'Workout', icon: Dumbbell, query: 'workout songs' },
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
  const [moreLoading, setMoreLoading] = useState(false)
  /** true once a page comes back short, meaning there is nothing after it */
  const [exhausted, setExhausted] = useState(false)
  const page = useRef(0)
  const [error, setError] = useState<string | null>(null)
  /** The listener overruling what we guessed the query meant. */
  const [override, setOverride] = useState<'mood' | 'literal' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /*
    "breakup song" and "party songs" describe a feeling, not a title, and the
    catalog answers them literally — eight rows of unrelated recordings that
    happen to be *called* "Breakup Song". When the whole query reads as a mood,
    ask the catalog several better questions instead (see detectMood), and say
    on the page that we did, with one click back to the literal search.

    A bare "party" or "ishq" is only *offered* the mood, never switched: those
    are real song titles, and quietly refusing to search for one would be the
    same bug pointing the other way.
  */
  const detected = useMemo(() => detectMood(query), [query])
  const mood =
    detected && (override === 'mood' || (detected.explicit && override !== 'literal'))
      ? detected.mood
      : null

  // A new query is a new question — never inherit the previous one's answer.
  useEffect(() => setOverride(null), [query])

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
    setExhausted(false)
    page.current = 0

    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      // YouTube Music runs alongside (never rejects) for its larger catalog —
      // its results play through the iframe engine, JioSaavn's in the background.
      // A mood asks it the expanded question too, or it answers with the same
      // literal titles the catalog just did.
      ytmusic.searchTracks(mood ? mood.songQueries[0] : q, controller.signal).then((yt) => {
        if (!controller.signal.aborted) setYtTracks(yt)
      })

      const run = mood
        ? // Songs *and* curated sets for the mood. Artists are meaningless here:
          // "party" matches a band called Party, not music that feels like one.
          Promise.all([
            searchMoodTracks(mood, 0, MOOD_PER_QUERY, controller.signal),
            searchMoodCollections(mood, 8, controller.signal).catch(() => []),
          ]).then(([tracks, collections]) => {
            setResults({ tracks, artists: [], collections })
            if (tracks.length < mood.songQueries.length * MOOD_PER_QUERY * 0.5) setExhausted(true)
          })
        : // The combined /search endpoint returns only ~3 songs; /search/songs
          // (searchTracks) honours a real limit. Pull the full song list from
          // there and keep artists + playlists from the combined search.
          Promise.all([
            source.search(q, controller.signal),
            source.searchTracks
              ? source.searchTracks(q, PAGE_SIZE, controller.signal, 0).catch(() => null)
              : Promise.resolve(null),
          ]).then(([r, fullTracks]) => {
            const songs = fullTracks && fullTracks.length ? fullTracks : r.tracks
            setResults({ ...r, tracks: songs })
            if (!fullTracks || fullTracks.length < PAGE_SIZE) setExhausted(true)
          })

      run
        .then(() => setError(null))
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
  }, [query, mood])

  const loadMore = () => {
    const q = query.trim()
    if (!q || moreLoading || exhausted) return
    const next = page.current + 1
    // A mood widens every one of its seed queries together, so "show more"
    // keeps the same spread rather than dropping into one seed's long tail.
    const more = mood
      ? searchMoodTracks(mood, next, MOOD_PER_QUERY)
      : source.searchTracks?.(q, PAGE_SIZE, undefined, next)
    if (!more) return
    setMoreLoading(true)
    const floor = mood ? mood.songQueries.length * MOOD_PER_QUERY * 0.5 : PAGE_SIZE
    more
      .then((batch) => {
        page.current = next
        if (batch.length < floor) setExhausted(true)
        setResults((prev) => ({ ...prev, tracks: [...prev.tracks, ...batch] }))
      })
      .catch(() => setExhausted(true)) // a failed page is the end of the road
      .finally(() => setMoreLoading(false))
  }

  /*
    Rank what came back against what was actually typed.

    Catalog relevance is tuned for its own homepage, not for this query: a
    search for a song title routinely returned remixes, covers and album
    versions above the recording itself. Scoring here — exact title, then all
    query words present, then word overlap, with the catalog's own order as the
    tie-break — puts the obvious answer first without discarding its ordering
    where we have nothing better to say.
  */
  const songs = useMemo(
    // A mood's results are already ordered by the fan-out (see searchMoodTracks);
    // scoring them against "breakup song" would just re-float the literal titles
    // this whole path exists to get away from.
    () => (mood ? dedupe(results.tracks) : rankByQuery(query, dedupe(results.tracks))),
    [query, mood, results.tracks],
  )

  // Anything YouTube found that the main catalog already has is noise: it would
  // play the same recording through a worse engine.
  const ytExtra = useMemo(() => {
    const known = new Set(songs.map(identityOf))
    const found = mood ? dedupe(ytTracks) : rankByQuery(query, dedupe(ytTracks))
    return found.filter((t) => !known.has(identityOf(t)))
  }, [query, mood, ytTracks, songs])

  // keep ?q= in sync so searches are shareable / survive reload
  useEffect(() => {
    const t = setTimeout(() => {
      setParams(query.trim() ? { q: query.trim() } : {}, { replace: true })
    }, 500)
    return () => clearTimeout(t)
  }, [query, setParams])

  // an error already explains itself — "No results" alongside it reads as if the
  // search succeeded and simply found nothing
  const total = songs.length + results.artists.length + results.collections.length + ytExtra.length
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

      {/*
        Never substitute silently: the listener typed words, and something else
        is on screen. Say which mood, and leave the literal search one click
        away for the person who really was looking for a song called "Breakup
        Song".
      */}
      {mood && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-ink-200">
          <Sparkles size={15} className="text-accent" aria-hidden />
          <span>
            Showing <span className="font-semibold text-white">{mood.label}</span> — music that fits
            the mood, not songs titled “{query.trim()}”.
          </span>
          <button
            onClick={() => setOverride('literal')}
            className="rounded-full border border-white/20 px-2.5 py-1 text-xs font-medium text-ink-200 transition hover:border-white/50 hover:text-white"
          >
            Search the exact words
          </button>
        </div>
      )}

      {/* The other direction: exact results are showing, and a mood reading of
          the query exists — either because it was declined, or because a bare
          "party" was too ambiguous to switch on its own. */}
      {detected && !mood && (
        <p className="text-sm text-ink-400">
          Looking for a feeling rather than a title?{' '}
          <button
            onClick={() => setOverride('mood')}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Show {detected.mood.label.toLowerCase()} music
          </button>
        </p>
      )}

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

      {empty && (
        <EmptyState
          title="No results"
          hint={
            mood
              ? `The catalog had nothing for ${mood.label.toLowerCase()} right now — try again in a moment.`
              : `Nothing matched "${query}". Try a different spelling.`
          }
        />
      )}

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
          <SectionHeader title={mood ? `${mood.label} playlists` : 'Playlists'} />
          <div className="shelf">
            {results.collections.map((c) => (
              <CollectionCard key={`${c.source}-${c.id}`} collection={c} />
            ))}
          </div>
        </section>
      )}

      {songs.length > 0 && (
        <section>
          <SectionHeader title={mood ? `${mood.label} songs` : 'Songs'} />
          <div className="space-y-0.5">
            {songs.map((t, i) => (
              <TrackRow key={`${t.source}-${t.id}`} track={t} index={i} queue={songs} />
            ))}
          </div>
          {!exhausted && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={loadMore} loading={moreLoading}>
                {moreLoading ? 'Loading…' : 'Show more songs'}
              </Button>
            </div>
          )}
        </section>
      )}

      {ytExtra.length > 0 && (
        <section>
          <SectionHeader title="From YouTube Music" />
          <p className="mb-3 -mt-3 text-xs text-ink-400">
            A wider catalog. These play as normal audio whenever the same recording exists in{' '}
            {source.name} — otherwise they play in the video panel, which mobile browsers pause when
            you leave the app.
          </p>
          <div className="space-y-0.5">
            {ytExtra.map((t, i) => (
              <TrackRow key={`yt-${t.id}`} track={t} index={i} queue={ytExtra} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
