import type { PlaybackEngine, EngineCallbacks } from './engine'
import { noopCallbacks } from './engine'
import type { Track } from '@/types'
import { sourceFor } from '@/services'
import { offlineUrl } from '@/lib/db'

/**
 * The <audio> backend — used for every source that hands us a real media URL
 * (Audius, Jamendo, and anything cached offline).
 */
export class HtmlAudioEngine implements PlaybackEngine {
  readonly id = 'html-audio'
  readonly needsVideoSurface = false

  private el: HTMLAudioElement
  private cb: EngineCallbacks = noopCallbacks
  private objectUrl: string | null = null
  /** invalidates a slower in-flight load when a newer one starts */
  private seq = 0

  constructor(el: HTMLAudioElement) {
    this.el = el
    el.addEventListener('play', () => this.cb.onPlay())
    el.addEventListener('pause', () => this.cb.onPause())
    el.addEventListener('timeupdate', () => this.cb.onTime(el.currentTime, el.duration || 0))
    el.addEventListener('loadedmetadata', () => this.cb.onTime(el.currentTime, el.duration || 0))
    el.addEventListener('waiting', () => this.cb.onLoading(true))
    el.addEventListener('playing', () => this.cb.onLoading(false))
    el.addEventListener('ended', () => this.cb.onEnded())
    el.addEventListener('error', () => {
      // MEDIA_ERR_ABORTED fires whenever we swap src mid-load; not a real failure
      if (el.error && el.error.code !== MediaError.MEDIA_ERR_ABORTED) {
        this.cb.onError('This track could not be played')
      }
    })
  }

  attach(callbacks: EngineCallbacks) {
    this.cb = callbacks
  }

  async load(track: Track) {
    const token = ++this.seq
    const previousUrl = this.objectUrl
    this.cb.onLoading(true)

    const cached = await offlineUrl(track)
    if (token !== this.seq) {
      if (cached) URL.revokeObjectURL(cached)
      return
    }

    let url: string
    if (cached) {
      url = cached
      this.objectUrl = cached
    } else {
      url = await sourceFor(track.source).streamUrl(track)
      if (token !== this.seq) return
      this.objectUrl = null
    }

    this.el.src = url
    // release the old blob only after repointing, or a failed load leaves src
    // aimed at a revoked URL
    if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl)

    await this.el.play()
    if (token !== this.seq) return
    this.cb.onLoading(false)
  }

  /** true when the last load came from IndexedDB rather than the network */
  get playingFromCache() {
    return this.objectUrl !== null
  }

  async play() {
    await this.el.play()
  }
  pause() {
    this.el.pause()
  }
  seek(seconds: number) {
    this.el.currentTime = seconds
  }
  setVolume(volume: number) {
    this.el.volume = volume
    this.el.muted = volume === 0
  }
  setMuted(muted: boolean) {
    this.el.muted = muted
  }
  teardown() {
    this.seq++
    this.el.pause()
    this.el.removeAttribute('src')
    this.el.load()
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }
}
