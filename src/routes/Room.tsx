import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Users, Copy, Check, Send, LogOut, Crown, Radio, Pencil, Lock, Unlock, X,
  Wifi, WifiOff, Loader2, PowerOff, History, Signal,
} from 'lucide-react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'
import { useRoom } from '@/store/room'
import { generateRoomCode, DRIFT_DEADZONE } from '@/lib/room'
import { copyText } from '@/lib/clipboard'
import { Button, EmptyState, Artwork } from '@/components/ui'

export default function Room() {
  const [params, setParams] = useSearchParams()
  const urlId = params.get('id') ?? ''

  const roomId = useRoom((s) => s.roomId)
  const savedName = useRoom((s) => s.name)
  const notice = useRoom((s) => s.notice)
  const join = useRoom((s) => s.join)
  const [name, setName] = useState(savedName)

  /*
    An invite for a DIFFERENT room, opened while already in one, is a decision
    the user has to make. Overwriting `?id` with the current room (which is what
    keeping the URL in step used to do unconditionally) silently swallowed the
    link and left them wondering why their friend's code did nothing.
  */
  const pendingInvite = roomId && urlId && urlId !== roomId.toUpperCase() ? urlId.toUpperCase() : null

  // Otherwise keep the URL in step with the live room, so reloads and the
  // invite button both point at the room actually being listened to.
  useEffect(() => {
    if (roomId && !urlId) setParams({ id: roomId }, { replace: true })
  }, [roomId, urlId, setParams])

  // After a kick, drop the invite id from the URL so the auto-rejoin below
  // doesn't immediately pull the removed user straight back in.
  useEffect(() => {
    if (notice && urlId) setParams({})
  }, [notice, urlId, setParams])

  // Returning to a shared link (or reload) while a name is known rejoins
  // automatically instead of dropping the user back on the lobby.
  useEffect(() => {
    if (!roomId && urlId && savedName.trim() && !notice) join(urlId.toUpperCase(), savedName.trim())
  }, [roomId, urlId, savedName, join, notice])

  if (!roomId) {
    return (
      <RoomLobby
        urlId={urlId}
        name={name}
        setName={setName}
        notice={notice}
        onJoin={(id) => join(id, name.trim() || 'Guest')}
        onCreate={(id) => join(id, name.trim() || 'Guest', { create: true })}
      />
    )
  }
  return (
    <RoomSession
      pendingInvite={pendingInvite}
      onSwitch={() => pendingInvite && join(pendingInvite, savedName.trim() || 'Guest')}
      onStay={() => roomId && setParams({ id: roomId }, { replace: true })}
    />
  )
}

/**
 * Leaving must ALSO drop `?id=` from the URL — with the invite id still there
 * and a saved name, the auto-rejoin effect above fires the instant `roomId`
 * turns null and pulls the user straight back into the room they just left.
 */
function useLeaveRoom() {
  const [, setParams] = useSearchParams()
  const leave = useRoom((s) => s.leave)
  const endRoom = useRoom((s) => s.endRoom)
  return {
    leave: () => {
      leave()
      setParams({}, { replace: true })
    },
    endRoom: () => {
      endRoom()
      setParams({}, { replace: true })
    },
  }
}

/**
 * The room this device was in when it last closed the page.
 *
 * A host who wandered off — or whose phone locked — used to come back to an
 * empty lobby with their room still running for everyone else and no way back
 * into it but remembering the code.
 */
function ResumeCard() {
  const resumable = useRoom((s) => s.resumable)
  const resume = useRoom((s) => s.resume)
  const discard = useRoom((s) => s.discardResumable)
  const [, setParams] = useSearchParams()

  if (!resumable) return null

  const ago = Math.max(0, Math.round((Date.now() - resumable.at) / 60000))
  return (
    <div className="space-y-3 rounded-2xl border border-accent-dim bg-accent-dim/20 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-dim text-accent">
          <History size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold break-words text-white">
            Room in progress · <span className="font-mono tracking-[0.2em]">{resumable.roomId}</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-300">
            {resumable.wasHost ? 'You were hosting this room' : 'You were listening in'}
            {ago > 0 && ` · ${ago === 1 ? 'a minute' : `${ago} minutes`} ago`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="accent"
          size="sm"
          onClick={() => {
            setParams({ id: resumable.roomId })
            resume()
          }}
        >
          <Radio size={14} />
          Rejoin room
        </Button>
        <Button variant="ghost" size="sm" onClick={discard}>
          <X size={14} />
          Forget it
        </Button>
      </div>
    </div>
  )
}

function RoomLobby({
  urlId, name, setName, notice, onJoin, onCreate,
}: {
  urlId: string
  name: string
  setName: (v: string) => void
  notice: string | null
  onJoin: (id: string) => void
  onCreate: (id: string) => void
}) {
  const [code, setCode] = useState(urlId)
  const clearNotice = useRoom((s) => s.clearNotice)

  const join = (id: string) => {
    const trimmed = id.trim().toUpperCase()
    if (!trimmed) return
    onJoin(trimmed)
  }

  const usingBroker = !import.meta.env.VITE_ROOM_WS

  return (
    <div className="mx-auto max-w-lg space-y-5 py-6 sm:py-8">
      <header className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-dim text-accent">
          <Users size={26} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Listening rooms</h1>
        <p className="mt-2 text-sm text-ink-400">
          Play the same song, at the same second, with anyone. The host controls playback.
        </p>
      </header>

      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-accent-dim bg-accent-dim/30 px-4 py-2.5 text-sm text-accent-soft">
          <p className="flex-1">{notice}</p>
          <button onClick={clearNotice} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      <ResumeCard />

      <div className="space-y-4 rounded-2xl border border-ink-800 bg-ink-900/60 p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-300" htmlFor="room-name">
            Your name
          </label>
          <input
            id="room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Who's listening?"
            maxLength={24}
            className="w-full rounded-xl border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
        </div>

        <Button variant="accent" size="lg" className="w-full" onClick={() => onCreate(generateRoomCode())}>
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
            aria-label="Room code"
            className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 font-mono tracking-[0.15em] text-white uppercase placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-400 focus:border-accent focus:outline-none sm:px-4 sm:tracking-[0.25em]"
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

/** How closely this device is tracking the room, in one glance. */
function SyncBadge() {
  const isHost = useRoom((s) => s.isHost)
  const drift = useRoom((s) => s.drift)
  const latency = useRoom((s) => s.latency)
  const connecting = useRoom((s) => s.connecting)

  if (connecting) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1.5 text-xs text-ink-300">
        <Loader2 size={12} className="animate-spin" />
        Connecting…
      </span>
    )
  }

  const off = Math.abs(drift) > DRIFT_DEADZONE
  return (
    <span
      className={clsx(
        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
        off ? 'bg-ink-800 text-ink-300' : 'bg-emerald-500/15 text-emerald-300',
      )}
      title={
        isHost
          ? 'You are the timing reference for the room'
          : `Drift ${drift.toFixed(2)}s · ${latency || '—'}ms to host`
      }
    >
      {off ? <Signal size={12} /> : <Wifi size={12} />}
      {isHost ? 'Reference' : off ? `Syncing ${drift > 0 ? '+' : ''}${drift.toFixed(1)}s` : 'In sync'}
      {!isHost && latency > 0 && <span className="text-ink-400">· {latency}ms</span>}
    </span>
  )
}

function RoomSession({
  pendingInvite, onSwitch, onStay,
}: {
  pendingInvite: string | null
  onSwitch: () => void
  onStay: () => void
}) {
  const roomId = useRoom((s) => s.roomId) ?? ''
  const name = useRoom((s) => s.name)
  const members = useRoom((s) => s.members)
  const chat = useRoom((s) => s.chat)
  const isHost = useRoom((s) => s.isHost)
  const hostId = useRoom((s) => s.hostId)
  const hostAway = useRoom((s) => s.hostAway)
  const controlMode = useRoom((s) => s.controlMode)
  const canControl = useRoom((s) => s.canControl)
  const myId = useRoom((s) => s.myId)
  const { leave, endRoom } = useLeaveRoom()
  const sendChat = useRoom((s) => s.sendChat)
  const setControlMode = useRoom((s) => s.setControlMode)
  const setName = useRoom((s) => s.setName)
  const kick = useRoom((s) => s.kick)
  const claimHost = useRoom((s) => s.claimHost)

  const current = usePlayer((s) => s.current)

  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(name)
  const chatEnd = useRef<HTMLDivElement>(null)

  // Set before the input unmounts so its blur (which fires during unmount)
  // knows the edit was cancelled — otherwise Escape still committed the draft.
  const discardNameEdit = useRef(false)

  const saveName = () => {
    if (discardNameEdit.current) {
      discardNameEdit.current = false
      setEditingName(false)
      return
    }
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
    void copyText(`${location.origin}/room?id=${roomId}`).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const hostName = isHost ? 'You' : members.find((m) => m.id === hostId)?.name ?? 'the host'
  const present = members.filter((m) => !m.away).length + 1

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {/*
          Three stacked bands on a phone — identity, status, actions — instead
          of one wrap container. Six pills of wildly different widths sharing a
          single `flex-wrap` produced a ragged three-row block on a 360px
          screen, with the room code stranded on a line of its own.
        */}
        <header className="space-y-3 rounded-2xl border border-ink-800 bg-ink-900/60 p-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs tracking-[0.2em] text-ink-400 uppercase">Room</p>
              <p className="font-mono text-xl tracking-[0.25em] text-white sm:text-2xl">{roomId}</p>
            </div>
            <span
              className={clsx(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium sm:hidden',
                isHost ? 'bg-accent-dim text-accent' : 'bg-ink-800 text-ink-300',
              )}
            >
              {isHost && <Crown size={12} />}
              {isHost ? 'Host' : 'Listener'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                'hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium sm:flex',
                isHost ? 'bg-accent-dim text-accent' : 'bg-ink-800 text-ink-300',
              )}
            >
              {isHost && <Crown size={12} />}
              {isHost ? 'Host' : 'Listener'}
            </span>
            <SyncBadge />
            {/* Actions share the row evenly on a phone, sit at natural width above it */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Button size="sm" variant="outline" onClick={copyLink} className="flex-1 sm:flex-none">
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Invite'}
              </Button>
              {isHost ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={endRoom}
                  title="Close the room for everyone"
                  className="flex-1 sm:flex-none"
                >
                  <PowerOff size={13} />
                  End room
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={leave} className="flex-1 sm:flex-none">
                  <LogOut size={13} />
                  Leave
                </Button>
              )}
              {isHost && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={leave}
                  title="Leave but keep the room open"
                  className="flex-1 sm:flex-none"
                >
                  <LogOut size={13} />
                  Leave
                </Button>
              )}
            </div>
          </div>
        </header>

        {pendingInvite && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-dim bg-accent-dim/20 p-4">
            <p className="text-sm text-white">
              You opened an invite for room{' '}
              <span className="font-mono tracking-[0.2em] text-accent">{pendingInvite}</span>, but you're in{' '}
              <span className="font-mono tracking-[0.2em]">{roomId}</span>.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="accent" onClick={onSwitch}>
                Switch room
              </Button>
              <Button size="sm" variant="ghost" onClick={onStay}>
                Stay here
              </Button>
            </div>
          </div>
        )}

        {hostAway && !isHost && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="flex items-center gap-2 text-sm text-amber-200">
              <WifiOff size={16} className="shrink-0" />
              The host dropped out. Holding their seat for a moment in case they're reloading.
            </p>
            <Button size="sm" variant="outline" onClick={claimHost}>
              <Crown size={13} />
              Take over
            </Button>
          </div>
        )}

        {current ? (
          <div className="flex items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900/60 p-4 sm:gap-4 sm:p-5">
            <Artwork src={current.artwork} alt={current.title} className="h-14 w-14 sm:h-20 sm:w-20" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-white sm:text-lg">{current.title}</p>
              <p className="truncate text-sm text-ink-400">{current.artist}</p>
              <p className="mt-1.5 text-xs text-ink-400">
                {canControl
                  ? isHost
                    ? 'You control playback for everyone.'
                    : 'The host let you control playback.'
                  : `Following ${hostName === 'You' ? 'the host' : hostName}.`}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Radio size={28} />}
            title={canControl ? 'Pick something to play' : 'Waiting for the host'}
            hint={
              canControl
                ? 'Play any track and everyone in the room hears it at the same moment. You can browse other pages — the room stays connected.'
                : 'Playback will start automatically when the host presses play.'
            }
          />
        )}

        {/* Who can control playback */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-800 bg-ink-900/60 p-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
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
                    ? 'You can play, pause and change tracks for the room.'
                    : 'Your transport controls are locked while the host is driving.'}
              </p>
            </div>
          </div>
          {isHost && (
            <div className="flex w-full shrink-0 items-center gap-1 rounded-full bg-ink-850 p-1 sm:w-auto">
              {(['host', 'everyone'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setControlMode(mode)}
                  aria-pressed={controlMode === mode}
                  className={clsx(
                    'flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition sm:flex-none',
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
          <h3 className="mb-3 text-sm font-semibold text-white">In the room · {present}</h3>
          <div className="flex flex-wrap gap-2">
            {editingName ? (
              <span className="flex items-center gap-1 rounded-full bg-ink-800 py-1 pr-1 pl-3">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') {
                      discardNameEdit.current = true
                      setEditingName(false)
                    }
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
              <span
                key={m.id}
                className={clsx(
                  'group flex items-center gap-1.5 rounded-full py-1.5 pr-1.5 pl-3 text-xs',
                  m.away ? 'bg-ink-850 text-ink-400 italic' : 'bg-ink-800 text-ink-300',
                )}
                title={m.away ? `${m.name} is reconnecting` : undefined}
              >
                {m.id === hostId && <Crown size={11} className="shrink-0 text-accent" aria-label="Host" />}
                <span className="max-w-[9rem] truncate">{m.name}</span>
                {m.away && <span className="text-[10px] text-ink-400">reconnecting…</span>}
                {isHost && (
                  <button
                    onClick={() => kick(m.id)}
                    title={`Remove ${m.name}`}
                    aria-label={`Remove ${m.name} from the room`}
                    className="rounded-full p-0.5 text-ink-400 transition hover:bg-ink-700 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
            {members.length === 0 && (
              <span className="rounded-full border border-dashed border-ink-700 px-3 py-1.5 text-xs text-ink-400">
                Share the code to invite others
              </span>
            )}
          </div>
        </section>
      </div>

      {/* chat */}
      <aside className="flex h-[min(55dvh,26rem)] min-h-[17rem] flex-col rounded-2xl border border-ink-800 bg-ink-900/60 sm:h-[min(60dvh,32rem)] lg:h-[560px]">
        <h3 className="border-b border-ink-800 px-4 py-3 text-sm font-semibold text-white">Chat</h3>
        <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-4">
          {chat.length === 0 && <p className="text-xs text-ink-400">Say something to the room.</p>}
          {chat.map((c, i) => (
            <div key={`${c.at}-${i}`} className={clsx(c.id === myId && 'text-right')}>
              <p className="text-[11px] text-ink-400">{c.id === myId ? 'You' : c.name}</p>
              <p
                className={clsx(
                  'mt-0.5 inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-left text-sm break-words',
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
            aria-label="Message"
            className="min-w-0 flex-1 rounded-full border border-ink-700 bg-ink-850 px-3.5 py-2 text-sm text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
          <button
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="Send message"
            title="Send message"
            className="shrink-0 rounded-full bg-accent p-2.5 text-ink-950 transition hover:bg-accent-soft disabled:opacity-40"
          >
            <Send size={15} />
          </button>
        </div>
      </aside>
    </div>
  )
}
