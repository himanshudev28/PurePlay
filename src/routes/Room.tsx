import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Users, Copy, Check, Send, LogOut, Crown, Radio } from 'lucide-react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'
import {
  connectRoom, generateRoomCode, expectedPosition,
  HARD_SEEK_THRESHOLD, DRIFT_DEADZONE,
  type RoomMessage, type RoomMember, type RoomTransport,
} from '@/lib/room'
import { Button, EmptyState, Artwork } from '@/components/ui'

interface ChatLine { id: string; name: string; text: string; at: number }

export default function Room() {
  const [params, setParams] = useSearchParams()
  const roomId = params.get('id') ?? ''
  const [name, setName] = useState(() => localStorage.getItem('lf:name') ?? '')
  const [joined, setJoined] = useState(false)

  if (!joined) {
    return <RoomLobby roomId={roomId} name={name} setName={setName} onJoin={(id) => { setParams({ id }); setJoined(true) }} />
  }
  return <RoomSession roomId={roomId} name={name} onLeave={() => { setJoined(false); setParams({}) }} />
}

function RoomLobby({
  roomId, name, setName, onJoin,
}: {
  roomId: string
  name: string
  setName: (v: string) => void
  onJoin: (id: string) => void
}) {
  const [code, setCode] = useState(roomId)

  const join = (id: string) => {
    const trimmed = name.trim() || 'Guest'
    localStorage.setItem('lf:name', trimmed)
    onJoin(id.trim().toUpperCase())
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-8">
      <header className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-dim text-accent">
          <Users size={26} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Listening rooms</h1>
        <p className="mt-2 text-sm text-ink-400">
          Play the same song, at the same second, with anyone. The host controls playback.
        </p>
      </header>

      <div className="space-y-4 rounded-2xl border border-ink-800 bg-ink-900/60 p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-300">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Who's listening?"
            className="w-full rounded-xl border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
        </div>

        <Button variant="accent" size="lg" className="w-full" onClick={() => join(generateRoomCode())}>
          <Radio size={16} />
          Start a new room
        </Button>

        <div className="flex items-center gap-3 text-xs text-ink-400">
          <span className="h-px flex-1 bg-ink-800" />
          or join one
          <span className="h-px flex-1 bg-ink-800" />
        </div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && code.trim() && join(code)}
            placeholder="ROOM CODE"
            maxLength={6}
            // min-w-0 defeats the flex item's default min-width:auto — the
            // wide-tracked monospace placeholder set a min-content floor that
            // pushed the Join button 39px past the viewport on small phones
            className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-850 px-4 py-2.5 font-mono tracking-[0.25em] text-white uppercase placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
          <Button variant="solid" onClick={() => join(code)} disabled={!code.trim()} className="shrink-0">
            Join
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-ink-400">
        {import.meta.env.VITE_ROOM_WS
          ? 'Connected to a live sync server.'
          : 'No sync server configured — rooms sync across tabs on this device. Set VITE_ROOM_WS to go multi-user.'}
      </p>
    </div>
  )
}

function RoomSession({ roomId, name, onLeave }: { roomId: string; name: string; onLeave: () => void }) {
  const [members, setMembers] = useState<RoomMember[]>([])
  const [chat, setChat] = useState<ChatLine[]>([])
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [drift, setDrift] = useState(0)

  const transport = useRef<RoomTransport | null>(null)
  const meId = useRef(crypto.randomUUID())
  const chatEnd = useRef<HTMLDivElement>(null)
  const isHostRef = useRef(false)
  /** ids we've already greeted, so a join reply can't ping-pong forever */
  const greeted = useRef<Set<string>>(new Set())

  const player = usePlayer()

  const send = useCallback((msg: RoomMessage) => transport.current?.send(msg), [])

  useEffect(() => {
    isHostRef.current = isHost
  }, [isHost])

  /* ---- connect ---- */
  useEffect(() => {
    const me: RoomMember = { id: meId.current, name, isHost: false }
    const seen = greeted.current
    seen.clear()

    const handle = (msg: RoomMessage) => {
      switch (msg.type) {
        case 'join': {
          if (msg.member.id === meId.current) return

          setMembers((m) => (m.some((x) => x.id === msg.member.id) ? m : [...m, msg.member]))

          // Reply ONLY the first time we see someone. Replying to every join
          // is an infinite storm: our reply is itself a join, which they reply
          // to, which we reply to... two members are enough to peg the CPU.
          if (!seen.has(msg.member.id)) {
            seen.add(msg.member.id)
            send({ type: 'join', member: { ...me, isHost: isHostRef.current }, at: Date.now() })
          }

          // Deterministic host election: lowest id in the room wins. No timer,
          // no race — everyone independently computes the same answer, and it
          // re-runs on every membership change so a host leaving is covered.
          break
        }
        case 'leave':
          seen.delete(msg.memberId)
          setMembers((m) => m.filter((x) => x.id !== msg.memberId))
          break
        case 'sync-request':
          if (isHostRef.current) broadcastState()
          break
        case 'state': {
          if (isHostRef.current) return // the host is the source of truth
          applyRemoteState(msg)
          break
        }
        case 'chat':
          // our own message was already appended optimistically; a relay that
          // echoes to the whole room would otherwise show it twice
          if (msg.memberId === meId.current) return
          setChat((c) => [...c, { id: msg.memberId, name: msg.name, text: msg.text, at: msg.at }])
          break
      }
    }

    transport.current = connectRoom(roomId, handle)

    send({ type: 'join', member: me, at: Date.now() })
    send({ type: 'sync-request', memberId: meId.current, at: Date.now() })

    return () => {
      send({ type: 'leave', memberId: meId.current, at: Date.now() })
      transport.current?.close()
      transport.current = null
      seen.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, name])

  /**
   * Host = lowest member id present. Computed from state rather than elected by
   * timer, so it can never produce zero hosts (a timing tie) or two hosts (a
   * slow relay), and it re-elects automatically when the host disconnects.
   */
  useEffect(() => {
    const lowest = [meId.current, ...members.map((m) => m.id)].sort()[0]
    setIsHost(lowest === meId.current)
  }, [members])

  /* ---- host broadcasts state on every change ---- */
  const broadcastState = useCallback(() => {
    const p = usePlayer.getState()
    send({ type: 'state', track: p.current, position: p.position, playing: p.playing, at: Date.now() })
  }, [send])

  useEffect(() => {
    if (!isHost) return
    broadcastState()
    // deliberately not depending on `position` — that would flood the channel.
    // followers extrapolate between these updates instead.
  }, [isHost, player.current, player.playing, broadcastState])

  // periodic heartbeat so followers can correct accumulated drift
  useEffect(() => {
    if (!isHost) return
    const t = setInterval(broadcastState, 5000)
    return () => clearInterval(t)
  }, [isHost, broadcastState])

  /* ---- followers reconcile against the host ---- */
  const applyRemoteState = useCallback((msg: Extract<RoomMessage, { type: 'state' }>) => {
    const p = usePlayer.getState()
    const target = expectedPosition(msg.position, msg.at, msg.playing)

    // different track — load it, then line up with the host
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

    // same track — correct drift only when it's worth the interruption
    const delta = target - p.position
    setDrift(delta)
    if (Math.abs(delta) > HARD_SEEK_THRESHOLD) {
      p.seek(target)
    } else if (Math.abs(delta) > DRIFT_DEADZONE) {
      // small drift: nudge rather than seek, so audio doesn't glitch
      p.seek(p.position + delta * 0.5)
    }

    if (msg.playing !== p.playing) p.toggle()
  }, [])

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat])

  const sendChat = () => {
    const text = draft.trim()
    if (!text) return
    const line = { type: 'chat' as const, memberId: meId.current, name, text, at: Date.now() }
    send(line)
    setChat((c) => [...c, { id: meId.current, name, text, at: line.at }])
    setDraft('')
  }

  const copyLink = () => {
    void navigator.clipboard.writeText(`${location.origin}/room?id=${roomId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-800 bg-ink-900/60 p-4">
          <div>
            <p className="text-xs tracking-[0.2em] text-ink-400 uppercase">Room</p>
            <p className="font-mono text-2xl tracking-[0.25em] text-white">{roomId}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
                isHost ? 'bg-accent-dim text-accent' : 'bg-ink-800 text-ink-300',
              )}
            >
              {isHost && <Crown size={12} />}
              {isHost ? 'Host' : 'Listener'}
            </span>
            <Button size="sm" variant="outline" onClick={copyLink}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Invite'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onLeave}>
              <LogOut size={13} />
              Leave
            </Button>
          </div>
        </header>

        {player.current ? (
          <div className="flex items-center gap-4 rounded-2xl border border-ink-800 bg-ink-900/60 p-5">
            <Artwork src={player.current.artwork} alt={player.current.title} className="h-20 w-20" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-white">{player.current.title}</p>
              <p className="truncate text-sm text-ink-400">{player.current.artist}</p>
              <p className="mt-1.5 text-xs text-ink-400">
                {isHost
                  ? 'You control playback for everyone.'
                  : `Following the host${Math.abs(drift) > DRIFT_DEADZONE ? ` · correcting ${drift.toFixed(1)}s` : ' · in sync'}`}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Radio size={28} />}
            title={isHost ? 'Pick something to play' : 'Waiting for the host'}
            hint={
              isHost
                ? 'Play any track and everyone in the room hears it at the same moment.'
                : 'Playback will start automatically when the host presses play.'
            }
          />
        )}

        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">In the room · {members.length + 1}</h3>
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1.5 text-xs text-white">
              {isHost && <Crown size={11} className="text-accent" />}
              {name || 'You'} (you)
            </span>
            {members.map((m) => (
              <span key={m.id} className="rounded-full bg-ink-800 px-3 py-1.5 text-xs text-ink-300">
                {m.name}
              </span>
            ))}
          </div>
        </section>
      </div>

      {/* chat */}
      <aside className="flex h-[520px] flex-col rounded-2xl border border-ink-800 bg-ink-900/60">
        <h3 className="border-b border-ink-800 px-4 py-3 text-sm font-semibold text-white">Chat</h3>
        <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-4">
          {chat.length === 0 && <p className="text-xs text-ink-400">Say something to the room.</p>}
          {chat.map((c, i) => (
            <div key={`${c.at}-${i}`} className={clsx(c.id === meId.current && 'text-right')}>
              <p className="text-[11px] text-ink-400">{c.id === meId.current ? 'You' : c.name}</p>
              <p
                className={clsx(
                  'mt-0.5 inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-sm',
                  c.id === meId.current ? 'bg-accent text-ink-950' : 'bg-ink-800 text-ink-200',
                )}
              >
                {c.text}
              </p>
            </div>
          ))}
          <div ref={chatEnd} />
        </div>
        <div className="flex gap-2 border-t border-ink-800 p-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendChat()}
            placeholder="Message…"
            className="flex-1 rounded-full border border-ink-700 bg-ink-850 px-3.5 py-2 text-sm text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
          <button
            onClick={sendChat}
            disabled={!draft.trim()}
            className="rounded-full bg-accent p-2.5 text-ink-950 transition hover:bg-accent-soft disabled:opacity-40"
          >
            <Send size={15} />
          </button>
        </div>
      </aside>
    </div>
  )
}
