import type { PlaybackEngine } from './engine'
import { HtmlAudioEngine } from './htmlAudio'
import { YouTubeEngine } from './youtube'

let htmlAudio: HtmlAudioEngine | null = null
let youtube: YouTubeEngine | null = null

/** Called once by <PlaybackHost /> with the DOM nodes the engines drive. */
export function initEngines(audioEl: HTMLAudioElement, videoContainer: HTMLElement) {
  htmlAudio = new HtmlAudioEngine(audioEl)
  youtube = new YouTubeEngine(videoContainer)
}

/**
 * Which backend plays a given source.
 *
 * YouTube must go through the IFrame player; everything else hands us a real
 * media URL and plays through <audio>.
 */
export function engineFor(sourceId: string): PlaybackEngine | null {
  if (sourceId === 'youtube') return youtube
  return htmlAudio
}

export function isFromCache(): boolean {
  return htmlAudio?.playingFromCache ?? false
}

export type { PlaybackEngine, EngineCallbacks } from './engine'
