import { create } from 'zustand'
import {
  connectRoom, expectedPosition, clockSample, bestOffset, trimRate,
  stableMemberId, loadSession, saveSession, clearSession, savedName, rememberName,
  HARD_SEEK_THRESHOLD, DRIFT_DEADZONE, HEARTBEAT_MS, PING_MS, PRESENCE_TTL_MS,
  HOST_GRACE_MS, CLAIM_WINDOW_MS, TIME_SYNC_MS, CLOCK_SAMPLE_WINDOW,
  type RoomMessage, type RoomMember, type RoomTransport, type ControlMode,
  type ClockSample, type RoomSession,
} from '@/lib/room'
import {
  usePlayer, setTransportGate, onTransport,
  enginePosition, engineSupportsRateTrim, setEngineRate,
} from './player'

export interface ChatLine {
  id: string
  name: string
  text: string
  at: number
}

export interface RoomToast {
  text: string
  at: number
}

interface RoomState {
  /** null when not in a room */
  roomId: string | null
  name: string
  /** stable across reloads — a refresh rejoins as the same person */
  myId: string
  members: RoomMember[]
  chat: ChatLine[]
  isHost: boolean
  /** who the room currently believes is host (may be someone who just left) */
  hostId: string | null
  /** election term — higher always wins, which is what makes handover settle */
  term: number
  /** true while the host's page is gone but their seat is still being held */
  hostAway: boolean
  /** who the host has allowed to drive playback */
  controlMode: ControlMode
  /** true when this member may currently control playback */
  canControl: boolean
  /** last measured drift from the current controller, in seconds */
  drift: number
  /** one-way trip time to the host, ms (0 until measured) */
  latency: number
  /** measured difference between the host's clock and ours, ms */
  clockOffset: number
  /** true once the transport has actually carried a message */
  connecting: boolean
  /** a message to surface on the lobby, e.g. after being removed */
  notice: string | null
  /** a short-lived message about something that just happened */
  toast: RoomToast | null
  /** a room this device was in and can pick back up */
  resumable: RoomSession | null

  join: (roomId: string, name: string, opts?: { create?: boolean }) => void
  /** leave for good: tells the room, forgets the session */
  leave: () => void
  /** host-only: end the room for everyone */
  endRoom: () => void
  /** rejoin the room offered by `resumable` */
  resume: () => void
  /** forget the resumable room without joining it */
  discardResumable: () => void
  sendChat: (text: string) => void
  /** host-only: let everyone control, or restrict to the host */
  setControlMode: (mode: ControlMode) => void
  /** anyone: change your display name, live */
  setName: (name: string) => void
  /** host-only: remove a member from the room */
  kick: (memberId: string) => void
  /** take the host seat when the host is gone and the room is waiting */
  claimHost: () => void
  clearNotice: () => void
  clearToast: () => void
}

/*
  The connection lives at module scope, NOT inside the /room route component, so
  leaving the Rooms page to pick a song keeps the room connected and in sync —
  only an explicit Leave tears it down. Player sync runs here too, driven by the
  store rather than React, so it works on every page.

  ── Who is the host ────────────────────────────────────────────────────────
  Leadership used to be "lowest member id wins", recomputed on every roster
  change. Ids were random, so the moment a friend joined with a smaller id the
  room handed them the controls and took them off the person who started it.

  It is a term-based claim instead, the smallest useful slice of Raft: a member
  claims the seat with a term one higher than any it has seen, and a higher term
  always wins (ties break on id, which only matters if two people create the
  same code at the same instant). Nobody claims while a host is announcing
  itself, so a joiner can never displace a live host — it only happens when the
  seat is genuinely empty, and even then only after the departed host's grace
  period, which is what lets a host reload without losing the room.
*/
let transport: RoomTransport | null = null
let unsubPlayer: (() => void) | null = null
let unsubTransportEvents: (() => void) | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let pinger: ReturnType<typeof setInterval> | null = null
let sweeper: ReturnType<typeof setInterval> | null = null
let timeSyncer: ReturnType<typeof setInterval> | null = null
let claimTimer: ReturnType<typeof setTimeout> | null = null
let hostGraceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Until when incoming state is being applied locally.
 *
 * A boolean cleared by a timer was racy: two updates in flight meant the first
 * timer cleared the flag while the second was still applying, and the resulting
 * rebroadcast bounced between clients. A deadline can't be cleared early by a
 * stale timer.
 */
let remoteUntil = 0
const remoteActive = () => Date.now() < remoteUntil
const holdRemote = (ms: number) => {
  remoteUntil = Math.max(remoteUntil, Date.now() + ms)
}

/** member id -> when we last heard anything from them */
const lastSeen = new Map<string, number>()
let clockSamples: ClockSample[] = []
/** true while the engine is running off-speed to close a small gap */
let rateTrimmed = false
/** when we last heard the room's playback state */
let lastStateAt = 0
/** true between starting a remote-driven load and that load settling */
let loadPending = false
/** the most recent state heard while a load was in flight */
let pendingSync: Extract<RoomMessage, { type: 'state' }> | null = null
/** our own join stamp, sent with presence so peers can order arrivals */
let joinedAt = Date.now()
/** How long after joining a member will adopt the room's playback wholesale. */
const CATCH_UP_MS = 8000
/** de-dupes repeated toasts (a held-down key would otherwise stack them) */
let lastToast = { text: '', at: 0 }

const send = (msg: RoomMessage) => transport?.send(msg)

function meMember(): RoomMember {
  const { myId, name, isHost } = useRoom.getState()
  return { id: myId, name: name || 'Guest', isHost, joinedAt }
}

function toast(text: string) {
  const now = Date.now()
  if (lastToast.text === text && now - lastToast.at < 3000) return
  lastToast = { text, at: now }
  useRoom.setState({ toast: { text, at: now } })
}

/** Write down enough to offer "pick up where you left off" after a reload. */
function persist() {
  const { roomId, name, hostId, term, isHost, controlMode } = useRoom.getState()
  if (!roomId) return
  const session: RoomSession = {
    roomId, name, hostId, term, wasHost: isHost, controlMode, at: Date.now(),
  }
  saveSession(session)
  useRoom.setState({ resumable: session })
}

/* ── Broadcasting ───────────────────────────────────────────────────────── */

function broadcastState() {
  const p = usePlayer.getState()
  const { myId, hostId, term } = useRoom.getState()
  send({
    type: 'state',
    track: p.current,
    // straight from the engine: the store's copy is up to a tick stale, and a
    // quarter-second of staleness is a quarter-second of room-wide drift
    position: enginePosition(),
    playing: p.playing,
    by: myId,
    hostId,
    term,
    at: Date.now(),
  })
}

function stopPlayerBroadcast() {
  unsubPlayer?.()
  unsubPlayer = null
  unsubTransportEvents?.()
  unsubTransportEvents = null
}

function startPlayerBroadcast() {
  if (unsubPlayer) return
  // Track and play/pause changes, plus explicit transport events (a seek is
  // invisible in the state diff, and waiting for the next heartbeat to carry it
  // made scrubbing take seconds to reach the room).
  unsubPlayer = usePlayer.subscribe((s, prev) => {
    if (remoteActive()) return
    if (s.current !== prev.current || s.playing !== prev.playing) broadcastState()
  })
  unsubTransportEvents = onTransport((action) => {
    if (remoteActive()) return
    if (action === 'seek') broadcastState()
  })
}

function stopHeartbeat() {
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

function startHeartbeat() {
  if (!heartbeat) heartbeat = setInterval(broadcastState, HEARTBEAT_MS)
}

/** Reconcile broadcasting/heartbeat with the current host + control settings. */
function syncCapabilities() {
  const { isHost, controlMode, roomId } = useRoom.getState()
  const canControl = !roomId || isHost || controlMode === 'everyone'
  useRoom.setState({ canControl })

  if (canControl) {
    startPlayerBroadcast()
    // a controller is the reference, never the one being corrected
    resetRateTrim()
  } else {
    stopPlayerBroadcast()
  }

  // The host stays the room's clock regardless of who may press play: it is the
  // single reference every follower measures its drift and its clock against.
  if (isHost) startHeartbeat()
  else stopHeartbeat()
}

/* ── Drift correction ───────────────────────────────────────────────────── */

function resetRateTrim() {
  if (!rateTrimmed) return
  rateTrimmed = false
  setEngineRate(1)
}

/**
 * Close the gap to the controller.
 *
 * Anything above a second and a half can only be fixed by seeking. Below that,
 * a fractional playback rate walks the gap closed over a few seconds without a
 * click, a gap, or a re-buffer — a seek to correct 0.3s is more disruptive than
 * the 0.3s was. Backends that can't hold a fractional rate (YouTube) fall back
 * to seeking, but only once the drift is big enough to be worth the interruption.
 */
function correctDrift(delta: number, playing: boolean) {
  const p = usePlayer.getState()
  const abs = Math.abs(delta)

  // Nothing is audible while paused, so there is no reason to be gentle: put
  // the playhead exactly where the room's is and start from there.
  if (!playing) {
    resetRateTrim()
    if (abs > DRIFT_DEADZONE) p.seek(p.position + delta)
    return
  }

  if (abs > HARD_SEEK_THRESHOLD) {
    resetRateTrim()
    p.seek(p.position + delta)
    return
  }
  if (abs <= DRIFT_DEADZONE) {
    resetRateTrim()
    return
  }
  if (engineSupportsRateTrim()) {
    rateTrimmed = true
    setEngineRate(trimRate(delta))
    return
  }
  // no rate control: tolerate more before paying for a seek
  if (abs > 0.6) p.seek(p.position + delta)
}

function applyRemoteState(msg: Extract<RoomMessage, { type: 'state' }>) {
  const p = usePlayer.getState()
  const sameTrack =
    p.current && msg.track && p.current.id === msg.track.id && p.current.source === msg.track.source

  if (msg.track && !sameTrack) {
    holdRemote(1200)
    resetRateTrim()
    lastStateAt = Date.now()
    loadPending = true
    pendingSync = msg
    void p
      .playTrack(msg.track)
      .then(() => {
        /*
          Apply the NEWEST state we've heard, recomputed now — not the message
          that started the load.

          Both halves matter. A controller announces a track change before its
          own engine has started, so that first message says `playing: false`;
          acting on it after the load meant every follower loaded the track and
          then paused itself, waiting for the next heartbeat to be told to play.
          And resolving a stream takes anywhere from a few hundred ms to a
          couple of seconds, so a position measured before all that put the
          whole room exactly one load-time behind.
        */
        const latest = pendingSync ?? msg
        const after = usePlayer.getState()
        const target = expectedPosition(
          latest.position, latest.at, latest.playing, useRoom.getState().clockOffset,
        )
        after.seek(target)
        if (latest.playing) after.play()
        else after.pause()
      })
      // finally, not then: a failed load must still release the hold, or this
      // client keeps rejecting its own actions for the rest of the session
      .finally(() => {
        loadPending = false
        pendingSync = null
        remoteUntil = Date.now() + 250
      })
    return
  }

  if (!msg.track) {
    remoteUntil = Date.now() + 60
    return
  }

  // Still loading this track: record where the room has got to and let the
  // load's own completion apply it. Seeking an engine that hasn't finished
  // loading is at best ignored and at worst re-triggers buffering.
  if (loadPending) {
    pendingSync = msg
    return
  }

  lastStateAt = Date.now()
  holdRemote(200)
  const { clockOffset } = useRoom.getState()
  const target = expectedPosition(msg.position, msg.at, msg.playing, clockOffset)
  const delta = target - p.position
  useRoom.setState({ drift: delta })
  correctDrift(delta, msg.playing)
  // idempotent play/pause, not toggle() — if the flag and the engine ever
  // disagree, toggle would do the opposite of what the controller asked
  if (msg.playing) p.play()
  else p.pause()
}

/* ── Leadership ─────────────────────────────────────────────────────────── */

function cancelClaimWindow() {
  if (claimTimer) {
    clearTimeout(claimTimer)
    claimTimer = null
  }
}

function clearHostGrace() {
  if (hostGraceTimer) {
    clearTimeout(hostGraceTimer)
    hostGraceTimer = null
  }
}

/** Everyone we believe is currently present, us included. */
function aliveIds(): string[] {
  const { members, myId } = useRoom.getState()
  return [myId, ...members.filter((m) => !m.away).map((m) => m.id)]
}

function takeHostSeat(announce = true) {
  const s = useRoom.getState()
  const term = s.term + 1
  cancelClaimWindow()
  clearHostGrace()
  useRoom.setState({ hostId: s.myId, isHost: true, term, hostAway: false })
  syncCapabilities()
  if (announce) {
    send({ type: 'host', hostId: s.myId, term, at: Date.now() })
    send({ type: 'control-mode', mode: s.controlMode, term, at: Date.now() })
    broadcastState()
  }
  persist()
}

/**
 * Accept someone else's claim — or defend ours.
 *
 * Called for every message that carries leadership, which is what lets a member
 * who just reloaded learn who is in charge from the first packet it sees rather
 * than from a special handshake.
 */
function adoptLeadership(hostId: string | null, term: number) {
  if (!hostId) return
  const s = useRoom.getState()
  if (!s.roomId) return

  const newer = term > s.term
  /*
    An equal term settles on the lower id — and a member that knows of NO host
    accepts whoever is announced. Requiring a known host to compare against was
    what stopped a reloading host from taking its own seat back: peers were
    still announcing it as host at the term it left with, and the fresh page,
    holding hostId = null, treated every one of those announcements as stale.
  */
  const tie = term === s.term && (!s.hostId || hostId < s.hostId)
  const same = term === s.term && hostId === s.hostId

  if (!newer && !tie && !same) {
    // an older term than ours — if we hold the seat, say so rather than yield
    if (s.isHost) send({ type: 'host', hostId: s.myId, term: s.term, at: Date.now() })
    return
  }

  cancelClaimWindow()
  if (hostId === s.hostId) {
    clearHostGrace()
    if (s.hostAway) useRoom.setState({ hostAway: false })
  }
  if (same && s.isHost === (hostId === s.myId)) return

  const isHost = hostId === s.myId
  const lost = s.isHost && !isHost
  useRoom.setState({ hostId, term, isHost, hostAway: false })
  clearHostGrace()
  syncCapabilities()
  persist()
  if (lost) toast('Another device took over as host.')
}

/**
 * The host's page went away. Hold the seat rather than re-electing at once: the
 * overwhelmingly common cause is a reload, and because member ids now survive
 * reloads the same person comes back to the seat they left.
 */
function onHostMissing(immediate = false) {
  const s = useRoom.getState()
  if (!s.roomId || s.isHost || hostGraceTimer) return
  useRoom.setState({ hostAway: true })

  hostGraceTimer = setTimeout(() => {
    hostGraceTimer = null
    const st = useRoom.getState()
    if (!st.roomId || st.isHost) return
    const hostBack = st.hostId && st.members.some((m) => m.id === st.hostId && !m.away)
    if (hostBack) {
      useRoom.setState({ hostAway: false })
      return
    }
    // the seat is genuinely empty: the lowest id present takes it, so exactly
    // one member claims and the rest simply accept the announcement
    if (aliveIds().sort()[0] === st.myId) {
      takeHostSeat()
      toast('The host left — you are hosting now.')
    }
  }, immediate ? 1200 : HOST_GRACE_MS)
}

/* ── Presence ───────────────────────────────────────────────────────────── */

/** Record that a member is alive, adding or updating them in the roster. */
function touch(member: RoomMember) {
  const s = useRoom.getState()
  if (member.id === s.myId) return
  lastSeen.set(member.id, Date.now())

  const existing = s.members.find((m) => m.id === member.id)
  if (!existing) {
    useRoom.setState({ members: [...s.members, { ...member, away: false }] })
  } else if (existing.away || existing.name !== member.name) {
    useRoom.setState({
      members: s.members.map((m) => (m.id === member.id ? { ...m, name: member.name, away: false } : m)),
    })
  }

  if (member.id === s.hostId && s.hostAway) {
    clearHostGrace()
    useRoom.setState({ hostAway: false })
  }
}

function sweepPresence() {
  const s = useRoom.getState()
  if (!s.roomId) return
  const now = Date.now()

  /*
    A rate trim is a correction toward something. If the room has gone quiet —
    the host's laptop shut, the network dropped — there is nothing left to
    correct toward, and a forgotten 6% trim would have this device drifting
    steadily away from everyone for as long as it kept playing.
  */
  if (rateTrimmed && lastStateAt && now - lastStateAt > 8000) resetRateTrim()

  const gone = s.members.filter((m) => now - (lastSeen.get(m.id) ?? now) > PRESENCE_TTL_MS)
  if (!gone.length) return

  const goneIds = new Set(gone.map((g) => g.id))
  goneIds.forEach((id) => lastSeen.delete(id))
  useRoom.setState({ members: s.members.filter((m) => !goneIds.has(m.id)) })
  // Reaching the sweeper already means a full presence timeout of silence, so
  // there is nothing left to wait for — hold the seat only briefly.
  if (s.hostId && goneIds.has(s.hostId)) onHostMissing(true)
}

/* ── Clock sync ─────────────────────────────────────────────────────────── */

function probeHostClock() {
  const { isHost, hostId, myId } = useRoom.getState()
  if (isHost || !hostId) return
  send({ type: 'time-req', from: myId, t0: Date.now() })
}

function recordClockSample(t0: number, t1: number) {
  clockSamples = [...clockSamples, clockSample(t0, t1)].slice(-CLOCK_SAMPLE_WINDOW)
  const fastest = clockSamples.reduce((best, s) => (s.rtt < best.rtt ? s : best))
  useRoom.setState({
    clockOffset: bestOffset(clockSamples),
    latency: Math.round(fastest.rtt / 2),
  })
}

/* ── Message handling ───────────────────────────────────────────────────── */

function announceSelf() {
  const s = useRoom.getState()
  send({ type: 'hello', member: meMember(), hostId: s.hostId, term: s.term, at: Date.now() })
}

function handle(msg: RoomMessage) {
  const s = useRoom.getState()
  if (!s.roomId) return
  if (s.connecting) useRoom.setState({ connecting: false })
  const myId = s.myId

  switch (msg.type) {
    case 'join': {
      if (msg.member.id === myId) return
      // `away` members count as known: someone finishing a reload is coming
      // back, not arriving, and announcing them again reads as a second person
      const known = s.members.some((m) => m.id === msg.member.id)
      touch(msg.member)
      // greet them so they see us without waiting for the next ping
      announceSelf()
      if (useRoom.getState().isHost) {
        send({ type: 'host', hostId: myId, term: useRoom.getState().term, at: Date.now() })
        send({ type: 'control-mode', mode: useRoom.getState().controlMode, term: useRoom.getState().term, at: Date.now() })
        broadcastState()
      }
      if (!known) toast(`${msg.member.name} joined`)
      break
    }

    case 'hello':
      if (msg.member.id === myId) return
      touch(msg.member)
      adoptLeadership(msg.hostId, msg.term)
      break

    case 'sync-request': {
      if (msg.memberId === myId) return
      // Everyone answers, so a member who reloaded rebuilds the roster — and
      // learns who the host is — within one round trip instead of one ping.
      // Jittered, so a busy room doesn't answer in a single burst.
      setTimeout(announceSelf, Math.random() * 300)
      // Anyone with audio answers, not just the controller: the member asking
      // may be a host whose page just reloaded and has nothing to play.
      if (usePlayer.getState().current) setTimeout(broadcastState, 120 + Math.random() * 200)
      if (useRoom.getState().isHost) {
        send({ type: 'host', hostId: myId, term: useRoom.getState().term, at: Date.now() })
        send({ type: 'control-mode', mode: useRoom.getState().controlMode, term: useRoom.getState().term, at: Date.now() })
        broadcastState()
      }
      break
    }

    case 'leave': {
      if (msg.memberId === myId) return
      lastSeen.set(msg.memberId, Date.now())
      if (msg.transient) {
        // a reload or a backgrounded tab — hold their place for a moment
        useRoom.setState({
          members: s.members.map((m) => (m.id === msg.memberId ? { ...m, away: true } : m)),
        })
      } else {
        lastSeen.delete(msg.memberId)
        useRoom.setState({ members: s.members.filter((m) => m.id !== msg.memberId) })
      }
      if (msg.memberId === s.hostId) onHostMissing(!msg.transient)
      break
    }

    case 'host':
      lastSeen.set(msg.hostId, Date.now())
      adoptLeadership(msg.hostId, msg.term)
      break

    case 'state': {
      if (msg.by === myId) return // our own echo
      lastSeen.set(msg.by, Date.now())
      adoptLeadership(msg.hostId, msg.term)
      /*
        Only the controller's state is applied. Without this check a client
        running an older control-mode — or a stale tab that still thinks it may
        drive — could yank the whole room, which looked exactly like "the
        controls jumped to someone else".
      */
      const st = useRoom.getState()
      const fromController = !st.hostId || msg.by === st.hostId || st.controlMode === 'everyone'
      /*
        The one exception: a member who has only just arrived with nothing
        loaded takes whatever the room is already playing, from whoever offers
        it. This is what a reloading host needs — the page came back empty, and
        without it the host would sit in silence broadcasting `track: null` at a
        room that is still playing.
      */
      const p = usePlayer.getState()
      const catchingUp = !p.current && !!msg.track && Date.now() - joinedAt < CATCH_UP_MS
      /*
        Note there is deliberately no "but I can control, so I don't follow"
        rule. Under `everyone` that rule left the host as the one device that
        ignored everybody else: a friend could pause the room and the host would
        carry on playing, which is precisely the half-working state the control
        setting was in. Echoes are already handled by the remote-apply hold.
      */
      if (!fromController && !catchingUp) return
      applyRemoteState(msg)
      break
    }

    case 'control-mode':
      if (msg.term < s.term) return // a stale announcement from a former host
      if (s.controlMode !== msg.mode) {
        useRoom.setState({ controlMode: msg.mode })
        syncCapabilities()
        persist()
        if (!useRoom.getState().isHost) {
          toast(msg.mode === 'everyone' ? 'The host let everyone control playback.' : 'The host took playback control.')
        }
      }
      break

    case 'rename':
      lastSeen.set(msg.memberId, Date.now())
      useRoom.setState({
        members: s.members.map((m) => (m.id === msg.memberId ? { ...m, name: msg.name } : m)),
      })
      break

    case 'kick':
      if (msg.memberId === myId) {
        // it's us — leave, and remember why so the lobby can explain it
        teardown({ announce: false, forget: true })
        useRoom.setState({ notice: 'The host removed you from the room.' })
      } else {
        lastSeen.delete(msg.memberId)
        useRoom.setState({ members: s.members.filter((m) => m.id !== msg.memberId) })
        if (msg.memberId === s.hostId) onHostMissing(true)
      }
      break

    case 'close':
      if (msg.by === myId) return
      teardown({ announce: false, forget: true })
      useRoom.setState({ notice: 'The host ended the room.' })
      break

    case 'chat':
      if (msg.memberId === myId) return // our own is already shown
      lastSeen.set(msg.memberId, Date.now())
      useRoom.setState({
        chat: [...s.chat, { id: msg.memberId, name: msg.name, text: msg.text, at: msg.at }],
      })
      break

    case 'time-req':
      // only the host answers: it is the room's reference clock
      if (s.isHost && msg.from !== myId) {
        send({ type: 'time-res', to: msg.from, t0: msg.t0, t1: Date.now() })
      }
      break

    case 'time-res':
      if (msg.to !== myId) return
      recordClockSample(msg.t0, msg.t1)
      break
  }
}

/* ── Teardown ───────────────────────────────────────────────────────────── */

function stopTimers() {
  ;[heartbeat, pinger, sweeper, timeSyncer].forEach((t) => t && clearInterval(t))
  heartbeat = pinger = sweeper = timeSyncer = null
  cancelClaimWindow()
  clearHostGrace()
}

/**
 * @param announce  tell the room we're going (false when the room is already
 *                  gone, e.g. we were kicked)
 * @param transient the page is going away but the member may return — peers
 *                  hold their place and, if they were host, their seat
 * @param forget    drop the saved session, so the lobby stops offering to resume
 */
function teardown({ announce = true, transient = false, forget = true } = {}) {
  const { myId, roomId } = useRoom.getState()
  if (transport) {
    if (announce && roomId) send({ type: 'leave', memberId: myId, transient, at: Date.now() })
    transport.close()
    transport = null
  }
  stopPlayerBroadcast()
  stopTimers()
  setTransportGate(null)
  resetRateTrim()
  remoteUntil = 0
  lastStateAt = 0
  loadPending = false
  pendingSync = null
  lastSeen.clear()
  clockSamples = []

  useRoom.setState({
    roomId: null, members: [], chat: [], isHost: false, hostId: null, term: 0,
    hostAway: false, controlMode: 'host', canControl: false, drift: 0,
    latency: 0, clockOffset: 0, connecting: false,
  })

  if (forget) {
    clearSession()
    useRoom.setState({ resumable: null })
  }
}

export const useRoom = create<RoomState>((set, get) => ({
  roomId: null,
  name: savedName(),
  myId: stableMemberId(),
  members: [],
  chat: [],
  isHost: false,
  hostId: null,
  term: 0,
  hostAway: false,
  controlMode: 'host',
  canControl: false,
  drift: 0,
  latency: 0,
  clockOffset: 0,
  connecting: false,
  notice: null,
  toast: null,
  resumable: loadSession(),

  join(roomId, name, opts = {}) {
    const previous = get().resumable
    teardown({ forget: false }) // tear down any prior session first

    const trimmed = name.trim() || 'Guest'
    joinedAt = Date.now()
    lastSeen.clear()
    clockSamples = []

    /*
      Carry the term forward when rejoining the SAME room. A reload that reset
      the term to zero could not out-claim the room it had just been hosting,
      so a host who refreshed came back as a listener.
    */
    const resuming = previous?.roomId === roomId
    const startTerm = resuming ? previous!.term : 0

    set({
      roomId,
      name: trimmed,
      members: [],
      chat: [],
      isHost: false,
      hostId: null,
      term: startTerm,
      hostAway: false,
      controlMode: resuming ? previous!.controlMode : 'host',
      canControl: false,
      drift: 0,
      latency: 0,
      clockOffset: 0,
      connecting: true,
      notice: null,
    })

    transport = connectRoom(roomId, handle)
    setTransportGate((action) => {
      const s = useRoom.getState()
      if (!s.roomId || s.canControl || remoteActive()) return true
      if (action !== 'next') toast('The host controls playback in this room.')
      return false
    })

    send({ type: 'join', member: meMember(), at: Date.now() })
    send({ type: 'sync-request', memberId: get().myId, at: Date.now() })

    /*
      Creating a room is an unambiguous claim, so the creator takes the seat at
      once. Joining is not: wait to hear whether anyone is already hosting, and
      claim only if the seat is empty and no lower id is present to take it.
    */
    if (opts.create) {
      takeHostSeat()
    } else {
      claimTimer = setTimeout(() => {
        claimTimer = null
        const s = useRoom.getState()
        if (!s.roomId || s.hostId) return
        if (aliveIds().sort()[0] === s.myId) takeHostSeat()
      }, CLAIM_WINDOW_MS)
    }

    syncCapabilities()

    pinger = setInterval(announceSelf, PING_MS)
    sweeper = setInterval(sweepPresence, 3000)
    timeSyncer = setInterval(probeHostClock, TIME_SYNC_MS)
    // three quick probes up front so the first correction already has a
    // measured offset rather than assuming both clocks agree
    ;[300, 900, 1800].forEach((d) => setTimeout(probeHostClock, d))

    rememberName(trimmed)
    persist()
  },

  leave() {
    teardown({ announce: true, forget: true })
  },

  endRoom() {
    if (!get().isHost) return
    send({ type: 'close', by: get().myId, at: Date.now() })
    teardown({ announce: false, forget: true })
    set({ notice: 'You ended the room.' })
  },

  resume() {
    const session = get().resumable
    if (!session) return
    get().join(session.roomId, session.name || get().name)
  },

  discardResumable() {
    clearSession()
    set({ resumable: null })
  },

  sendChat(text) {
    const t = text.trim()
    if (!t || !transport) return
    const { myId, name } = get()
    const at = Date.now()
    send({ type: 'chat', memberId: myId, name, text: t, at })
    set((s) => ({ chat: [...s.chat, { id: myId, name, text: t, at }] }))
  },

  setControlMode(mode) {
    if (!get().isHost) return // only the host sets the rules
    set({ controlMode: mode })
    send({ type: 'control-mode', mode, term: get().term, at: Date.now() })
    syncCapabilities()
    persist()
  },

  setName(name) {
    const n = name.trim()
    if (!n) return
    set({ name: n })
    rememberName(n)
    send({ type: 'rename', memberId: get().myId, name: n, at: Date.now() })
    persist()
  },

  kick(memberId) {
    if (!get().isHost) return // only the host can remove members
    send({ type: 'kick', memberId, at: Date.now() })
    lastSeen.delete(memberId)
    set((s) => ({ members: s.members.filter((m) => m.id !== memberId) }))
  },

  claimHost() {
    const { roomId, isHost, hostAway } = get()
    if (!roomId || isHost || !hostAway) return
    takeHostSeat()
    toast('You are hosting now.')
  },

  clearNotice: () => set({ notice: null }),
  clearToast: () => set({ toast: null }),
}))

/*
  Leaving the page must tell the room, or the departed member lingers in every
  peer's list forever. It is sent as a *transient* leave: `pagehide` fires on
  reload and navigation just as it does on close, and treating a two-second
  refresh as a departure was what made a returning member — very often the host
  — look like a brand new stranger. The saved session is deliberately kept, so
  the tab that comes back can rejoin as the same person, and the lobby can offer
  to resume the room if it doesn't.
*/
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const s = useRoom.getState()
    if (!s.roomId) return
    persist()
    teardown({ announce: true, transient: true, forget: false })
  })

  // Restored from the back/forward cache: the room was torn down on pagehide,
  // so rejoin rather than showing a dead session.
  window.addEventListener('pageshow', (e) => {
    const s = useRoom.getState()
    if (!e.persisted || s.roomId || !s.resumable) return
    s.join(s.resumable.roomId, s.resumable.name || s.name)
  })
}
