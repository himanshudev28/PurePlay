import { create } from 'zustand'
import {
  connectRoom, expectedPosition, HARD_SEEK_THRESHOLD, DRIFT_DEADZONE,
  type RoomMessage, type RoomMember, type RoomTransport, type ControlMode,
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
  /** who the host has allowed to drive playback */
  controlMode: ControlMode
  /** true when this member may currently control playback */
  canControl: boolean
  /** last measured drift from the current controller, in seconds */
  drift: number
  /** a message to surface on the lobby, e.g. after being removed */
  notice: string | null

  join: (roomId: string, name: string) => void
  leave: () => void
  sendChat: (text: string) => void
  /** host-only: let everyone control, or restrict to the host */
  setControlMode: (mode: ControlMode) => void
  /** anyone: change your display name, live */
  setName: (name: string) => void
  /** host-only: remove a member from the room */
  kick: (memberId: string) => void
  clearNotice: () => void
}

/*
  The connection lives at module scope, NOT inside the /room route component, so
  leaving the Rooms page to pick a song keeps the room connected and in sync —
  only an explicit Leave tears it down. Player sync runs here too, driven by the
  store rather than React, so it works on every page.
*/
let transport: RoomTransport | null = null
let greeted = new Set<string>()
let unsubPlayer: (() => void) | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
/* True while we're applying a remote update, so the player subscription doesn't
   rebroadcast it and start an echo loop between controllers. */
let applyingRemote = false

const ACTIVE_KEY = 'lf:room:active'

function broadcastState() {
  const p = usePlayer.getState()
  const { myId } = useRoom.getState()
  transport?.send({
    type: 'state',
    track: p.current,
    position: p.position,
    playing: p.playing,
    by: myId,
    at: Date.now(),
  })
}

function stopPlayerBroadcast() {
  unsubPlayer?.()
  unsubPlayer = null
}

function startPlayerBroadcast() {
  if (unsubPlayer) return
  // Re-broadcast on track / play-pause changes (not position — followers
  // extrapolate that, corrected by the heartbeat). Skip changes we caused by
  // applying someone else's update.
  unsubPlayer = usePlayer.subscribe((s, prev) => {
    if (applyingRemote) return
    if (s.current !== prev.current || s.playing !== prev.playing) broadcastState()
  })
}

function stopHeartbeat() {
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

function startHeartbeat() {
  if (!heartbeat) heartbeat = setInterval(broadcastState, 5000)
}

/** Reconcile broadcasting/heartbeat with the current host + control settings. */
function syncCapabilities() {
  const { isHost, controlMode } = useRoom.getState()
  const canControl = isHost || controlMode === 'everyone'
  useRoom.setState({ canControl })

  if (canControl) startPlayerBroadcast()
  else stopPlayerBroadcast()

  // The host stays the drift clock regardless — it heartbeats the room.
  if (isHost) startHeartbeat()
  else stopHeartbeat()
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
  controlMode: 'host',
  canControl: false,
  drift: 0,
  notice: null,

  join(roomId, name) {
    get().leave() // tear down any prior session first

    const myId = crypto.randomUUID()
    greeted = new Set()
    set({ roomId, name, myId, members: [], chat: [], isHost: false, controlMode: 'host', canControl: false, drift: 0, notice: null })

    const meMember = (): RoomMember => ({ id: myId, name: get().name, isHost: get().isHost })

    /** Host = lowest id in the room. Deterministic, re-run on every change. */
    const recomputeHost = () => {
      const ids = [myId, ...get().members.map((m) => m.id)].sort()
      const host = ids[0] === myId
      if (host === get().isHost) return
      set({ isHost: host })
      syncCapabilities()
      if (host) {
        // a fresh host announces the current state + rules to the room
        broadcastState()
        transport?.send({ type: 'control-mode', mode: get().controlMode, at: Date.now() })
      }
    }

    const applyRemoteState = (msg: Extract<RoomMessage, { type: 'state' }>) => {
      applyingRemote = true
      const clear = (ms: number) => setTimeout(() => { applyingRemote = false }, ms)

      const p = usePlayer.getState()
      const target = expectedPosition(msg.position, msg.at, msg.playing)
      const sameTrack =
        p.current && msg.track && p.current.id === msg.track.id && p.current.source === msg.track.source

      if (msg.track && !sameTrack) {
        void p.playTrack(msg.track).then(() => {
          const after = usePlayer.getState()
          after.seek(target)
          if (!msg.playing && after.playing) after.toggle()
          clear(400)
        })
        return
      }
      if (!msg.track) {
        clear(0)
        return
      }

      const delta = target - p.position
      set({ drift: delta })
      if (Math.abs(delta) > HARD_SEEK_THRESHOLD) p.seek(target)
      else if (Math.abs(delta) > DRIFT_DEADZONE) p.seek(p.position + delta * 0.5)
      if (msg.playing !== p.playing) p.toggle()
      clear(60)
    }

    const handle = (msg: RoomMessage) => {
      switch (msg.type) {
        case 'join': {
          if (msg.member.id === myId) return
          set((s) =>
            s.members.some((x) => x.id === msg.member.id) ? s : { members: [...s.members, msg.member] },
          )
          if (!greeted.has(msg.member.id)) {
            greeted.add(msg.member.id)
            transport?.send({ type: 'join', member: meMember(), at: Date.now() })
            // bring the newcomer up to speed on the rules if we're the host
            if (get().isHost) {
              transport?.send({ type: 'control-mode', mode: get().controlMode, at: Date.now() })
              broadcastState()
            }
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
          if (get().canControl) broadcastState()
          if (get().isHost) transport?.send({ type: 'control-mode', mode: get().controlMode, at: Date.now() })
          break
        case 'state':
          if (msg.by === myId) return // our own echo
          applyRemoteState(msg)
          break
        case 'control-mode':
          set({ controlMode: msg.mode })
          syncCapabilities()
          break
        case 'rename':
          set((s) => ({
            members: s.members.map((m) => (m.id === msg.memberId ? { ...m, name: msg.name } : m)),
          }))
          break
        case 'kick':
          if (msg.memberId === myId) {
            // it's us — leave, and remember why so the lobby can explain it
            get().leave()
            set({ notice: 'The host removed you from the room.' })
          } else {
            greeted.delete(msg.memberId)
            set((s) => ({ members: s.members.filter((m) => m.id !== msg.memberId) }))
            recomputeHost()
          }
          break
        case 'chat':
          if (msg.memberId === myId) return // our own is already shown
          set((s) => ({
            chat: [...s.chat, { id: msg.memberId, name: msg.name, text: msg.text, at: msg.at }],
          }))
          break
      }
    }

    transport = connectRoom(roomId, handle)
    transport.send({ type: 'join', member: meMember(), at: Date.now() })
    transport.send({ type: 'sync-request', memberId: myId, at: Date.now() })
    recomputeHost() // solo → become host immediately
    syncCapabilities()

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
    stopPlayerBroadcast()
    stopHeartbeat()
    applyingRemote = false
    greeted = new Set()
    set({ roomId: null, members: [], chat: [], isHost: false, controlMode: 'host', canControl: false, drift: 0 })
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

  setControlMode(mode) {
    if (!get().isHost) return // only the host sets the rules
    set({ controlMode: mode })
    transport?.send({ type: 'control-mode', mode, at: Date.now() })
    syncCapabilities()
  },

  setName(name) {
    const n = name.trim()
    if (!n) return
    set({ name: n })
    try {
      localStorage.setItem('lf:name', n)
    } catch {
      /* ignore */
    }
    transport?.send({ type: 'rename', memberId: get().myId, name: n, at: Date.now() })
  },

  kick(memberId) {
    if (!get().isHost) return // only the host can remove members
    transport?.send({ type: 'kick', memberId, at: Date.now() })
    greeted.delete(memberId)
    set((s) => ({ members: s.members.filter((m) => m.id !== memberId) }))
  },

  clearNotice: () => set({ notice: null }),
}))
