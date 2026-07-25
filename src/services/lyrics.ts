import { withTimeout } from '@/lib/net'

export interface LyricLine {
  time: number // in seconds
  text: string
}

export interface LyricsData {
  synced: boolean
  lines: LyricLine[]
}

/**
 * Parses LRC timestamp string format: "[00:12.34] Line text"
 */
export function parseLrc(lrcText: string): LyricLine[] {
  const lines = lrcText.split('\n')
  const result: LyricLine[] = []
  // Global, with optional fractional seconds: standard LRC compresses repeated
  // lines as "[00:12.34][01:20.50]Chorus", and "[mm:ss]" (no fraction) is valid
  // — a non-global regex leaked the extra timestamps into the rendered text and
  // dropped the repeats entirely.
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g

  for (const line of lines) {
    timeRegex.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    while ((match = timeRegex.exec(line))) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const millis = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0
      stamps.push(minutes * 60 + seconds + millis / 1000)
    }

    const text = line.replace(timeRegex, '').trim()
    if (!text) continue
    if (stamps.length) {
      for (const time of stamps) result.push({ time, text })
    } else if (!text.startsWith('[')) {
      // metadata tags like [ar:...] fall through here and are skipped
      result.push({ time: 0, text })
    }
  }

  return result.sort((a, b) => a.time - b.time)
}

/**
 * Clean track title for better lyrics matching (strip "(Official Video)", "Remix", etc.)
 */
function cleanSearchQuery(title: string): string {
  return title
    .replace(/[([]\s*(official|music|video|audio|lyric|hd|remastered|full|song)\s*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const toPlainLines = (text: string): LyricLine[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // `time` is positional filler so the lines render in order — it is NOT a
    // playhead. Consumers must gate any time-based highlight on `synced`.
    .map((t, idx) => ({ time: idx * 4, text: t }))

/**
 * Results are cached for the session. Re-opening the full player on a track
 * you've already heard previously re-hit LRCLIB twice (get, then search) every
 * single time, including for tracks known to have no lyrics at all.
 */
const cache = new Map<string, LyricsData | null>()
const MAX_CACHE = 200

/**
 * Fetch lyrics from the LRCLIB API, parsing synced (LRC) lyrics when present.
 */
export async function fetchLyrics(
  title: string,
  artist: string,
  signal?: AbortSignal,
): Promise<LyricsData | null> {
  const cleanTitle = cleanSearchQuery(title)
  const cleanArtist = artist.split(',')[0].trim() // use first primary artist

  const cacheKey = `${cleanTitle}::${cleanArtist}`.toLowerCase()
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null

  const result = await lookup(cleanTitle, cleanArtist, signal)
  if (!signal?.aborted) {
    // bound the map so a long session can't grow it without limit
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
    cache.set(cacheKey, result)
  }
  return result
}

async function lookup(
  cleanTitle: string,
  cleanArtist: string,
  signal?: AbortSignal,
): Promise<LyricsData | null> {
  try {
    const params = new URLSearchParams({
      track_name: cleanTitle,
      artist_name: cleanArtist,
    })
    const res = await fetch(`https://lrclib.net/api/get?${params}`, { signal: withTimeout(signal) })

    if (res.ok) {
      const data = (await res.json()) as {
        syncedLyrics?: string
        plainLyrics?: string
      }

      if (data.syncedLyrics) {
        const parsed = parseLrc(data.syncedLyrics)
        if (parsed.length > 0) {
          return { synced: true, lines: parsed }
        }
      }

      if (data.plainLyrics) {
        return { synced: false, lines: toPlainLines(data.plainLyrics) }
      }
    }

    // fallback search query if direct get fails
    const searchRes = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanTitle} ${cleanArtist}`)}`,
      { signal: withTimeout(signal) },
    )
    if (searchRes.ok) {
      const searchData = (await searchRes.json()) as Array<{
        syncedLyrics?: string
        plainLyrics?: string
      }>
      const match = searchData.find((item) => item.syncedLyrics || item.plainLyrics)
      if (match) {
        if (match.syncedLyrics) {
          const parsed = parseLrc(match.syncedLyrics)
          if (parsed.length > 0) return { synced: true, lines: parsed }
        }
        if (match.plainLyrics) {
          return { synced: false, lines: toPlainLines(match.plainLyrics) }
        }
      }
    }
  } catch (e) {
    // A cancelled request (track changed) must not be cached as "no lyrics"
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    // otherwise: network or parse error — fall through to "none found"
  }

  return null
}
