import type { Track } from '@/types'
import { identityOf } from '@/services/recommendations'

/**
 * Spread repeated album art across a list.
 *
 * A film soundtrack ships one cover for every song on the release, so a
 * Bollywood shelf routinely paints six identical squares in a row — which
 * reads as a duplicated, broken feed even though the songs are all different.
 *
 * Nothing is dropped and nothing is re-ranked within a cover: the tracks are
 * bucketed by artwork and dealt back out round-robin, so the first song from
 * each distinct cover comes first, then the second of each, and so on. A shelf
 * that came entirely from one album still fills completely.
 */
export function spreadByArtwork<T extends { artwork?: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>()
  items.forEach((item, i) => {
    // No art means the placeholder glyph, which can't collide with anything
    // visually — give each its own bucket so they aren't herded together.
    const key = item.artwork?.trim() || `no-art-${i}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(item)
    else groups.set(key, [item])
  })

  // Every cover already unique — leave the caller's ordering completely alone.
  if (groups.size === items.length) return items

  const buckets = [...groups.values()]
  const out: T[] = []
  for (let round = 0; out.length < items.length; round++) {
    let placed = false
    for (const bucket of buckets) {
      if (round >= bucket.length) continue
      out.push(bucket[round])
      placed = true
    }
    if (!placed) break
  }
  return out
}

/**
 * One entry per recording, then spread by cover art.
 *
 * The catalog indexes the same song under several ids across compilations, so
 * a shelf assembled from more than one query shows visible repeats that a
 * source-and-id key never catches. `identityOf` folds editions of a song
 * together the same way search ranking does.
 */
export function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>()
  const unique: Track[] = []
  for (const t of tracks) {
    const key = identityOf(t)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(t)
  }
  return spreadByArtwork(unique)
}
