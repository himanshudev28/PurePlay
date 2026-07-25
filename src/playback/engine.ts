import type { Track } from '@/types'

/**
 * A playback backend.
 *
 * The app used to drive a bare <audio> element from the player store. YouTube
 * cannot work that way — it plays through an IFrame the host page does not own
 * — so playback is now behind this interface and the store picks an engine per
 * track. Adding a backend (SoundCloud, a licensed DRM player) means one file.
 */
export interface PlaybackEngine {
  readonly id: string

  /**
   * True when this engine renders picture that must stay visible.
   *
   * YouTube's Terms of Service forbid audio-only playback and hiding the
   * player, so the UI reads this flag and mounts a real, visible surface
   * rather than a 1x1 offscreen frame.
   */
  readonly needsVideoSurface: boolean

  attach(callbacks: EngineCallbacks): void
  /** Resolve whatever this backend needs and begin playing `track`. */
  load(track: Track): Promise<void>
  play(): Promise<void>
  pause(): void
  /** The engine's real playing state — the source of truth for toggle(), which
   *  can't trust the store flag if a media event was missed. */
  isPlaying(): boolean
  seek(seconds: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  /** Release the backend — called when switching to a different engine. */
  teardown(): void
}

export interface EngineCallbacks {
  onPlay(): void
  onPause(): void
  onTime(position: number, duration: number): void
  onEnded(): void
  onError(message: string): void
  onLoading(loading: boolean): void
}

export const noopCallbacks: EngineCallbacks = {
  onPlay() {},
  onPause() {},
  onTime() {},
  onEnded() {},
  onError() {},
  onLoading() {},
}
