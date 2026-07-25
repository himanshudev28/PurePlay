import { source } from '@/services'
import type { Track, Collection } from '@/types'
import { keyOf } from '@/lib/db'
import { useLibrary } from '@/store/library'

/** Lead artist only: "A, B & C" and "A feat. B" both collapse to "A". */
function leadArtist(artist: string): string {
  return artist.split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0].trim()
}

/**
 * The same recording is often indexed under several ids across sources and
 * compilations, so `keyOf` (source:id) misses obvious duplicates. Fold to
 * title + lead artist for cross-query dedupe instead.
 */
export function identityOf(t: Track): string {
  return `${t.title.trim().toLowerCase()}::${leadArtist(t.artist).toLowerCase()}`
}

/**
 * Pull a page of songs for one query.
 *
 * Prefers the adapter's songs-only endpoint. The combined `search()` caps each
 * section at a handful of results on JioSaavn — three, in practice — which is
 * why the radio queue used to stall at five tracks and immediately report
 * itself exhausted.
 */
async function songsFor(query: string, limit: number): Promise<Track[]> {
  if (source.searchTracks) return source.searchTracks(query, limit)
  const results = await source.search(query)
  return results.tracks
}

/**
 * The listener's taste, distilled to a ranked list of artists: whoever recurs
 * most across favorites and recently played, favorites weighted heavier. This
 * is the only taste signal available without a backend, and it's what makes the
 * radio feel personal instead of just "more of this one artist".
 */
function tasteArtists(exclude = '', max = 3): string[] {
  const { favorites, recent } = useLibrary.getState()
  const score = new Map<string, number>()
  const add = (list: Track[], weight: number) => {
    for (const t of list) {
      const a = leadArtist(t.artist)
      if (a) score.set(a, (score.get(a) ?? 0) + weight)
    }
  }
  add(favorites, 2)
  add(recent, 1)

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([a]) => a)
    .filter((a) => a.toLowerCase() !== exclude.toLowerCase())
    .slice(0, max)
}

/** Round-robin merge so the result rotates across sources instead of running
 *  one artist's whole discography before reaching the next. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  const max = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i])
    }
  }
  return out
}

/**
 * Builds the "radio" tail appended after a seed track.
 *
 * Blends two signals: what's *related* to the seed (its artist and title) and
 * what matches the listener's *taste* (their most-played artists). The lists are
 * interleaved so the queue rotates between them for variety rather than stacking
 * one artist end to end.
 */
export async function getMatchingRecommendations(track: Track, limit = 20): Promise<Track[]> {
  const artist = leadArtist(track.artist)
  // Seed-related queries first, then a couple of taste artists (never the seed
  // artist again — that variety is the whole point).
  const taste = tasteArtists(artist, 2)
  const queries = [artist, artist ? `${artist} songs` : '', track.title, ...taste].filter(Boolean)
  const unique = [...new Set(queries)]
  if (!unique.length) return []

  // Over-fetch per query — most of what returns is already queued.
  const settled = await Promise.allSettled(unique.map((q) => songsFor(q, limit)))
  const lists = settled.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []))

  // Every query failing means the catalog is unreachable, not that this seed
  // is exhausted. Throw so the caller retries later instead of writing the
  // seed off permanently.
  if (!lists.length && unique.length) {
    throw new Error('Recommendations are unavailable right now')
  }

  const out: Track[] = []
  const seen = new Set<string>([keyOf(track), identityOf(track)])
  for (const t of interleave(lists)) {
    if (out.length >= limit) break
    const k = keyOf(t)
    const id = identityOf(t)
    if (seen.has(k) || seen.has(id)) continue
    seen.add(k)
    seen.add(id)
    out.push(t)
  }
  return out
}

/**
 * Songs *and* collections to suggest alongside the queue, driven by taste when
 * we have it and falling back to the catalog's own trending/featured picks for
 * a brand-new listener with nothing to learn from yet.
 */
export async function getSuggestions(
  limit = 6,
): Promise<{ tracks: Track[]; collections: Collection[] }> {
  const taste = tasteArtists('', 3)

  if (!taste.length) {
    const [tracks, collections] = await Promise.all([
      source.trending(limit).catch(() => [] as Track[]),
      source.featuredCollections(limit).catch(() => [] as Collection[]),
    ])
    return { tracks: tracks.slice(0, limit), collections: collections.slice(0, limit) }
  }

  // Songs from the top taste artist; collections searched under the next one so
  // the two rows don't mirror each other.
  const collSeed = taste[1] ?? taste[0]
  const [tracks, search] = await Promise.all([
    songsFor(taste[0], limit * 2).catch(() => [] as Track[]),
    source.search(collSeed).catch(() => null),
  ])

  return {
    tracks: tracks.slice(0, limit),
    collections: (search?.collections ?? []).slice(0, limit),
  }
}
