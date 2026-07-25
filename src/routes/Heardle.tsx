import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipForward, RotateCcw, Check, X, Share2 } from 'lucide-react'
import clsx from 'clsx'
import type { Track } from '@/types'
import { source, sourceFor } from '@/services'
import { usePlayer } from '@/store/player'
import { Artwork, Button, EmptyState, Skeleton, ErrorNote } from '@/components/ui'

/** Snippet length unlocked at each attempt, in seconds. */
const STAGES = [1, 2, 4, 7, 11, 16]

type Guess = { text: string; correct: boolean; skipped: boolean }

export default function Heardle() {
  const [pool, setPool] = useState<Track[]>([])
  const [answer, setAnswer] = useState<Track | null>(null)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [guesses, setGuesses] = useState<Guess[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing')
  const [snippetPlaying, setSnippetPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopTimer = useRef<number | null>(null)
  /** invalidates a slower in-flight round when a new one starts */
  const roundSeq = useRef(0)
  /** true between calling play() and the element reporting it — blocks double-starts */
  const starting = useRef(false)

  // the main player must not keep playing underneath the game
  const pauseMainPlayer = usePlayer((s) => s.toggle)
  const mainPlaying = usePlayer((s) => s.playing)

  const attempt = guesses.length
  const limit = STAGES[Math.min(attempt, STAGES.length - 1)]

  /* ---------------- round setup ---------------- */

  const newRound = useCallback(
    async (tracks?: Track[]) => {
      // Two rounds in flight (double-clicking "Play again") could otherwise
      // interleave: round 2 sets the answer, then round 1's slower streamUrl
      // resolves last and the game plays a track that isn't the answer.
      const token = ++roundSeq.current

      setLoading(true)
      setError(null)
      setGuesses([])
      setInput('')
      setStatus('playing')
      setElapsed(0)
      setStreamUrl(null)
      stopSnippet()

      try {
        const list = tracks?.length ? tracks : await source.trending(60)
        if (token !== roundSeq.current) return

        // tracks shorter than the longest snippet make the game unwinnable
        const playable = list.filter((t) => t.duration > STAGES[STAGES.length - 1] + 5)
        if (!playable.length) throw new Error('No suitable tracks found')

        const pick = playable[Math.floor(Math.random() * playable.length)]
        const url = await sourceFor(pick.source).streamUrl(pick)
        if (token !== roundSeq.current) return

        setPool(playable)
        setAnswer(pick)
        setStreamUrl(url)
      } catch (e) {
        if (token !== roundSeq.current) return
        setError(e instanceof Error ? e.message : 'Could not start a round')
      } finally {
        if (token === roundSeq.current) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void newRound()
    return () => stopSnippet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- snippet playback ---------------- */

  function stopSnippet() {
    if (stopTimer.current) {
      clearInterval(stopTimer.current)
      stopTimer.current = null
    }
    const a = audioRef.current
    if (a) {
      a.pause()
      a.currentTime = 0
    }
    setSnippetPlaying(false)
    setElapsed(0)
  }

  const playSnippet = useCallback(() => {
    const a = audioRef.current
    if (!a || !streamUrl) return

    if (snippetPlaying) {
      stopSnippet()
      return
    }

    // `snippetPlaying` is only set once play() resolves, so a fast second click
    // would start a second interval and orphan the first. This ref closes that
    // window synchronously.
    if (starting.current) return
    starting.current = true

    // never let the game and the main player sound at once
    if (mainPlaying) pauseMainPlayer()

    a.currentTime = 0
    void a
      .play()
      .then(() => {
        starting.current = false
        setSnippetPlaying(true)
        if (stopTimer.current) clearInterval(stopTimer.current)
        // a timer, not `timeupdate` — timeupdate only fires ~4x/sec, which would
        // overrun a 1-second snippet by a noticeable margin
        stopTimer.current = window.setInterval(() => {
          const t = audioRef.current?.currentTime ?? 0
          setElapsed(t)
          if (t >= limit) stopSnippet()
        }, 50)
      })
      .catch(() => {
        // pausing a pending play() rejects with AbortError — expected, not a failure
        starting.current = false
        setSnippetPlaying(false)
      })
  }, [streamUrl, snippetPlaying, limit, mainPlaying, pauseMainPlayer])

  // a new attempt unlocks a longer snippet — stop any snippet still running
  useEffect(() => stopSnippet(), [attempt])

  /**
   * The browser can pause us on its own — backgrounding the tab suspends media,
   * and the track can simply end. Without this the button stays stuck on "Stop"
   * while nothing is playing, and the 50ms interval ticks forever.
   *
   * This must be a callback ref, not an effect: while `loading` is true the
   * component renders a skeleton with no <audio> at all, so a mount effect would
   * find `audioRef.current === null`, bail, and never re-run.
   */
  // one stable handler identity, or removeEventListener silently does nothing
  const onAudioPause = useRef(() => {
    if (stopTimer.current) {
      clearInterval(stopTimer.current)
      stopTimer.current = null
    }
    starting.current = false
    setSnippetPlaying(false)
  })

  const attachAudio = useCallback((el: HTMLAudioElement | null) => {
    const handler = onAudioPause.current
    const prev = audioRef.current
    if (prev) {
      prev.removeEventListener('pause', handler)
      prev.removeEventListener('ended', handler)
    }
    audioRef.current = el
    if (el) {
      el.addEventListener('pause', handler)
      el.addEventListener('ended', handler)
    }
  }, [])

  /* ---------------- guessing ---------------- */

  const normalize = (s: string) =>
    s
      // decompose accents so "Déjà Vu" and "Deja Vu" compare equal — without
      // this the diacritics are stripped as punctuation and the title becomes
      // unguessable by typing
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()

  /**
   * @param picked the exact track chosen from the suggestion list, when there
   *   was one. Titles alone are ambiguous — "Sunflower" and "Sunflower (Remix)"
   *   normalize identically, so picking the wrong one would grade as correct.
   */
  const submit = (guessText: string, skipped = false, picked?: Track) => {
    if (!answer || status !== 'playing') return

    const guess = normalize(guessText)
    const correct =
      !skipped &&
      guess.length > 0 &&
      (picked
        ? picked.id === answer.id && picked.source === answer.source
        : guess === normalize(answer.title))

    const next = [...guesses, { text: skipped ? 'Skipped' : guessText, correct, skipped }]
    setGuesses(next)
    setInput('')

    if (correct) {
      setStatus('won')
      stopSnippet()
    } else if (next.length >= STAGES.length) {
      setStatus('lost')
      stopSnippet()
    }
  }

  // guard the empty case: normalize("()") is "", and includes("") matches the
  // entire pool, dumping every track into the dropdown
  const normalizedInput = normalize(input)
  const suggestions = normalizedInput
    ? pool.filter((t) => normalize(t.title).includes(normalizedInput)).slice(0, 6)
    : []

  const shareResult = () => {
    const squares = guesses.map((g) => (g.correct ? '🟩' : g.skipped ? '⬜' : '🟥')).join('')
    const tail = status === 'lost' ? '🟥'.repeat(Math.max(0, STAGES.length - guesses.length)) : ''
    void navigator.clipboard.writeText(
      `PurePlay Heardle — ${status === 'won' ? `${guesses.length}/${STAGES.length}` : 'X/6'}\n${squares}${tail}`,
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  /* ---------------- render ---------------- */

  if (loading) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-8">
        <Skeleton className="h-32 w-full rounded-2xl" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    )
  }

  if (error) return <ErrorNote message={error} onRetry={() => void newRound()} />
  if (!answer) return <EmptyState title="No round available" />

  const finished = status !== 'playing'

  return (
    <div className="mx-auto max-w-xl space-y-6 py-4">
      <audio ref={attachAudio} src={streamUrl ?? undefined} preload="auto" />

      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">Heardle</h1>
        <p className="mt-1.5 text-sm text-ink-400">
          Name the track. Each miss unlocks another second.
        </p>
      </header>

      {/* answer reveal */}
      {finished && (
        <div
          className={clsx(
            'flex items-center gap-4 rounded-2xl border p-4',
            status === 'won' ? 'border-accent-dim bg-accent-dim/30' : 'border-ink-800 bg-ink-900',
          )}
        >
          <Artwork src={answer.artwork} alt={answer.title} className="h-16 w-16" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium tracking-wider text-ink-400 uppercase">
              {status === 'won' ? `Got it in ${guesses.length}` : 'The answer was'}
            </p>
            <p className="truncate font-semibold text-white">{answer.title}</p>
            <p className="truncate text-sm text-ink-400">{answer.artist}</p>
          </div>
        </div>
      )}

      {/* snippet player */}
      <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-5">
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-75"
            style={{
              width: `${Math.min(100, ((finished ? answer.duration : elapsed) / (finished ? answer.duration : STAGES[STAGES.length - 1])) * 100)}%`,
            }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] tabular-nums text-ink-400">
          {STAGES.map((s) => (
            <span key={s} className={clsx(s <= limit && 'text-ink-300')}>
              {s}s
            </span>
          ))}
        </div>

        <div className="mt-4 flex justify-center">
          <button
            onClick={playSnippet}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-ink-950 transition hover:scale-105"
            title={snippetPlaying ? 'Stop' : `Play ${limit}s`}
          >
            {snippetPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
          </button>
        </div>
        {!finished && (
          <p className="mt-2 text-center text-xs text-ink-400">
            {limit} second{limit > 1 ? 's' : ''} unlocked
          </p>
        )}
      </div>

      {/* guess rows */}
      <div className="space-y-2">
        {Array.from({ length: STAGES.length }, (_, i) => {
          const g = guesses[i]
          return (
            <div
              key={i}
              className={clsx(
                'flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm',
                !g && 'border-ink-800 bg-ink-900/40 text-ink-400',
                g?.correct && 'border-accent bg-accent-dim/40 text-white',
                g && !g.correct && 'border-ink-700 bg-ink-800/60 text-ink-300',
              )}
            >
              {g?.correct ? (
                <Check size={15} className="shrink-0 text-accent" />
              ) : g ? (
                <X size={15} className="shrink-0 text-ink-400" />
              ) : (
                <span className="w-[15px] shrink-0 text-center text-xs">{i + 1}</span>
              )}
              <span className="truncate">{g?.text ?? '—'}</span>
            </div>
          )
        })}
      </div>

      {/* input */}
      {!finished ? (
        <div className="relative">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && input.trim() && submit(input)}
            placeholder="Start typing a song title…"
            className="w-full rounded-full border border-ink-700 bg-ink-900 px-4 py-3 text-sm text-white placeholder:text-ink-400 focus:border-accent focus:outline-none"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-2xl">
              {suggestions.map((t) => (
                <li key={`${t.source}-${t.id}`}>
                  <button
                    onClick={() => submit(t.title, false, t)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-200 hover:bg-ink-800"
                  >
                    <Artwork src={t.artwork} alt="" className="h-7 w-7" rounded="rounded" />
                    <span className="min-w-0">
                      <span className="block truncate">{t.title}</span>
                      <span className="block truncate text-[11px] text-ink-400">{t.artist}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => submit('', true)}>
              <SkipForward size={14} />
              Skip (+{STAGES[Math.min(attempt + 1, STAGES.length - 1)] - limit}s)
            </Button>
            <Button variant="accent" className="flex-1" onClick={() => submit(input)} disabled={!input.trim()}>
              Guess
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={shareResult}>
            {copied ? <Check size={14} /> : <Share2 size={14} />}
            {copied ? 'Copied' : 'Share result'}
          </Button>
          <Button variant="accent" className="flex-1" onClick={() => void newRound(pool)}>
            <RotateCcw size={14} />
            Play again
          </Button>
        </div>
      )}
    </div>
  )
}
