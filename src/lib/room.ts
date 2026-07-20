import type { Track } from '@/types'

/**
 * Synced listening rooms.
 *
 * Transport is pluggable. In dev (and with no server configured) we use a
 * BroadcastChannel so you can open two tabs and watch sync work for real.
 * Point VITE_ROOM_WS at a websocket server and the same protocol goes remote —
 * the message shapes below are exactly what the server needs to relay.
 */

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

export function connectRoom(roomId: string, onMessage: Handler): RoomTransport {
  const wsUrl = import.meta.env.VITE_ROOM_WS as string | undefined

  if (wsUrl) {
    const ws = new WebSocket(`${wsUrl}?room=${encodeURIComponent(roomId)}`)
    const queued: RoomMessage[] = []

    ws.addEventListener('open', () => {
      queued.splice(0).forEach((m) => ws.send(JSON.stringify(m)))
    })
    ws.addEventListener('message', (e) => {
      try {
        onMessage(JSON.parse(e.data as string) as RoomMessage)
      } catch {
        // ignore malformed frames rather than tearing the room down
      }
    })

    return {
      send(msg) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
        else queued.push(msg)
      },
      close: () => ws.close(),
    }
  }

  // local fallback — same protocol, cross-tab only
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
