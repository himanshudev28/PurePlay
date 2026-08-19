import { source } from '@/services'
import type { Track, Collection } from '@/types'
import { keyOf } from '@/lib/db'
import { useLibrary } from '@/store/library'
import { seededShuffle } from '@/lib/daily'
import { leadArtist, creditedArtists, normalizeTitle } from '@/lib/match'

// Title/artist folding lives in @/lib/match so search ranking and the
// YouTube→audio matcher judge "same song" by exactly the same rules.
export { normalizeTitle } from '@/lib/match'

/** Every edition of one song, regardless of who is credited on this pressing. */
export function titleKeyOf(t: Track): string {
  return normalizeTitle(t.title)
}

/**
 * The same recording is often indexed under several ids across sources and
 * compilations, so `keyOf` (source:id) misses obvious duplicates. Fold to
 * normalized title + lead artist for cross-query dedupe instead.
 */
export function identityOf(t: Track): string {
  return `${normalizeTitle(t.title)}::${leadArtist(t.artist).toLowerCase()}`
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
export function tasteArtists(exclude = '', max = 3): string[] {
  const { favorites, recent } = useLibrary.getState()
  const score = new Map<string, number>()
  const add = (list: Track[], weight: number) => {
    for (const t of list) {
      const a = leadArtist(t.artist)
      if (a) score.set(a, (score.get(a) ?? 0) + weight)
    }
  }
  add(favorites, 2)
  // Recency matters: the last thing played says more about the next song than
  // something from forty plays ago, so the weight decays down the list.
  recent.forEach((t, i) => add([t], Math.max(1, 3 - i / 8)))

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([a]) => a)
    .filter((a) => a.toLowerCase() !== exclude.toLowerCase())
    .slice(0, max)
}

/**
 * Merge candidates into a queue tail that is *related* and *varied*.
 *
 * Sorting purely by relevance stacks one artist's discography end to end;
 * shuffling throws the relevance away. So: score everything, then deal the
 * high scorers out round-robin by artist, with a per-artist cap. The tail stays
 * on-taste while still moving between artists every couple of tracks.
 */
function rankAndSpread(
  candidates: Track[],
  scoreOf: (t: Track) => number,
  limit: number,
  perArtist = 3,
): Track[] {
  const byArtist = new Map<string, Track[]>()
  for (const t of [...candidates].sort((a, b) => scoreOf(b) - scoreOf(a))) {
    const a = leadArtist(t.artist).toLowerCase() || 'unknown'
    const bucket = byArtist.get(a) ?? []
    if (bucket.length < perArtist) bucket.push(t)
    byArtist.set(a, bucket)
  }

  // Buckets ordered by their best track, so the most relevant artist leads.
  const buckets = [...byArtist.values()].sort((a, b) => scoreOf(b[0]) - scoreOf(a[0]))
  const out: Track[] = []
  for (let round = 0; out.length < limit; round++) {
    let placed = false
    for (const bucket of buckets) {
      if (round >= bucket.length) continue
      out.push(bucket[round])
      placed = true
      if (out.length >= limit) break
    }
    if (!placed) break
  }
  return out
}

/**
 * Builds the "radio" tail appended after a seed track.
 *
 * The queries are all *artist* queries — the seed's lead artist, whoever they
 * collaborated with on this track, and the listener's own top artists. The seed
 * TITLE is deliberately not among them: searching a title returns that song's
 * covers, lofi flips and remixes, which is what filled the queue with five
 * near-identical entries under one name.
 */
export async function getMatchingRecommendations(track: Track, limit = 20): Promise<Track[]> {
  const lead = leadArtist(track.artist)
  const credited = creditedArtists(track.artist)
  const taste = tasteArtists(lead, 3)

  const queries = [...new Set([lead, ...credited.slice(1, 3), ...taste].filter(Boolean))]
  if (!queries.length) return []

  // Over-fetch per query — most of what returns is already queued.
  const settled = await Promise.allSettled(queries.map((q) => songsFor(q, limit)))
  const lists = settled.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []))

  // Every query failing means the catalog is unreachable, not that this seed
  // is exhausted. Throw so the caller retries later instead of writing the
  // seed off permanently.
  if (!lists.length) {
    throw new Error('Recommendations are unavailable right now')
  }

  const tasteRank = new Map(taste.map((a, i) => [a.toLowerCase(), taste.length - i]))
  const seedCredits = new Set(credited)
  const scoreOf = (t: Track): number => {
    const artists = creditedArtists(t.artist)
    let score = 0
    if (artists[0] === lead.toLowerCase()) score += 4
    if (artists.some((a) => seedCredits.has(a))) score += 3
    score += (tasteRank.get(artists[0] ?? '') ?? 0) * 1.5
    // A light popularity nudge — enough to prefer the well-known cut of an
    // artist's catalog, not enough to override relatedness.
    if (t.playCount) score += Math.min(2, Math.log10(t.playCount) / 4)
    return score
  }

  // One entry per song, keyed by edition-folded title: the first (highest
  // ranked once sorted) wins, and every remix/cover of it is dropped.
  const pool: Track[] = []
  const seen = new Set<string>([keyOf(track), identityOf(track), titleKeyOf(track)])
  for (const t of lists.flat()) {
    const title = titleKeyOf(t)
    if (seen.has(keyOf(t)) || seen.has(identityOf(t)) || seen.has(title)) continue
    seen.add(keyOf(t))
    seen.add(identityOf(t))
    seen.add(title)
    pool.push(t)
  }

  return rankAndSpread(pool, scoreOf, limit)
}

/**
 * A rotating shelf of songs the listener has *not* heard yet, leaning on their
 * taste when there is any and on the catalog's own discovery terms when there
 * isn't.
 *
 * `rotation` moves the lead artist and the shuffle along, so pressing refresh
 * (or coming back tomorrow) deals a genuinely different hand instead of the
 * same twelve tracks the top favorite always returns.
 */
const DISCOVERY_TERMS = [
  'new releases', 'top hits this week', 'fresh hindi', 'indie india', 'trending punjabi',
  'romantic hits', 'party anthems', 'chill hindi', 'best of 2020s', 'sufi hits',
  'tamil hits', 'telugu hits', 'english pop hits', 'workout songs', 'late night drive',
]

export async function getFreshPicks(limit = 12, rotation = 0): Promise<Track[]> {
  const { favorites, recent } = useLibrary.getState()
  const taste = tasteArtists('', 5)

  // Rotate which taste artist leads, then pad with discovery terms so the row
  // always has something new even for a listener with one favorite.
  const rotated = taste.length ? taste.map((_, i) => taste[(i + rotation) % taste.length]) : []
  const discovery = seededShuffle(DISCOVERY_TERMS, `fresh-${rotation}`).slice(0, taste.length ? 2 : 4)
  const queries = [...new Set([...rotated.slice(0, 3), ...discovery])]

  const settled = await Promise.allSettled(queries.map((q) => songsFor(q, limit)))
  const lists = settled.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []))
  if (!lists.length) return []

  // "Fresh" has to mean it: anything already in favorites or recently played is
  // not a suggestion, it is a memory.
  const known = new Set<string>()
  for (const t of [...favorites, ...recent]) {
    known.add(keyOf(t))
    known.add(identityOf(t))
    known.add(titleKeyOf(t))
  }

  const out: Track[] = []
  const seen = new Set<string>()
  for (const t of seededShuffle(lists.flat(), `picks-${rotation}`)) {
    const title = titleKeyOf(t)
    if (known.has(keyOf(t)) || known.has(identityOf(t)) || known.has(title)) continue
    if (seen.has(title) || seen.has(identityOf(t))) continue
    seen.add(title)
    seen.add(identityOf(t))
    out.push(t)
    if (out.length >= limit) break
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
