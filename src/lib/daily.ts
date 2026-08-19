/**
 * "Changes every day, but not while you're looking at it."
 *
 * Shelves like Trending should feel alive without being random: reload the page
 * twice in a row and you expect the same songs; come back tomorrow and you
 * expect different ones. Both halves come from seeding the rotation with the
 * calendar date instead of a timestamp or Math.random.
 */

/** Local calendar day, `YYYY-MM-DD`. Local on purpose — "today" is the user's. */
export function dayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** FNV-1a. Small, fast, and stable across reloads — which is the whole point. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: a seeded PRNG, so the same seed always deals the same hand. */
function rng(seed: string): () => number {
  let a = hash(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates against a seeded PRNG. Never mutates the input. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice()
  const next = rng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** `count` items from `pool`, rotated by seed — today's slice of a big list. */
export function seededPick<T>(pool: readonly T[], count: number, seed: string): T[] {
  return seededShuffle(pool, seed).slice(0, count)
}

/**
 * A localStorage cache that expires at midnight rather than after N minutes.
 *
 * Stamping the day into the stored value (instead of trusting a TTL) means a
 * device that was asleep across the date boundary still refreshes on wake, and
 * a clock change can only ever cause an extra refresh, never a stale read.
 */
export function readDaily<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`lf:daily:${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { day: string; value: T }
    return parsed.day === dayKey() ? parsed.value : null
  } catch {
    return null
  }
}

export function writeDaily<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`lf:daily:${key}`, JSON.stringify({ day: dayKey(), value }))
  } catch {
    // quota or private mode — the shelf just refetches next time
  }
}

export function clearDaily(key: string): void {
  try {
    localStorage.removeItem(`lf:daily:${key}`)
  } catch {
    // nothing to do; the caller is refetching anyway
  }
}
