import mqtt from 'mqtt'
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
}

export type RoomMessage =
  | { type: 'join'; member: RoomMember; at: number }
  | { type: 'leave'; memberId: string; at: number }
  | { type: 'members'; members: RoomMember[]; at: number }
  /** authoritative playback state from the host */
  | { type: 'state'; track: Track | null; position: number; playing: boolean; at: number }
  /** a follower asking the host to re-broadcast (sent on join) */
  | { type: 'sync-request'; memberId: string; at: number }
  | { type: 'chat'; memberId: string; name: string; text: string; at: number }

type Handler = (msg: RoomMessage) => void

export interface RoomTransport {
  send(msg: RoomMessage): void
  close(): void
}

/** If a follower drifts more than this from the host, hard-seek instead of nudging. */
export const HARD_SEEK_THRESHOLD = 2.0
/** Below this, ignore — seeking would be more disruptive than the drift. */
export const DRIFT_DEADZONE = 0.35

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

export function connectRoom(roomId: string, onMessage: Handler): RoomTransport {
  const wsUrl = import.meta.env.VITE_ROOM_WS as string | undefined

  // No server configured — cross-tab only, same as before.
  if (!wsUrl) return broadcastTransport(roomId, onMessage)

  let ws: WebSocket | null = new WebSocket(`${wsUrl}?room=${encodeURIComponent(roomId)}`)
  let opened = false
  let fallback: RoomTransport | null = null
  const queued: RoomMessage[] = []

  // If the server can't be reached, don't leave the room dead — degrade to the
  // cross-tab channel so at least same-device sync keeps working.
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
      // ignore malformed frames rather than tearing the room down
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
 * Given the host's reported position and when it was reported, work out where
 * a follower *should* be right now, accounting for message latency.
 *
 * `sentAt` is stamped with the *host's* clock, so subtracting our own Date.now()
 * measures latency plus any wall-clock skew between the two machines. Skew of
 * several seconds is normal without NTP discipline, and read as drift it would
 * make a follower hard-seek on every heartbeat. So the raw figure is clamped to
 * a plausible network latency: anything larger is a clock difference, not
 * elapsed playback.
 */
export const MAX_PLAUSIBLE_LATENCY = 5

export function expectedPosition(hostPosition: number, sentAt: number, playing: boolean): number {
  if (!playing) return hostPosition
  const elapsed = (Date.now() - sentAt) / 1000
  const trusted = Math.min(Math.max(0, elapsed), MAX_PLAUSIBLE_LATENCY)
  return hostPosition + trusted
}

/** Human-friendly room codes — unambiguous characters only. */
export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}
