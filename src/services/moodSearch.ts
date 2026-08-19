import type { Track, Collection } from '@/types'
import type { Mood } from '@/lib/mood'
import { source } from './index'
import { dedupeTracks } from '@/lib/shelf'

/**
 * Answering a mood with the catalog we have.
 *
 * A mood has no single query that answers it, so each one fans out to several
 * (see `detectMood`) and the results are dealt back together round-robin: the
 * best hit for "sad love songs" sits next to the best for "dard bhare gaane",
 * rather than forty of the first followed by forty of the second. That ordering
 * *is* the ranking here — scoring these against the typed words is meaningless
 * when the typed words were "breakup song" and deliberately are not being asked
 * of the catalog at all.
 */

/** Deal one item from each list in turn, so no seed query dominates the top. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  const depth = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < depth; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i])
  }
  return out
}

async function settledLists<T>(jobs: Array<Promise<T[]>>): Promise<T[][]> {
  const settled = await Promise.allSettled(jobs)
  return settled.map((r) => (r.status === 'fulfilled' ? r.value : []))
}

/**
 * Songs for a mood. `page` is 0-based and passed through to every seed, so
 * "Show more" widens all of them together.
 */
export async function searchMoodTracks(
  mood: Mood,
  page = 0,
  perQuery = 20,
  signal?: AbortSignal,
): Promise<Track[]> {
  const lists = await settledLists(
    mood.songQueries.map((q) =>
      source.searchTracks
        ? source.searchTracks(q, perQuery, signal, page)
        : source.search(q, signal).then((r) => r.tracks),
    ),
  )
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  // Every seed failing is a catalog outage, not an empty mood — say so, rather
  // than rendering "nothing matched" over a search that never ran.
  if (lists.every((l) => !l.length) && page === 0) {
    throw new Error(`Couldn't reach the catalog for ${mood.label.toLowerCase()}`)
  }
  return dedupeTracks(interleave(lists))
}

/**
 * Curated sets for a mood — usually a better answer than any single song, which
 * is why the Playlists row sits above Songs on the results page.
 */
export async function searchMoodCollections(
  mood: Mood,
  perQuery = 8,
  signal?: AbortSignal,
): Promise<Collection[]> {
  if (!source.searchPlaylists) return []
  const lists = await settledLists(
    mood.playlistQueries.map((q) => source.searchPlaylists!(q, perQuery, signal)),
  )
  const seen = new Set<string>()
  return interleave(lists).filter((c) => {
    const key = `${c.source}-${c.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
