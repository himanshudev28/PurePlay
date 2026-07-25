import type { MusicSource } from './source'
import { jiosaavnSource } from './jiosaavn'
import { audiusSource } from './audius'
import { jamendoSource } from './jamendo'
import { youtubeSource } from './youtube'

const REGISTRY: Record<string, MusicSource> = {
  jiosaavn: jiosaavnSource,
  youtube: youtubeSource,
  audius: audiusSource,
  jamendo: jamendoSource,
}

/**
 * JioSaavn is the default catalog: full access to Bollywood, Punjabi, Hindi,
 * Telugu, Tamil, and English music with 320kbps stream URLs and offline support.
 */
const CONFIGURED = (import.meta.env.VITE_MUSIC_SOURCE as string) || 'jiosaavn'

/** The active catalog. Change VITE_MUSIC_SOURCE to swap it. */
export const source: MusicSource = REGISTRY[CONFIGURED] ?? jiosaavnSource

/** Resolve the adapter a given track came from (tracks remember their origin). */
export function sourceFor(id: string): MusicSource {
  return REGISTRY[id] ?? source
}

export const availableSources = Object.values(REGISTRY)
export type { MusicSource }
export { SourceError } from './source'
