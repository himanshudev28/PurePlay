import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Users, Copy, Check, Send, LogOut, Crown, Radio, Pencil, Lock, Unlock } from 'lucide-react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'
import { useRoom } from '@/store/room'
import { generateRoomCode, DRIFT_DEADZONE } from '@/lib/room'
import { Button, EmptyState, Artwork } from '@/components/ui'

export default function Room() {
  const [params, setParams] = useSearchParams()
  const urlId = params.get('id') ?? ''

  const roomId = useRoom((s) => s.roomId)
  const savedName = useRoom((s) => s.name)
  const join = useRoom((s) => s.join)
  const [name, setName] = useState(savedName)

  // Keep the URL in step with the live room so invite links and reloads work.
  useEffect(() => {
    if (roomId && urlId !== roomId) setParams({ id: roomId })
  }, [roomId, urlId, setParams])

  // Returning to a shared link (or reload) while a name is known rejoins
  // automatically instead of dropping the user back on the lobby.
  useEffect(() => {
    if (!roomId && urlId && savedName.trim()) join(urlId.toUpperCase(), savedName.trim())
  }, [roomId, urlId, savedName, join])

  if (!roomId) {
    return <RoomLobby urlId={urlId} name={name} setName={setName} onJoin={(id) => join(id, name.trim() || 'Guest')} />
  }
  return <RoomSession />
}

function RoomLobby({
  urlId, name, setName, onJoin,
}: {
  urlId: string
  name: string
  setName: (v: string) => void
  onJoin: (id: string) => void
}) {
  const [code, setCode] = useState(urlId)

  const join = (id: string) => {
    const trimmed = id.trim().toUpperCase()
    if (!trimmed) return
    onJoin(trimmed)
  }

  const usingBroker = !import.meta.env.VITE_ROOM_WS

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
            className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-850 px-4 py-2.5 font-mono tracking-[0.25em] text-white uppercase placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
          <Button variant="solid" onClick={() => join(code)} disabled={!code.trim()} className="shrink-0">
            Join
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-ink-400">
        {usingBroker
          ? 'Rooms sync over the internet — share the code with anyone, on any device.'
          : 'Connected to your own sync server.'}
      </p>
    </div>
  )
}

function RoomSession() {
  const roomId = useRoom((s) => s.roomId) ?? ''
  const name = useRoom((s) => s.name)
  const members = useRoom((s) => s.members)
  const chat = useRoom((s) => s.chat)
  const isHost = useRoom((s) => s.isHost)
  const controlMode = useRoom((s) => s.controlMode)
  const canControl = useRoom((s) => s.canControl)
  const drift = useRoom((s) => s.drift)
  const myId = useRoom((s) => s.myId)
  const leave = useRoom((s) => s.leave)
  const sendChat = useRoom((s) => s.sendChat)
  const setControlMode = useRoom((s) => s.setControlMode)
  const setName = useRoom((s) => s.setName)

  const current = usePlayer((s) => s.current)

  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(name)
  const chatEnd = useRef<HTMLDivElement>(null)

  const saveName = () => {
    const n = nameDraft.trim()
    if (n) setName(n)
    setEditingName(false)
  }

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat])

  const submit = () => {
    if (!draft.trim()) return
    sendChat(draft)
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
            <Button size="sm" variant="ghost" onClick={leave}>
              <LogOut size={13} />
              Leave
            </Button>
          </div>
        </header>

        {current ? (
          <div className="flex items-center gap-4 rounded-2xl border border-ink-800 bg-ink-900/60 p-5">
            <Artwork src={current.artwork} alt={current.title} className="h-20 w-20" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-white">{current.title}</p>
              <p className="truncate text-sm text-ink-400">{current.artist}</p>
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
                ? 'Play any track and everyone in the room hears it at the same moment. You can browse other pages — the room stays connected.'
                : 'Playback will start automatically when the host presses play.'
            }
          />
        )}

        {/* Who can control playback */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-800 bg-ink-900/60 p-4">
          <div className="flex items-center gap-2.5 text-sm">
            {controlMode === 'everyone' ? (
              <Unlock size={17} className="shrink-0 text-accent" />
            ) : (
              <Lock size={17} className="shrink-0 text-ink-400" />
            )}
            <div>
              <p className="font-medium text-white">
                {controlMode === 'everyone' ? 'Everyone can control playback' : 'Only the host controls playback'}
              </p>
              <p className="text-xs text-ink-400">
                {isHost
                  ? 'Choose who can play, pause and change tracks for the room.'
                  : canControl
                    ? 'You can control playback for everyone.'
                    : 'The host is in charge of playback.'}
              </p>
            </div>
          </div>
          {isHost && (
            <div className="flex shrink-0 items-center gap-1 rounded-full bg-ink-850 p-1">
              {(['host', 'everyone'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setControlMode(mode)}
                  aria-pressed={controlMode === mode}
                  className={clsx(
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    controlMode === mode ? 'bg-accent text-ink-950' : 'text-ink-300 hover:text-white',
                  )}
                >
                  {mode === 'host' ? 'Host only' : 'Everyone'}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">In the room · {members.length + 1}</h3>
          <div className="flex flex-wrap gap-2">
            {editingName ? (
              <span className="flex items-center gap-1 rounded-full bg-ink-800 py-1 pr-1 pl-3">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  onBlur={saveName}
                  maxLength={24}
                  aria-label="Your name"
                  className="w-28 bg-transparent text-xs text-white focus:outline-none"
                />
                <button onClick={saveName} className="rounded-full p-1 text-accent hover:bg-ink-700" aria-label="Save name">
                  <Check size={12} />
                </button>
              </span>
            ) : (
              <button
                onClick={() => {
                  setNameDraft(name)
                  setEditingName(true)
                }}
                className="group flex items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1.5 text-xs text-white hover:bg-ink-700"
                title="Change your name"
              >
                {isHost && <Crown size={11} className="text-accent" />}
                {name || 'You'} (you)
                <Pencil size={11} className="text-ink-400 group-hover:text-white" />
              </button>
            )}
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
            <div key={`${c.at}-${i}`} className={clsx(c.id === myId && 'text-right')}>
              <p className="text-[11px] text-ink-400">{c.id === myId ? 'You' : c.name}</p>
              <p
                className={clsx(
                  'mt-0.5 inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-sm',
                  c.id === myId ? 'bg-accent text-ink-950' : 'bg-ink-800 text-ink-200',
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
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Message…"
            className="flex-1 rounded-full border border-ink-700 bg-ink-850 px-3.5 py-2 text-sm text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
          <button
            onClick={submit}
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
