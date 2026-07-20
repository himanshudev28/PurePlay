import type { MusicSource } from './source'
import { audiusSource } from './audius'
import { jamendoSource } from './jamendo'
import { youtubeSource } from './youtube'

const REGISTRY: Record<string, MusicSource> = {
  youtube: youtubeSource,
  audius: audiusSource,
  jamendo: jamendoSource,
}

/**
 * YouTube is the default: it is the only catalog with everything in it.
 * Audius stays registered as the offline-capable source — tracks remember
 * which adapter produced them, so both coexist in one queue and one library.
 */
const CONFIGURED = (import.meta.env.VITE_MUSIC_SOURCE as string) || 'youtube'

/** The active catalog. Change VITE_MUSIC_SOURCE to swap it. */
export const source: MusicSource = REGISTRY[CONFIGURED] ?? audiusSource

/** Resolve the adapter a given track came from (tracks remember their origin). */
export function sourceFor(id: string): MusicSource {
  return REGISTRY[id] ?? source
}

export const availableSources = Object.values(REGISTRY)
export type { MusicSource }
export { SourceError } from './source'
