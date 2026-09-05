// type-only: erased at build time, so it pulls no mqtt code into the bundle
import type { MqttClient } from 'mqtt'
import type { Track } from '@/types'

/**
 * Synced listening rooms.
 *
 * Transport is pluggable, tried in this order:
 *   1. A raw WebSocket relay, if VITE_ROOM_WS is set (self-hosted — see
 *      server/room-relay.mjs).
 *   2. Otherwise a public MQTT-over-WebSocket broker. This needs NO server of
 *      our own and works on serverless hosts like Vercel, because the browser
 *      talks straight to the broker. Override the broker with VITE_ROOM_BROKER.
 *   3. If neither can connect, a BroadcastChannel so same-device tabs still sync.
 *
 * The message shapes below are all any transport ever carries.
 */

/** Public MQTT broker (WSS) — free, no account, reachable from HTTPS pages. */
const DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt'
const roomTopic = (roomId: string) => `pureplay/room/${roomId}`

export interface RoomMember {
  id: string
  name: string
  isHost: boolean
  /** the member's own clock when they joined — display only, never authority */
  joinedAt: number
  /** set locally when a member's page went away and may be coming back */
  away?: boolean
}

/** Who may drive playback: the host alone, or anyone in the room. */
export type ControlMode = 'host' | 'everyone'

export type RoomMessage =
  | { type: 'join'; member: RoomMember; at: number }
  /**
   * Periodic presence beacon. It carries the sender's view of leadership so a
   * member who reloaded — or who joined after the last election — learns who
   * the host is without anyone having to re-announce.
   */
  | { type: 'hello'; member: RoomMember; hostId: string | null; term: number; at: number }
  /** `transient` marks a reload/tab-hide rather than a deliberate exit */
  | { type: 'leave'; memberId: string; transient?: boolean; at: number }
  /** playback state — `by` is the member who broadcast it, so it isn't echoed */
  | {
      type: 'state'
      track: Track | null
      position: number
      playing: boolean
      by: string
      hostId: string | null
      term: number
      at: number
    }
  /** a member asking whoever's in control to re-broadcast (sent on join) */
  | { type: 'sync-request'; memberId: string; at: number }
  /** a member claiming leadership for `term` (see the election notes below) */
  | { type: 'host'; hostId: string; term: number; at: number }
  /** host announces who's allowed to control playback */
  | { type: 'control-mode'; mode: ControlMode; term: number; at: number }
  /** a member changed their display name */
  | { type: 'rename'; memberId: string; name: string; at: number }
  /** host removed a member from the room */
  | { type: 'kick'; memberId: string; at: number }
  | { type: 'chat'; memberId: string; name: string; text: string; at: number }
  /** the host ended the room for everyone */
  | { type: 'close'; by: string; at: number }
  /** clock-sync probe: only the host answers, with `time-res` */
  | { type: 'time-req'; from: string; t0: number }
  | { type: 'time-res'; to: string; t0: number; t1: number }

type Handler = (msg: RoomMessage) => void

export interface RoomTransport {
  send(msg: RoomMessage): void
  close(): void
}

/* ── Sync tuning ────────────────────────────────────────────────────────────
   Values are deliberately tighter than "safe" defaults: with the clock offset
   measured (see estimateOffset) the numbers below describe real playback
   divergence rather than clock skew, so we can afford to care about a tenth of
   a second instead of two whole seconds. */

/**
 * Above this much divergence, seek: the rate trim closes roughly 0.06s of gap
 * per second, so anything larger would take long enough that the room stays
 * audibly apart while it "corrects". Below it, the trim is the better tool.
 */
export const HARD_SEEK_THRESHOLD = 0.75
/** Below this, do nothing — correcting would be more audible than the drift. */
export const DRIFT_DEADZONE = 0.12
/** Fastest/slowest playback trim used to erase small drift inaudibly. */
export const MAX_RATE_TRIM = 0.06
/** How often the controller republishes its position. */
export const HEARTBEAT_MS = 3000
/** How often every member announces itself. */
export const PING_MS = 4000
/** Drop a member we haven't heard from in this long. */
export const PRESENCE_TTL_MS = 14_000
/** How long a departed host's seat is held before the room elects a new one. */
export const HOST_GRACE_MS = 12_000
/** How long a joiner listens for an existing host before claiming the seat. */
export const CLAIM_WINDOW_MS = 1500
/** How often followers re-measure their clock offset against the host. */
export const TIME_SYNC_MS = 8000

/** Cross-tab transport: works with zero setup, but only on this one device. */
function broadcastTransport(roomId: string, onMessage: Handler): RoomTransport {
  const ch = new BroadcastChannel(`lf:room:${roomId}`)
  const listener = (e: MessageEvent) => onMessage(e.data as RoomMessage)
  ch.addEventListener('message', listener)
  return {
    send: (msg) => ch.postMessage(msg),
    close: () => {
      ch.removeEventListener('message', listener)
      ch.close()
    },
  }
}

/** Self-hosted raw-WS relay (server/room-relay.mjs), used only when configured. */
function wsTransport(wsUrl: string, roomId: string, onMessage: Handler): RoomTransport {
  let ws: WebSocket | null = new WebSocket(`${wsUrl}?room=${encodeURIComponent(roomId)}`)
  let opened = false
  let fallback: RoomTransport | null = null
  const queued: RoomMessage[] = []

  const degrade = () => {
    if (fallback || opened) return
    ws = null
    fallback = broadcastTransport(roomId, onMessage)
    queued.splice(0).forEach((m) => fallback!.send(m))
  }

  ws.addEventListener('open', () => {
    opened = true
    queued.splice(0).forEach((m) => ws!.send(JSON.stringify(m)))
  })
  ws.addEventListener('message', (e) => {
    try {
      onMessage(JSON.parse(e.data as string) as RoomMessage)
    } catch {
      /* ignore malformed frames */
    }
  })
  ws.addEventListener('error', degrade)
  ws.addEventListener('close', degrade)

  return {
    send(msg) {
      if (fallback) return fallback.send(msg)
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
      else queued.push(msg)
    },
    close() {
      if (fallback) fallback.close()
      else ws?.close()
    },
  }
}

/**
 * Default transport: a public MQTT broker over WSS. No server of ours, so it
 * works on Vercel and every other static/serverless host. Each room is a topic;
 * the broker fans a publish out to everyone subscribed. Falls back to cross-tab
 * sync if the broker can't be reached.
 */
function mqttTransport(roomId: string, onMessage: Handler): RoomTransport {
  const url = (import.meta.env.VITE_ROOM_BROKER as string | undefined) || DEFAULT_BROKER
  const topic = roomTopic(roomId)
  const queued: RoomMessage[] = []
  let connected = false
  let fallback: RoomTransport | null = null
  let client: MqttClient | null = null
  let closed = false

  const degrade = () => {
    if (fallback || connected || closed) return
    try {
      client?.end(true)
    } catch {
      /* already gone */
    }
    client = null
    fallback = broadcastTransport(roomId, onMessage)
    queued.splice(0).forEach((m) => fallback!.send(m))
  }

  // mqtt.js keeps retrying forever; if the first attempt hasn't landed, degrade
  const timer = setTimeout(degrade, 9000)

  /*
    mqtt.js is ~1.5MB of source and by far the largest thing this app depends
    on, and until this import was deferred it was in the entry chunk: every
    cold start downloaded, parsed and executed a broker client, on every device,
    for a feature most sessions never touch. It is pulled in here, at the moment
    someone actually joins a room. Nothing upstream has to wait for it — sends
    queue exactly as they already did before the socket opened.
  */
  void import('mqtt')
    .then(({ default: mqtt }) => {
      if (closed || fallback) return
      const c = mqtt.connect(url, {
        connectTimeout: 8000,
        reconnectPeriod: 4000,
        // a random client id per tab so the broker keeps our sessions distinct
        clientId: `pureplay_${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
      })
      client = c
      c.on('connect', () => {
        connected = true
        c.subscribe(topic)
        queued.splice(0).forEach((m) => c.publish(topic, JSON.stringify(m)))
      })
      c.on('message', (_topic, payload) => {
        try {
          onMessage(JSON.parse(payload.toString()) as RoomMessage)
        } catch {
          /* ignore malformed frames */
        }
      })
      c.on('error', degrade)
    })
    // an offline device can't fetch the chunk at all — same outcome as a broker
    // that won't answer, so take the same fallback
    .catch(degrade)

  return {
    send(msg) {
      if (fallback) return fallback.send(msg)
      if (connected && client) client.publish(topic, JSON.stringify(msg))
      else queued.push(msg)
    },
    close() {
      closed = true
      clearTimeout(timer)
      if (fallback) fallback.close()
      else
        try {
          client?.end(true)
        } catch {
          /* already gone */
        }
    },
  }
}

export function connectRoom(roomId: string, onMessage: Handler): RoomTransport {
  const wsUrl = import.meta.env.VITE_ROOM_WS as string | undefined
  // Explicit self-hosted relay wins; otherwise the zero-config public broker.
  return wsUrl
    ? wsTransport(wsUrl, roomId, onMessage)
    : mqttTransport(roomId, onMessage)
}

/* ── Clock sync ─────────────────────────────────────────────────────────────
   Every position we receive is stamped with the *sender's* wall clock, and two
   phones can disagree by seconds without either being wrong. Measuring that
   disagreement is what turns "roughly together" into "the same second". */

export interface ClockSample {
  /** round-trip time of the probe, ms — lower samples are more trustworthy */
  rtt: number
  /** hostClock - myClock, ms */
  offset: number
}

/**
 * NTP's estimator, minus the ceremony: with `t0` when we asked, `t1` when the
 * host answered (host clock) and `t2` now, the offset is the difference between
 * the host's stamp and the midpoint of our own two, and the error is bounded by
 * half the round trip.
 */
export function clockSample(t0: number, t1: number, t2 = Date.now()): ClockSample {
  return { rtt: t2 - t0, offset: t1 - (t0 + t2) / 2 }
}

/**
 * Pick an offset from a set of samples: the one with the lowest round trip.
 * Averaging is the wrong move — a single slow round trip skews an average,
 * while the fastest exchange is the one least distorted by queuing.
 */
export function bestOffset(samples: ClockSample[]): number {
  if (!samples.length) return 0
  return samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset
}

/** Samples older than this many entries are dropped. */
export const CLOCK_SAMPLE_WINDOW = 8

/**
 * Given the controller's reported position and when it was reported, work out
 * where a follower *should* be right now.
 *
 * `offsetMs` is the measured difference between the two clocks (see
 * clockSample). With it applied, `elapsed` is real transit time; the clamp then
 * only has to catch pathological cases (a sleeping laptop, a wildly wrong
 * clock before the first probe lands) rather than routine skew.
 */
export const MAX_PLAUSIBLE_LATENCY = 3

export function expectedPosition(
  hostPosition: number,
  sentAt: number,
  playing: boolean,
  offsetMs = 0,
): number {
  if (!playing) return hostPosition
  const elapsed = (Date.now() + offsetMs - sentAt) / 1000
  const trusted = Math.min(Math.max(0, elapsed), MAX_PLAUSIBLE_LATENCY)
  return hostPosition + trusted
}

/**
 * Playback-rate trim for small drift.
 *
 * Seeking to fix a fifth of a second is worse than the problem — it clicks, and
 * on a buffering stream it can stall. Running fractionally fast or slow closes
 * the same gap silently, which is how broadcast playout has always done it.
 *
 * @param delta seconds we are BEHIND the controller (negative = ahead)
 */
export function trimRate(delta: number): number {
  const trim = Math.max(-MAX_RATE_TRIM, Math.min(MAX_RATE_TRIM, delta * 0.35))
  return 1 + trim
}

/** Human-friendly room codes — unambiguous characters only. */
export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

/* ── Identity + session persistence ─────────────────────────────────────────
   A reload used to mint a brand-new member id, so every refresh looked like a
   stranger arriving and the person who left never came back. The id below is
   per-device and survives reloads, which is what makes "the host refreshed"
   distinguishable from "the host left". */

const IDENTITY_KEY = 'lf:room:identity'
const SESSION_KEY = 'lf:room:session'
const NAME_KEY = 'lf:name'

/** Offer to resume a room for this long after the page went away. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export interface RoomSession {
  roomId: string
  name: string
  /** who this device believed the host was */
  hostId: string | null
  /** the election term that belief came from */
  term: number
  wasHost: boolean
  controlMode: ControlMode
  /** when the session was last written */
  at: number
}

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // private mode — the room still works for this session
  }
}

function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

function dropStore(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* private mode */
  }
}

/**
 * This tab's member id: minted once, reused across reloads of the same tab.
 *
 * Deliberately sessionStorage rather than localStorage. It has to survive a
 * reload — that is the whole point, and the reason a refresh no longer reads as
 * a stranger arriving — but it must NOT be shared between two tabs on one
 * device: they are two listeners, and giving them one identity would make each
 * treat the other's messages as its own echo and quietly stop syncing.
 *
 * A tab that is closed and reopened does get a new id, and that is correct —
 * that member really did leave. Their room comes back to them through the saved
 * session and the election term, not through the id.
 */
export function stableMemberId(): string {
  const mint = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `m_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
  try {
    const existing = sessionStorage.getItem(IDENTITY_KEY)
    if (existing) return existing
    const id = mint()
    sessionStorage.setItem(IDENTITY_KEY, id)
    return id
  } catch {
    return mint() // private mode: a fresh id per load is the best we can do
  }
}

export function savedName(): string {
  return readStore(NAME_KEY) ?? ''
}

export function rememberName(name: string) {
  writeStore(NAME_KEY, name)
}

export function saveSession(session: RoomSession) {
  writeStore(SESSION_KEY, JSON.stringify(session))
}

/** The room this device was last in, if it's recent enough to offer resuming. */
export function loadSession(): RoomSession | null {
  const raw = readStore(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as RoomSession
    if (!parsed?.roomId || typeof parsed.at !== 'number') return null
    if (Date.now() - parsed.at > SESSION_TTL_MS) {
      dropStore(SESSION_KEY)
      return null
    }
    return parsed
  } catch {
    dropStore(SESSION_KEY)
    return null
  }
}

export function clearSession() {
  dropStore(SESSION_KEY)
}
