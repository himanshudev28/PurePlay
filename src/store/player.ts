import { create } from 'zustand'
import type { Track } from '@/types'
import { keyOf } from '@/lib/db'
import { engineFor, isFromCache, type PlaybackEngine } from '@/playback'
import { getMatchingRecommendations, identityOf } from '@/services/recommendations'
import { getVolume, setVolume as persistVolume } from '@/lib/prefs'

/**
 * Radio tail sizing.
 *
 * The queue is topped up from the *playhead*, not from the total length. An
 * earlier version capped the whole queue at 60 items, which meant that after
 * 60 tracks the top-up stopped firing permanently and playback simply ran off
 * the end — a dead end that was worse than the unbounded growth it replaced.
 *
 * Memory is bounded by trimming already-played tracks off the front instead,
 * so a session can run indefinitely with a roughly constant-size queue.
 */
/** Top up once fewer than this many tracks remain ahead of the current one. */
const LOOKAHEAD_MIN = 10
/** When topping up, refill to roughly this many ahead. */
const LOOKAHEAD_TARGET = 25
/** How many played tracks stay behind the playhead before they're trimmed. */
const MAX_BEHIND = 50

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
  /** start a list at a random track *and* turn shuffle on for what follows */
  playShuffled: (tracks: Track[]) => Promise<void>
  toggle: () => void
  /** idempotent: resume only if the engine is actually paused */
  play: () => void
  /** idempotent: pause only if the engine is actually playing */
  pause: () => void
  /** jump to a queue position without resetting the queue or history */
  jumpTo: (index: number) => Promise<void>
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
  /** true while the radio tail is being fetched, so lists can show progress */
  queueExtending: boolean
  /** true once the current seed chain stops yielding anything new */
  queueExhausted: boolean
  /** pull more tracks in now, regardless of how many are already queued */
  extendQueue: () => Promise<void>
  dismissError: () => void
  /** true when the active engine renders video that must stay visible */
  videoActive: boolean
  /** whether the video frame is showing large or as a thumbnail */
  videoExpanded: boolean
  toggleVideoExpanded: () => void

  fullPlayerOpen: boolean
  playerViewMode: 'bar' | 'full' | 'card'
  openFullPlayer: () => void
  closeFullPlayer: () => void
  toggleFullPlayer: () => void
  setPlayerViewMode: (mode: 'bar' | 'full' | 'card') => void

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

/** Keep `prev` useful without letting a long radio session grow this forever. */
const HISTORY_MAX = 100

function pushHistory(key: string) {
  history.push(key)
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
}

/**
 * The volume slider only renders at md and up (see PlayerBar), so on a phone the
 * app-level gain would sit stuck at the stored default with no way to raise it.
 * On those viewports we start at full scale and let the device's own hardware
 * buttons be the volume control.
 *
 * Note: this is the app's *internal* gain multiplier, not the phone's OS volume
 * — the two are independent, and 100% here just means "don't attenuate."
 */
function initialVolume(): number {
  const hasSlider =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 768px)').matches
  return hasSlider ? getVolume() : 1
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  current: null,
  playing: false,
  position: 0,
  duration: 0,
  volume: initialVolume(),
  muted: false,
  shuffle: false,
  repeat: 'off',
  loading: false,
  error: null,
  fromCache: false,
  videoActive: false,
  videoExpanded: false,
  fullPlayerOpen: false,
  playerViewMode: 'bar',

  toggleVideoExpanded: () => set((s) => ({ videoExpanded: !s.videoExpanded })),
  openFullPlayer: () => set({ fullPlayerOpen: true }),
  closeFullPlayer: () => set({ fullPlayerOpen: false }),
  toggleFullPlayer: () => set((s) => ({ fullPlayerOpen: !s.fullPlayerOpen })),
  setPlayerViewMode: (mode) =>
    set({
      playerViewMode: mode,
      fullPlayerOpen: mode === 'full',
    }),

  _sync: (patch) => set(patch),

  async playQueue(tracks, startAt = 0) {
    if (!tracks.length) return
    set({ queue: tracks, queueExhausted: false })
    history.length = 0
    await load(startAt, set, get)
  },

  /*
    Every "Shuffle" button used to be `playQueue(list, randomIndex)` — which
    picked a random *first* track and then played the rest in order, so the
    shuffle lasted exactly one song. Turning the mode on is the point.
  */
  async playShuffled(tracks) {
    if (!tracks.length) return
    set({ shuffle: true, queue: tracks, queueExhausted: false })
    history.length = 0
    await load(Math.floor(Math.random() * tracks.length), set, get)
  },

  async playTrack(track, queue) {
    const q = queue?.length ? queue : [track]
    const found = q.findIndex((t) => keyOf(t) === keyOf(track))
    // If the supplied queue doesn't contain the track (a filtered or stale
    // list), play the requested track rather than silently playing q[0].
    if (found === -1) {
      set({ queue: [track], queueExhausted: false })
      history.length = 0
      await load(0, set, get)
      return
    }
    set({ queue: q, queueExhausted: false })
    history.length = 0
    await load(found, set, get)
  },

  toggle() {
    if (!activeEngine || !get().current) return
    // Trust the ENGINE's real state, not the store flag — a missed 'play'/'pause'
    // media event could leave the flag stale, which made the first click a no-op
    // (it only "fixed" the flag) and forced a second click to actually toggle.
    if (activeEngine.isPlaying()) get().pause()
    else get().play()
  },

  play() {
    if (!activeEngine || !get().current || activeEngine.isPlaying()) return
    set({ playing: true })
    // a successful play means any previous failure is no longer relevant
    void activeEngine
      .play()
      .then(() => set({ error: null }))
      .catch((e: Error) => set({ error: e.message, playing: false }))
  },

  pause() {
    if (activeEngine?.isPlaying()) activeEngine.pause()
    set({ playing: false })
  },

  async jumpTo(i) {
    const { queue, index } = get()
    if (!queue[i] || i === index) return
    const currentTrack = queue[index]
    if (currentTrack) pushHistory(keyOf(currentTrack))
    await load(i, set, get)
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
          activeEngine?.seek(0)
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
          // end of queue — stop cleanly rather than looping silently. Seek the
          // engine too, or it sits at the end while the scrubber reads 0:00.
          activeEngine?.pause()
          activeEngine?.seek(0)
          set({ playing: false, position: 0 })
          return
        }
      }
    }

    const currentTrack = queue[index]
    if (currentTrack) pushHistory(keyOf(currentTrack))
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
    // push the jump to the lock screen now rather than waiting for a timeupdate
    setPositionState(clamped, get().duration, true)
  },

  setVolume(v) {
    const vol = Math.max(0, Math.min(1, v))
    // moving the slider must also lift a previous mute, or the UI shows
    // sound at 50% while the engine stays silent
    activeEngine?.setVolume(vol)
    activeEngine?.setMuted(vol === 0)
    persistVolume(vol)
    set({ volume: vol, muted: vol === 0 })
  },

  toggleMute() {
    const muted = !get().muted
    const { volume } = get()
    activeEngine?.setMuted(muted)
    // unmuting from a zero volume would stay silent — restore something audible
    if (!muted && volume === 0) {
      activeEngine?.setVolume(0.5)
      persistVolume(0.5)
    }
    set({ muted, ...(!muted && volume === 0 ? { volume: 0.5 } : {}) })
  },

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

  cycleRepeat: () =>
    set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),

  queueExtending: false,
  queueExhausted: false,

  extendQueue: () => topUpQueue(set, get, true),

  enqueue: (track) =>
    // an explicit add means the queue is no longer "done" — let the radio
    // resume from this new tail track
    set((s) => ({ queue: [...s.queue, track], queueExhausted: false })),

  removeFromQueue: (i) =>
    set((s) => {
      const queue = s.queue.filter((_, n) => n !== i)

      if (i < s.index) {
        // everything after the splice shifts down one
        return { queue, index: s.index - 1 }
      }
      if (i > s.index) return { queue, index: s.index }

      // Removing the *currently playing* track: the audio keeps playing, so
      // `current` stays. Point `index` at the slot BEFORE the splice — the
      // track that slid into position `i` is then what "next" plays, instead
      // of being silently skipped. (Highlighting is done by key, not index.)
      return { queue, index: i - 1 }
    }),

  clearQueue: () => {
    history.length = 0
    exhaustedSeeds.clear()
    loadSeq++ // invalidate any in-flight load
    activeEngine?.teardown()
    activeEngine = null
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null
    set({
      queue: [],
      index: -1,
      current: null,
      playing: false,
      position: 0,
      duration: 0,
      videoActive: false,
      videoExpanded: false,
      queueExtending: false,
      queueExhausted: false,
      loading: false,
      error: null,
      fromCache: false,
    })
  },

  dismissError: () => set({ error: null }),
}))

/*
  The volume slider only renders at md and up (see PlayerBar), so on a phone
  there's no control to raise the app gain. Pin it to 100% whenever that control
  is absent and restore the saved level when it returns. A change listener — not
  just the width at first load — means it stays correct through real device
  widths, rotation, and responsive/DevTools resizes.

  This is the app's internal gain, independent of the device's hardware volume,
  and the saved preference is never overwritten with the forced 100%.
*/
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const hasSlider = window.matchMedia('(min-width: 768px)')
  const applyGainForViewport = () => {
    const target = hasSlider.matches ? getVolume() : 1
    const st = usePlayer.getState()
    if (st.volume === target) return
    activeEngine?.setVolume(st.muted ? 0 : target)
    usePlayer.setState({ volume: target })
  }
  hasSlider.addEventListener('change', applyGainForViewport)
}

/*
  Dev only: editing this module hot-swaps it and re-creates the store in its
  empty state (current: null), but the <audio> element lives in another module
  that isn't replaced and keeps playing — leaving audio with no visible player.
  Tear the engine down as the old module is disposed so playback can never
  outlive the state that drives its UI. Production has no HMR, so a reload stops
  audio and resets state together and this branch never runs.
*/
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeEngine?.teardown()
    activeEngine = null
  })
}

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
    engine.setMuted(get().muted)
    await engine.load(track)
    if (token !== loadSeq) return

    // engine.load() only resolves once el.play() has actually started, so the
    // track IS playing here. Assert it rather than waiting on the 'play' event
    // to land — a missed event left `playing` false while audio played, which
    // made the pause button need a second click to register.
    consecutiveLoadFailures = 0
    set({ loading: false, fromCache: isFromCache(), playing: true })
    updateMediaSession(track, get)

    // Prefetch the radio tail well before the playhead reaches the end.
    void topUpQueue(set, get)
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

    /*
      A radio tail is full of URLs we've never validated, so dead streams are
      expected. Skip forward rather than dead-ending the session — but only a
      few times in a row, so a fully-down catalog doesn't become a skip storm,
      and never under repeat-one, where "next" is this same broken track.
    */
    const { queue, index, repeat } = get()
    const hasSomewhereToGo = index < queue.length - 1 || repeat === 'all'
    if (repeat !== 'one' && hasSomewhereToGo && consecutiveLoadFailures < MAX_AUTO_SKIPS) {
      consecutiveLoadFailures++
      void get().next(true)
    }
  }
}

/** Consecutive failed loads; bounds the auto-skip above. */
let consecutiveLoadFailures = 0
const MAX_AUTO_SKIPS = 3

/** Seconds skipped by the lock-screen ±buttons when the OS gives no offset. */
const SEEK_STEP = 10

/**
 * Throttle so the position state is refreshed at most ~once a second. The OS
 * extrapolates the playhead from `playbackRate` between updates, so pushing it
 * every timeupdate (~4×/s) is pure waste; a seek/track change forces a refresh.
 */
let lastPositionSync = 0

/**
 * Feed the OS the real playhead so the lock-screen scrubber shows correct
 * progress and can be dragged. Guarded because Firefox/older Safari lack
 * setPositionState, and it throws on inconsistent values mid-seek.
 */
function setPositionState(position: number, duration: number, force = false) {
  const ms = navigator.mediaSession as MediaSession & {
    setPositionState?: (state: MediaPositionState) => void
  }
  if (typeof ms?.setPositionState !== 'function') return
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position < 0) return

  const now = performance.now()
  if (!force && now - lastPositionSync < 950) return
  lastPositionSync = now

  try {
    ms.setPositionState({ duration, playbackRate: 1, position: Math.min(position, duration) })
  } catch {
    // values that briefly disagree during a seek can throw — skip this frame
  }
}

/** Called from the playback host on every timeupdate. */
export function syncMediaPosition(position: number, duration: number) {
  if (!('mediaSession' in navigator)) return
  setPositionState(position, duration)
}

/** Stops two rapid track changes from firing two identical top-up fetches. */
let topUpInFlight = false

/**
 * Seeds that produced nothing new. Recommendations are derived from a track's
 * artist and title, so re-seeding from the *same* track returns the same list
 * every time — every result gets filtered out as a duplicate and the top-up
 * silently does nothing while still burning a request per track change.
 */
const exhaustedSeeds = new Set<string>()

/**
 * Extend the queue so there are always tracks waiting past the playhead.
 *
 * @param force ignore the lookahead threshold (used by "load more" in the
 *              queue UI, where the user is explicitly asking for more).
 */
export async function topUpQueue(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
  force = false,
): Promise<void> {
  if (topUpInFlight) return

  const { queue, index } = get()
  if (!queue.length || index < 0) return

  const ahead = queue.length - index - 1
  if (!force && ahead >= LOOKAHEAD_MIN) return

  /*
    Seed from the END of the queue rather than the current track. The tail is
    what the listener is drifting toward, so each round pulls from a different
    artist and the radio actually moves instead of circling one seed.
  */
  const seed = queue[queue.length - 1] ?? queue[index]
  const seedKey = keyOf(seed)
  if (exhaustedSeeds.has(seedKey)) return

  const want = Math.max(LOOKAHEAD_TARGET - ahead, LOOKAHEAD_MIN)
  topUpInFlight = true
  set({ queueExtending: true })
  try {
    // over-fetch, because most of a seed's results are already queued
    const recs = await getMatchingRecommendations(seed, want * 2)
    // filter by identity as well as id — the same song shows up under several
    // ids across compilations, and an id-only check queues audible duplicates
    const existing = new Set(get().queue.flatMap((t) => [keyOf(t), identityOf(t)]))
    const fresh = recs
      .filter((r) => !existing.has(keyOf(r)) && !existing.has(identityOf(r)))
      .slice(0, want)

    if (!fresh.length) {
      // don't ask this seed again; the next tail track becomes the next seed
      exhaustedSeeds.add(seedKey)
      // only surface "that's everything" when the tail truly can't move: the
      // seed IS the last track, so no future seed differs from this one
      set({ queueExhausted: seedKey === keyOf(get().queue[get().queue.length - 1]) })
      return
    }

    set({ ...trimPlayed([...get().queue, ...fresh], get().index), queueExhausted: false })
  } catch {
    // a failed top-up is not a playback error — the queue simply doesn't grow
  } finally {
    topUpInFlight = false
    set({ queueExtending: false })
  }
}

/**
 * Drop played tracks that have fallen far behind the playhead, keeping memory
 * flat across a long session. `index` shifts with the splice; `history` stores
 * keys rather than indices, and `prev()` already skips keys that are no longer
 * in the queue, so trimmed tracks just stop being reachable backwards.
 */
function trimPlayed(queue: Track[], index: number): Partial<PlayerState> {
  const excess = index - MAX_BEHIND
  if (excess <= 0) return { queue, index }
  return { queue: queue.slice(excess), index: index - excess }
}

/** OS-level media controls (lock screen, keyboard media keys, AirPods). */
function updateMediaSession(track: Track, get: () => PlayerState) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    artwork: track.artwork ? [{ src: track.artwork, sizes: '480x480', type: 'image/jpeg' }] : [],
  })

  // a new track resets the throttle so the first timeupdate repaints the
  // scrubber immediately rather than up to a second later
  lastPositionSync = 0

  // Not every browser implements every action; register each defensively so one
  // unsupported handler never blocks the rest.
  const trySet = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // unsupported action — the rest still works
    }
  }

  // Idempotent handlers that consult the ENGINE's real state — gating on the
  // store flag meant a stale flag made the lock-screen button do the opposite
  // of its label.
  trySet('play', () => get().play())
  trySet('pause', () => get().pause())
  trySet('nexttrack', () => void get().next())
  trySet('previoustrack', () => void get().prev())

  // seek() already clamps to [0, duration], so no bounds maths needed here
  trySet('seekbackward', (details) => get().seek(get().position - (details.seekOffset || SEEK_STEP)))
  trySet('seekforward', (details) => get().seek(get().position + (details.seekOffset || SEEK_STEP)))
  trySet('seekto', (details) => {
    if (typeof details.seekTime === 'number') get().seek(details.seekTime)
  })
}
