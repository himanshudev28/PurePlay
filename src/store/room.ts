import { create } from 'zustand'
import {
  connectRoom, expectedPosition, HARD_SEEK_THRESHOLD, DRIFT_DEADZONE,
  type RoomMessage, type RoomMember, type RoomTransport,
} from '@/lib/room'
import { usePlayer } from './player'

export interface ChatLine {
  id: string
  name: string
  text: string
  at: number
}

interface RoomState {
  /** null when not in a room */
  roomId: string | null
  name: string
  myId: string
  members: RoomMember[]
  chat: ChatLine[]
  isHost: boolean
  /** last measured drift from the host, in seconds (followers only) */
  drift: number

  join: (roomId: string, name: string) => void
  leave: () => void
  sendChat: (text: string) => void
}

/*
  The connection lives at module scope, NOT inside the /room route component.
  That's the whole point: you can leave the Rooms page to pick a song and the
  room stays connected and in sync — only an explicit Leave tears it down.
  Player sync runs here too (host broadcasts, followers reconcile), driven by
  the store rather than React, so it keeps working on any page.
*/
let transport: RoomTransport | null = null
let greeted = new Set<string>()
let unsubPlayer: (() => void) | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null

const ACTIVE_KEY = 'lf:room:active'

function broadcastState() {
  const p = usePlayer.getState()
  transport?.send({
    type: 'state',
    track: p.current,
    position: p.position,
    playing: p.playing,
    at: Date.now(),
  })
}

function stopHosting() {
  unsubPlayer?.()
  unsubPlayer = null
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

function startHosting() {
  stopHosting()
  broadcastState()
  // Re-broadcast whenever the track or play/pause changes. Position is left to
  // followers to extrapolate, corrected by the heartbeat, so we don't flood.
  unsubPlayer = usePlayer.subscribe((s, prev) => {
    if (s.current !== prev.current || s.playing !== prev.playing) broadcastState()
  })
  heartbeat = setInterval(broadcastState, 5000)
}

export const useRoom = create<RoomState>((set, get) => ({
  roomId: null,
  name: (() => {
    try {
      return localStorage.getItem('lf:name') ?? ''
    } catch {
      return ''
    }
  })(),
  myId: crypto.randomUUID(),
  members: [],
  chat: [],
  isHost: false,
  drift: 0,

  join(roomId, name) {
    // tear down any prior session first
    get().leave()

    const myId = crypto.randomUUID()
    greeted = new Set()
    set({ roomId, name, myId, members: [], chat: [], isHost: false, drift: 0 })

    const me: RoomMember = { id: myId, name, isHost: false }

    /** Host = lowest id in the room. Deterministic, no timer, re-run on change. */
    const recomputeHost = () => {
      const ids = [get().myId, ...get().members.map((m) => m.id)].sort()
      const host = ids[0] === get().myId
      const wasHost = get().isHost
      if (host === wasHost) return
      set({ isHost: host })
      if (host) startHosting()
      else stopHosting()
    }

    const applyRemoteState = (msg: Extract<RoomMessage, { type: 'state' }>) => {
      const p = usePlayer.getState()
      const target = expectedPosition(msg.position, msg.at, msg.playing)
      const sameTrack =
        p.current && msg.track && p.current.id === msg.track.id && p.current.source === msg.track.source

      if (msg.track && !sameTrack) {
        void p.playTrack(msg.track).then(() => {
          const after = usePlayer.getState()
          after.seek(target)
          if (!msg.playing && after.playing) after.toggle()
        })
        return
      }
      if (!msg.track) return

      const delta = target - p.position
      set({ drift: delta })
      if (Math.abs(delta) > HARD_SEEK_THRESHOLD) p.seek(target)
      else if (Math.abs(delta) > DRIFT_DEADZONE) p.seek(p.position + delta * 0.5)
      if (msg.playing !== p.playing) p.toggle()
    }

    const handle = (msg: RoomMessage) => {
      switch (msg.type) {
        case 'join': {
          if (msg.member.id === get().myId) return
          set((s) =>
            s.members.some((x) => x.id === msg.member.id) ? s : { members: [...s.members, msg.member] },
          )
          // greet a newcomer exactly once, or two peers ping-pong forever
          if (!greeted.has(msg.member.id)) {
            greeted.add(msg.member.id)
            transport?.send({ type: 'join', member: { ...me, isHost: get().isHost }, at: Date.now() })
          }
          recomputeHost()
          break
        }
        case 'leave':
          greeted.delete(msg.memberId)
          set((s) => ({ members: s.members.filter((x) => x.id !== msg.memberId) }))
          recomputeHost()
          break
        case 'sync-request':
          if (get().isHost) broadcastState()
          break
        case 'state':
          if (get().isHost) return // the host is the source of truth
          applyRemoteState(msg)
          break
        case 'chat':
          if (msg.memberId === get().myId) return // our own is already shown
          set((s) => ({
            chat: [...s.chat, { id: msg.memberId, name: msg.name, text: msg.text, at: msg.at }],
          }))
          break
      }
    }

    transport = connectRoom(roomId, handle)
    transport.send({ type: 'join', member: me, at: Date.now() })
    transport.send({ type: 'sync-request', memberId: myId, at: Date.now() })
    recomputeHost() // solo → become host immediately

    try {
      localStorage.setItem(ACTIVE_KEY, roomId)
      localStorage.setItem('lf:name', name)
    } catch {
      /* private mode — the room still works for this session */
    }
  },

  leave() {
    if (transport) {
      transport.send({ type: 'leave', memberId: get().myId, at: Date.now() })
      transport.close()
      transport = null
    }
    stopHosting()
    greeted = new Set()
    set({ roomId: null, members: [], chat: [], isHost: false, drift: 0 })
    try {
      localStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* ignore */
    }
  },

  sendChat(text) {
    const t = text.trim()
    if (!t || !transport) return
    const { myId, name } = get()
    const at = Date.now()
    transport.send({ type: 'chat', memberId: myId, name, text: t, at })
    set((s) => ({ chat: [...s.chat, { id: myId, name, text: t, at }] }))
  },
}))
