import type { PlaybackEngine, EngineCallbacks } from './engine'
import { noopCallbacks } from './engine'
import type { Track } from '@/types'

/* ---- minimal typings for the IFrame API (no @types dependency) ---- */

interface YTPlayer {
  loadVideoById(id: string): void
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  setVolume(percent: number): void
  mute(): void
  unMute(): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  destroy(): void
}

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      height?: string
      width?: string
      videoId?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: () => void
        onStateChange?: (e: { data: number }) => void
        onError?: (e: { data: number }) => void
      }
    },
  ) => YTPlayer
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

/** Load the IFrame API exactly once, however many engines ask for it. */
function loadApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }

    const timeout = setTimeout(
      () => reject(new Error('YouTube player failed to load — check for a blocker')),
      15000,
    )

    // The API calls a single global hook. Chain rather than overwrite, so we
    // can't clobber another consumer's callback.
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      clearTimeout(timeout)
      if (window.YT) resolve(window.YT)
      else reject(new Error('YouTube API loaded without a player'))
    }

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.async = true
      s.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('Could not reach YouTube'))
      }
      document.head.appendChild(s)
    }
  })

  apiPromise.catch(() => {
    apiPromise = null // allow a retry rather than caching the failure forever
  })
  return apiPromise
}

/**
 * YouTube backend.
 *
 * `needsVideoSurface` is true and non-negotiable: YouTube's Terms of Service
 * forbid audio-only playback and hiding the player. The UI mounts a real,
 * visible frame — the video is part of the product, not a workaround.
 */
export class YouTubeEngine implements PlaybackEngine {
  readonly id = 'youtube'
  readonly needsVideoSurface = true

  private player: YTPlayer | null = null
  private cb: EngineCallbacks = noopCallbacks
  private container: HTMLElement
  private ticker: number | null = null
  private pendingId: string | null = null
  private volume = 80
  private muted = false

  constructor(container: HTMLElement) {
    this.container = container
  }

  attach(callbacks: EngineCallbacks) {
    this.cb = callbacks
  }

  async load(track: Track) {
    this.cb.onLoading(true)
    const videoId = track.id
    this.pendingId = videoId

    try {
      const YT = await loadApi()
      // a newer load landed while the API was still downloading
      if (this.pendingId !== videoId) return

      if (!this.player) {
        await new Promise<void>((resolve) => {
          this.player = new YT.Player(this.container, {
            width: '100%',
            height: '100%',
            videoId,
            playerVars: {
              autoplay: 1,
              playsinline: 1,
              // keep YouTube's own chrome — required, and it is what makes
              // the "visible player" obligation genuinely satisfied
              controls: 1,
              rel: 0,
            },
            events: {
              onReady: () => resolve(),
              onStateChange: (e) => this.onState(e.data, YT),
              onError: (e) => this.cb.onError(youtubeError(e.data)),
            },
          })
        })
        this.applyVolume()
      } else {
        this.player.loadVideoById(videoId)
        this.player.playVideo()
      }

      this.startTicker()
      this.cb.onLoading(false)
    } catch (e) {
      this.cb.onError(e instanceof Error ? e.message : 'YouTube playback failed')
      this.cb.onLoading(false)
    }
  }

  private onState(state: number, YT: YTNamespace) {
    const S = YT.PlayerState
    if (state === S.PLAYING) {
      this.cb.onPlay()
      this.cb.onLoading(false)
    } else if (state === S.PAUSED) {
      this.cb.onPause()
    } else if (state === S.BUFFERING) {
      this.cb.onLoading(true)
    } else if (state === S.ENDED) {
      this.cb.onEnded()
    }
  }

  /**
   * The IFrame API has no timeupdate event, so position must be polled.
   * 250ms is smooth enough for a scrubber without burning the main thread.
   */
  private startTicker() {
    if (this.ticker) return
    this.ticker = window.setInterval(() => {
      if (!this.player) return
      try {
        this.cb.onTime(this.player.getCurrentTime(), this.player.getDuration() || 0)
      } catch {
        // the iframe can be mid-teardown; a dropped tick is harmless
      }
    }, 250)
  }

  private applyVolume() {
    if (!this.player) return
    this.player.setVolume(Math.round(this.volume))
    if (this.muted) this.player.mute()
    else this.player.unMute()
  }

  async play() {
    this.player?.playVideo()
  }
  pause() {
    this.player?.pauseVideo()
  }
  isPlaying() {
    // YT.PlayerState.PLAYING === 1
    return this.player?.getPlayerState() === 1
  }
  seek(seconds: number) {
    this.player?.seekTo(seconds, true)
  }
  setVolume(volume: number) {
    this.volume = volume * 100
    this.applyVolume()
  }
  setMuted(muted: boolean) {
    this.muted = muted
    this.applyVolume()
  }

  teardown() {
    this.pendingId = null
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
    try {
      this.player?.destroy()
    } catch {
      // already gone
    }
    this.player = null
  }
}

function youtubeError(code: number): string {
  switch (code) {
    case 2:
      return 'YouTube rejected this video id'
    case 5:
      return 'This video cannot play in an embedded player'
    case 100:
      return 'This video was removed or made private'
    case 101:
    case 150:
      return "This video's owner does not allow it to be played here"
    default:
      return 'YouTube playback failed'
  }
}
