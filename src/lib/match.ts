import type { Track } from '@/types'

/**
 * Text matching for catalog results.
 *
 * Two features need the same judgement — "is this the song I asked for?":
 * ranking search results, and finding the background-playable twin of a
 * YouTube discovery result. Both live here so they can't drift apart.
 */

/** Lead artist only: "A, B & C" and "A feat. B" both collapse to "A". */
export function leadArtist(artist: string): string {
  return artist.split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0].trim()
}

/** Everyone credited, lower-cased — used to spot collaborations. */
export function creditedArtists(artist: string): string[] {
  return artist
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
}

/*
  Catalogs carry a dozen editions of a hit song, and their titles are the only
  thing that distinguishes them:

    "Kesariya"                       "Tum Hi Ho (Cover)"
    "Kesariya (From \"Brahmastra\")"   "Tum Hi Ho - Lofi Flip"
    "Kesariya - Slowed + Reverb"     "Tum Hi Ho (Unplugged)"

  Each has its own id and a slightly different credit list, so an id-or-artist
  check waves all of them through — which is exactly how the radio queue ended
  up listing the same song five times under almost the same name. Fold every
  edition down to one title so only the first through the door is queued.
*/
const EDITION_WORDS =
  /\b(remixe?s?|cover|covers|version|reprise|unplugged|acoustic|live|lo-?fi|slowed|reverb|remaster(?:ed)?|mix|edit|instrumental|karaoke|extended|mashup|remake|revisited|refix|flip|bass ?boosted|nightcore|sped ?up)\b/gi

/**
 * Words a video platform adds that a music catalog never does. Stripping them
 * is what lets "Kesariya (Official Video) | Arijit Singh" find plain "Kesariya".
 */
const VIDEO_NOISE =
  /\b(official|video|audio|lyrics?|lyrical|full song|full video|song|hd|4k|mv|m\/v|visualizer|teaser|trailer|promo|out now|with lyrics|video song)\b/gi

export function normalizeTitle(raw: string): string {
  const folded = raw
    .toLowerCase()
    // "(From "Brahmastra")", "[Official Video]", "{Lofi}"
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    // everything after a spaced dash/pipe/slash is an edition label, not a title
    .replace(/\s[-–—|/]\s.*$/, ' ')
    .replace(EDITION_WORDS, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // A title that is *entirely* a parenthetical would fold to nothing; keep the
  // raw string in that case rather than collapsing every such track together.
  return folded || raw.trim().toLowerCase()
}

/** As normalizeTitle, but also drops the boilerplate YouTube titles carry. */
export function normalizeVideoTitle(raw: string): string {
  const stripped = normalizeTitle(raw).replace(VIDEO_NOISE, ' ').replace(/\s+/g, ' ').trim()
  return stripped || normalizeTitle(raw)
}

const words = (s: string) => s.split(' ').filter(Boolean)

/** Which edition labels a raw title carries ("remix", "cover", "slowed", …). */
export function editionTags(raw: string): Set<string> {
  const found = raw.toLowerCase().match(EDITION_WORDS) ?? []
  EDITION_WORDS.lastIndex = 0 // the regex is global and stateful across calls
  return new Set(found.map((w) => w.replace(/[\s-]/g, '')))
}

/**
 * How much of `a` and `b` is the same, 0..1 (Sørensen–Dice over words).
 *
 * Word overlap rather than edit distance on purpose: the differences that
 * matter here are whole words that one side has and the other doesn't
 * ("theme", "reprise", an extra credited artist), not letter-level typos.
 */
export function similarity(a: string, b: string): number {
  const A = words(a)
  const B = words(b)
  if (!A.length || !B.length) return 0
  const pool = new Map<string, number>()
  A.forEach((w) => pool.set(w, (pool.get(w) ?? 0) + 1))
  let shared = 0
  for (const w of B) {
    const left = pool.get(w) ?? 0
    if (left > 0) {
      shared++
      pool.set(w, left - 1)
    }
  }
  return (2 * shared) / (A.length + B.length)
}

/** True when every word of the query appears in the text, in any order. */
function containsAllWords(text: string, query: string): boolean {
  const bag = new Set(words(text))
  return words(query).every((w) => bag.has(w))
}

/**
 * How well a track answers a typed query, 0..1.
 *
 * A search for "tum hi ho" should lead with the song called "Tum Hi Ho", not
 * with a nine-minute mashup that happens to mention it — so an exact title hit
 * outranks a partial one, and matching the artist counts for something on its
 * own (searching an artist's name should list their songs).
 */
export function scoreQuery(query: string, track: Track): number {
  const q = normalizeTitle(query)
  if (!q) return 0
  const title = normalizeTitle(track.title)
  const artist = track.artist.toLowerCase()
  const artistNorm = normalizeTitle(track.artist)

  let score = 0
  if (title === q) score = 1
  else if (containsAllWords(title, q)) score = 0.86
  else score = 0.7 * similarity(title, q)

  // "arijit singh" typed on its own: every song of theirs is a good answer
  if (artistNorm === q) score = Math.max(score, 0.95)
  else if (containsAllWords(artistNorm, q)) score = Math.max(score, 0.8)

  // "arijit singh kesariya" — credit the half of the query the title can't hold
  const combined = `${title} ${artistNorm}`
  if (containsAllWords(combined, q)) score = Math.max(score, 0.9)
  else score = Math.max(score, 0.75 * similarity(combined, q))

  // a shorter title matching the same query is the more exact answer
  if (score > 0.5 && words(title).length === words(q).length) score += 0.03

  /*
    Prefer the edition that was actually asked for. The normalizer folds
    "Tum Hi Ho", "Tum Hi Ho (Lofi Mix)" and "Tum Hi Ho - Unplugged" onto the
    same words, so without this the plain recording places wherever the catalog
    happened to put it — which is how a search for a song led with a remix of
    it. Typing "tum hi ho lofi" flips the preference the other way.
  */
  const wanted = editionTags(query)
  const has = editionTags(track.title)
  const editionMismatch =
    [...has].filter((e) => !wanted.has(e)).length + [...wanted].filter((e) => !has.has(e)).length
  score -= Math.min(0.12, editionMismatch * 0.06)
  // barely-known credits shouldn't beat the real thing on a tie
  if (artist === 'unknown artist') score -= 0.02
  return Math.min(1, Math.max(0, score))
}

/**
 * Confidence that two tracks are the same recording, 0..1.
 *
 * Used to swap a YouTube discovery result for its playable twin, so the bar has
 * to be high: playing the wrong song is far worse than falling back to video.
 */
export function scoreSameSong(target: Track, candidate: Track): number {
  const t = normalizeVideoTitle(target.title)
  const c = normalizeTitle(candidate.title)
  if (!t || !c) return 0

  const titleScore = t === c ? 1 : similarity(t, c)
  if (titleScore < 0.6) return 0

  /*
    The artist has to agree. On title alone, "Kesariya" would happily match
    somebody's lo-fi flip of it — the normalizer folds both to the same words —
    and swapping a listener onto the wrong recording is far worse than falling
    back to the video player. A YouTube "artist" is often a label or a channel
    ("T-Series"), so the artist is also accepted when it appears in the video's
    title, which is where YouTube usually puts it.
  */
  const targetArtists = creditedArtists(target.artist.toLowerCase())
  const candArtists = creditedArtists(candidate.artist.toLowerCase())
  const artistHit = targetArtists.some((a) =>
    candArtists.some((b) => a === b || (a.length > 3 && b.includes(a)) || (b.length > 3 && a.includes(b))),
  )
  const rawTargetTitle = target.title.toLowerCase()
  const artistInTitle = candArtists.some((b) => b.length > 3 && rawTargetTitle.includes(b))
  if (!artistHit && !artistInTitle) return 0

  /*
    Edition words are stripped by the normalizer so that every pressing of a
    song folds together — which is right for deduping a queue and wrong here.
    A remix, a cover and a slowed edit are all *different recordings*, so an
    edition label on one side and not the other is disqualifying.
  */
  const targetEditions = editionTags(target.title)
  const candEditions = editionTags(candidate.title)
  const sameEditions =
    targetEditions.size === candEditions.size && [...targetEditions].every((e) => candEditions.has(e))
  if (!sameEditions) return 0

  let score = 0.85 * titleScore + 0.15

  // Duration is the tie-breaker no metadata can fake: the same recording is the
  // same length. Missing durations (YouTube search often omits them) don't vote.
  if (target.duration > 0 && candidate.duration > 0) {
    const delta = Math.abs(target.duration - candidate.duration)
    if (delta <= 3) score += 0.1
    else if (delta <= 8) score += 0.04
    else if (delta > 25) score -= 0.4 // a different edit, or the wrong song
  }
  return Math.min(1, Math.max(0, score))
}

/** Above this, two tracks are treated as the same recording. */
export const SAME_SONG_CONFIDENCE = 0.72

/**
 * Order results by how well they answer the query, keeping the catalog's own
 * ordering as the tie-break (it encodes popularity, which we can't see).
 */
export function rankByQuery(query: string, tracks: Track[]): Track[] {
  const scored = tracks.map((t, i) => ({ t, i, s: scoreQuery(query, t) }))
  scored.sort((a, b) => b.s - a.s || a.i - b.i)
  return scored.map((x) => x.t)
}
