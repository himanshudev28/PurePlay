import type { Track } from '@/types'
import { source } from '@/services'
import { scoreSameSong, SAME_SONG_CONFIDENCE, normalizeVideoTitle } from '@/lib/match'

/**
 * Find the background-playable twin of a YouTube discovery result.
 *
 * YouTube Music is in the app for its catalog, not its player: those results
 * come back as source:"youtube" and play through an iframe, which means a video
 * panel pops over the UI, no lock-screen controls, no offline copy — and,
 * because mobile browsers suspend iframes, playback stops the moment the phone
 * goes to the home screen. That last one isn't a bug we can fix in the iframe;
 * it is the platform's rule for embedded video.
 *
 * So before playing one, look the same recording up in the real audio catalog.
 * When it's there — which it usually is, since the YouTube section exists to
 * surface songs the primary catalog indexes under different spellings — the
 * track plays as ordinary audio and every one of those problems goes away. When
 * it isn't, we fall back to the iframe exactly as before.
 */

/** Matches, remembered so a song is only ever looked up once per device. */
const MEMO_KEY = 'lf:ytmatch'
const MEMO_MAX = 300
/** `null` records "looked, found nothing" — worth caching too. */
type Memo = Record<string, Track | null>

let memo: Memo | null = null

function loadMemo(): Memo {
  if (memo) return memo
  try {
    memo = JSON.parse(localStorage.getItem(MEMO_KEY) ?? '{}') as Memo
  } catch {
    memo = {}
  }
  return memo
}

function remember(id: string, match: Track | null) {
  const m = loadMemo()
  m[id] = match
  const keys = Object.keys(m)
  if (keys.length > MEMO_MAX) keys.slice(0, keys.length - MEMO_MAX).forEach((k) => delete m[k])
  try {
    localStorage.setItem(MEMO_KEY, JSON.stringify(m))
  } catch {
    /* storage full or private mode — the in-memory copy still helps */
  }
}

/** In-flight lookups, so a double click doesn't fire the search twice. */
const inFlight = new Map<string, Promise<Track | null>>()

async function findAudioTwin(track: Track): Promise<Track | null> {
  if (!source.searchTracks || source.id === 'youtube') return null

  // Search the title plus the credited artist — the artist is what separates a
  // song from the twenty covers of it.
  const query = `${normalizeVideoTitle(track.title)} ${normalizeVideoTitle(track.artist)}`.trim()
  const candidates = await source.searchTracks(query, 12)

  let best: Track | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    const score = scoreSameSong(track, candidate)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  if (!best || bestScore < SAME_SONG_CONFIDENCE) return null

  // Keep YouTube's artwork if the catalog has none, so the swap is invisible.
  return best.artwork ? best : { ...best, artwork: track.artwork }
}

/**
 * How long playback will wait for a lookup before giving up on it.
 *
 * The catalog call has a 10s timeout, retries and mirror failover behind it —
 * perfectly reasonable for loading a page, and far too long to sit between
 * pressing play and hearing anything. Past this budget the video plays instead,
 * while the lookup carries on in the background and lands in the memo, so the
 * next play of that song gets the audio.
 */
const LOOKUP_BUDGET_MS = 2500

const TIMED_OUT = Symbol('timed-out')

/**
 * The track that should actually be loaded. Never throws, and never delays
 * playback by more than LOOKUP_BUDGET_MS.
 */
export async function resolvePlayable(track: Track): Promise<Track> {
  if (track.source !== 'youtube') return track

  const cached = loadMemo()[track.id]
  if (cached !== undefined) return cached ?? track

  try {
    let pending = inFlight.get(track.id)
    if (!pending) {
      pending = findAudioTwin(track)
        .then((match) => {
          remember(track.id, match)
          return match
        })
        .catch(() => null) // a catalog outage just means "play the video"
        .finally(() => inFlight.delete(track.id))
      inFlight.set(track.id, pending)
    }

    const settled = await Promise.race([
      pending,
      new Promise<typeof TIMED_OUT>((r) => setTimeout(() => r(TIMED_OUT), LOOKUP_BUDGET_MS)),
    ])
    return settled === TIMED_OUT ? track : settled ?? track
  } catch {
    return track
  }
}

/** True when we already know a track can play as audio, without a round trip. */
export function knownAudioTwin(track: Track): Track | null {
  if (track.source !== 'youtube') return track
  return loadMemo()[track.id] ?? null
}
