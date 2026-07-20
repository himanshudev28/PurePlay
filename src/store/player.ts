import { create } from 'zustand'
import type { Track } from '@/types'
import { keyOf } from '@/lib/db'
import { engineFor, isFromCache, type PlaybackEngine } from '@/playback'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  queue: Track[]
  /** index into `queue`, -1 when nothing is loaded */
  index: number
  current: Track | null
  playing: boolean
  /** seconds */
  position: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  loading: boolean
  error: string | null
  /** true when the audio came from IndexedDB rather than the network */
  fromCache: boolean

  playTrack: (track: Track, queue?: Track[]) => Promise<void>
  playQueue: (tracks: Track[], startAt?: number) => Promise<void>
  toggle: () => void
  next: (auto?: boolean) => Promise<void>
  prev: () => Promise<void>
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  enqueue: (track: Track) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  dismissError: () => void
  /** true when the active engine renders video that must stay visible */
  videoActive: boolean
  /** whether the video frame is showing large or as a thumbnail */
  videoExpanded: boolean
  toggleVideoExpanded: () => void

  _sync: (patch: Partial<PlayerState>) => void
}

/** the engine currently driving playback, so we can stop it before switching */
let activeEngine: PlaybackEngine | null = null

/**
 * Monotonic token. Every load() captures the value at entry and bails after each
 * await if a newer load has started — otherwise a slow load started first can
 * resolve last and leave the engine playing a different track than the UI shows.
 */
let loadSeq = 0

/**
 * Keys (not indices) of previously played tracks, so `prev` survives the queue
 * being spliced underneath it. Indices would silently point at the wrong track
 * after any removal.
 */
const history: string[] = []

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  current: null,
  playing: false,
  position: 0,
  duration: 0,
  volume: Number(localStorage.getItem('lf:volume') ?? 0.8),
  muted: false,
  shuffle: false,
  repeat: 'off',
  loading: false,
  error: null,
  fromCache: false,
  videoActive: false,
  videoExpanded: false,

  toggleVideoExpanded: () => set((s) => ({ videoExpanded: !s.videoExpanded })),

  _sync: (patch) => set(patch),

  async playQueue(tracks, startAt = 0) {
    if (!tracks.length) return
    set({ queue: tracks })
    history.length = 0
    await load(startAt, set, get)
  },

  async playTrack(track, queue) {
    const q = queue?.length ? queue : [track]
    const found = q.findIndex((t) => keyOf(t) === keyOf(track))
    // If the supplied queue doesn't contain the track (a filtered or stale
    // list), play the requested track rather than silently playing q[0].
    if (found === -1) {
      set({ queue: [track] })
      history.length = 0
      await load(0, set, get)
      return
    }
    set({ queue: q })
    history.length = 0
    await load(found, set, get)
  },

  toggle() {
    if (!activeEngine || !get().current) return
    if (get().playing) {
      activeEngine.pause()
    } else {
      // a successful play means any previous failure is no longer relevant
      void activeEngine
        .play()
        .then(() => set({ error: null }))
        .catch((e: Error) => set({ error: e.message, playing: false }))
    }
  },

  async next(auto = false) {
    const { queue, index, repeat, shuffle } = get()
    if (!queue.length) return

    if (auto && repeat === 'one') {
      await load(index, set, get)
      return
    }

    let target: number
    if (shuffle) {
      if (queue.length === 1) {
        // a single-track queue with shuffle on must still respect repeat
        if (repeat === 'off' && auto) {
          activeEngine?.pause()
          set({ playing: false, position: 0 })
          return
        }
        target = index
      } else {
        do target = Math.floor(Math.random() * queue.length)
        while (target === index)
      }
    } else {
      target = index + 1
      if (target >= queue.length) {
        if (repeat === 'all') target = 0
        else {
          // end of queue — stop cleanly rather than looping silently
          activeEngine?.pause()
          set({ playing: false, position: 0 })
          return
        }
      }
    }

    const currentTrack = queue[index]
    if (currentTrack) history.push(keyOf(currentTrack))
    await load(target, set, get)
  },

  async prev() {
    const { position, index, queue } = get()
    // standard behaviour: restart the track unless we're in the first 3 seconds
    if (position > 3 && activeEngine) {
      activeEngine.seek(0)
      set({ position: 0 })
      return
    }

    // walk back through history, skipping keys no longer in the queue
    while (history.length) {
      const key = history.pop()!
      const at = queue.findIndex((t) => keyOf(t) === key)
      if (at !== -1) {
        await load(at, set, get)
        return
      }
    }

    const target = index - 1
    if (target < 0) {
      activeEngine?.seek(0)
      set({ position: 0 })
      return
    }
    await load(target, set, get)
  },

  seek(seconds) {
    if (!activeEngine || !Number.isFinite(seconds)) return
    const max = get().duration || seconds
    const clamped = Math.max(0, Math.min(seconds, max))
    activeEngine.seek(clamped)
    // store the clamped value, not the request — otherwise the scrubber can
    // render past the end until the next timeupdate corrects it
    set({ position: clamped })
  },

  setVolume(v) {
    const vol = Math.max(0, Math.min(1, v))
    // moving the slider must also lift a previous mute, or the UI shows
    // sound at 50% while the engine stays silent
    activeEngine?.setVolume(vol)
    localStorage.setItem('lf:volume', String(vol))
    set({ volume: vol, muted: vol === 0 })
  },

  toggleMute() {
    const muted = !get().muted
    const { volume } = get()
    activeEngine?.setMuted(muted)
    // unmuting from a zero volume would stay silent — restore something audible
    if (!muted && volume === 0) {
      activeEngine?.setVolume(0.5)
      localStorage.setItem('lf:volume', '0.5')
    }
    set({ muted, ...(!muted && volume === 0 ? { volume: 0.5 } : {}) })
  },

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

  cycleRepeat: () =>
    set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),

  enqueue: (track) => set((s) => ({ queue: [...s.queue, track] })),

  removeFromQueue: (i) =>
    set((s) => {
      const queue = s.queue.filter((_, n) => n !== i)

      if (i < s.index) {
        // everything after the splice shifts down one
        return { queue, index: s.index - 1 }
      }
      if (i > s.index) return { queue, index: s.index }

      // removing the *currently playing* track: keep `index` pointing at the
      // track that slid into its place so next/prev stay coherent, and keep
      // `current` as-is because that audio is still playing.
      return { queue, index: Math.min(s.index, queue.length - 1) }
    }),

  clearQueue: () => {
    history.length = 0
    loadSeq++ // invalidate any in-flight load
    activeEngine?.teardown()
    activeEngine = null
    set({
      queue: [],
      index: -1,
      current: null,
      playing: false,
      position: 0,
      duration: 0,
      videoActive: false,
    })
  },

  dismissError: () => set({ error: null }),
}))

/**
 * Load queue[at] through whichever engine handles its source.
 *
 * A YouTube track and an Audius track cannot play through the same backend, so
 * switching between them tears the previous engine down first — otherwise the
 * old one keeps playing underneath the new one.
 */
async function load(
  at: number,
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
) {
  const track = get().queue[at]
  if (!track) return

  const engine = engineFor(track.source)
  if (!engine) {
    set({ error: 'Playback is not available for this source', loading: false })
    return
  }

  const token = ++loadSeq

  if (activeEngine && activeEngine !== engine) {
    activeEngine.teardown()
  }
  activeEngine = engine

  set({
    loading: true,
    error: null,
    index: at,
    current: track,
    position: 0,
    duration: 0,
    videoActive: engine.needsVideoSurface,
  })

  try {
    engine.setVolume(get().muted ? 0 : get().volume)
    await engine.load(track)
    if (token !== loadSeq) return

    set({ loading: false, fromCache: isFromCache() })
    updateMediaSession(track, get)
  } catch (e) {
    if (token !== loadSeq) return

    // Skipping tracks quickly cancels the pending play() — Chrome reports this
    // as AbortError ("interrupted by a new load request"). It's expected, not a
    // failure, so it must never reach the user.
    const aborted =
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && /abort|interrupted by/i.test(e.message))

    if (aborted) {
      set({ loading: false })
      return
    }
    set({
      error: e instanceof Error ? e.message : 'Playback failed',
      loading: false,
      playing: false,
    })
  }
}

/** OS-level media controls (lock screen, keyboard media keys, AirPods). */
function updateMediaSession(track: Track, get: () => PlayerState) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    artwork: track.artwork ? [{ src: track.artwork, sizes: '480x480', type: 'image/jpeg' }] : [],
  })
  navigator.mediaSession.setActionHandler('play', () => get().toggle())
  navigator.mediaSession.setActionHandler('pause', () => get().toggle())
  navigator.mediaSession.setActionHandler('nexttrack', () => void get().next())
  navigator.mediaSession.setActionHandler('previoustrack', () => void get().prev())
}
